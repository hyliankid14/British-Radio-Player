import { create } from "zustand";
import TrackPlayer, { State, TrackType } from "react-native-track-player";
import { Station, StationRepository, AudioQuality, getStreamCandidates } from "../data/stations";
import { Preferences } from "../storage/preferences";
import { CurrentShow, fetchShowInfo, onRmsDelayedUpdate, resetStationRmsDelay } from "../api/showInfo";
import { useStationShowStore } from "./stationShowStore";
import { Podcast, Episode, PodcastApi } from "../api/podcasts";
import { LastFmApi } from "../api/lastfm";
import { notifyNativePhonePlaybackStarted } from "../auto/autoBridge";
import { getDownloadedUri } from "../downloads/downloadStore";
import { getNetworkStatus } from "./networkStore";
import { trackEpisodePlay, trackStationPlay } from "../analytics/analytics";

interface PlayerState {
  currentStation: Station | null;
  currentShow: CurrentShow | null;
  currentPodcast: Podcast | null;
  currentEpisode: Episode | null;
  isPlaying: boolean;
  isBuffering: boolean;
  audioQuality: AudioQuality;
  favorites: string[];
  positionSeconds: number;
  durationSeconds: number;
  init: () => Promise<void>;
  playStation: (station: Station) => Promise<void>;
  playEpisode: (podcast: Podcast, episode: Episode) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  seekBy: (deltaSeconds: number) => Promise<void>;
  toggleEpisodePlayed: (episodeId: string, podcastId?: string, pubDateEpochMs?: number) => boolean;
  setAudioQuality: (quality: AudioQuality) => Promise<void>;
  toggleFavorite: (stationId: string) => void;
  setFavoritesOrder: (orderedIds: string[]) => void;
  refreshShowInfo: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  handleEpisodeProgress: (positionSeconds: number, durationSeconds: number) => void;
  handleEpisodeEnded: () => Promise<void>;
}

let showInfoInterval: any = null;
let scrobbleTimer: any = null;
let activeScrobbleKey = "";

function parsePodcastDateEpoch(pubDate?: string): number {
  if (!pubDate) return 0;
  const parsed = Date.parse(pubDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Resolves the effective stream quality, honouring the Auto-detect preference. */
function resolvePlaybackQuality(explicit: AudioQuality): AudioQuality {
  if (!Preferences.getSetting("pref_auto_quality", true)) return explicit;
  const { isOnline, isWifi } = getNetworkStatus();
  if (!isOnline) return "LOW";
  return isWifi ? "HIGH" : "MEDIUM";
}

/** Station rotation honouring the "scroll favourites only" preference. */
function stationRotation(): Station[] {
  const all = StationRepository.getAll();
  if (Preferences.getSetting<string>("pref_scroll_mode", "all") !== "favourites") return all;
  const favorites = Preferences.getFavorites();
  const filtered = all.filter((station) => favorites.includes(station.id));
  return filtered.length > 0 ? filtered : all;
}

/** Chooses between episode and podcast artwork for podcast playback. */
function resolvePodcastArtwork(podcast: Podcast, episode: Episode): string {
  const preference = Preferences.getSetting<string>("pref_podcast_artwork", "episode");
  return preference === "podcast"
    ? podcast.imageUrl || episode.imageUrl
    : episode.imageUrl || podcast.imageUrl;
}

function beginScrobble(artist: string, track: string, durationSec = 0, isPodcast = false): void {
  const settings = Preferences.getLastFm();
  if (isPodcast && !settings.podcasts) return;
  if (!settings.sessionKey || !settings.direct || !artist.trim() || !track.trim()) return;
  const key = `${artist.trim().toLowerCase()}|${track.trim().toLowerCase()}`;
  if (key === activeScrobbleKey) return;
  activeScrobbleKey = key;
  if (scrobbleTimer) clearTimeout(scrobbleTimer);
  LastFmApi.updateNowPlaying(artist.trim(), track.trim(), durationSec || undefined).catch(() => {});
  const threshold = durationSec > 0
    ? Math.max(30000, Math.min(durationSec * 500, 240000))
    : 60000;
  scrobbleTimer = setTimeout(() => {
    const current = Preferences.getLastFm();
    if (current.sessionKey && current.direct) {
      LastFmApi.scrobble(artist.trim(), track.trim(), Math.floor(Date.now() / 1000)).catch(() => {});
    }
  }, threshold);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentStation: null,
  currentShow: null,
  currentPodcast: null,
  currentEpisode: null,
  isPlaying: false,
  isBuffering: false,
  audioQuality: Preferences.getAudioQuality(),
  favorites: Preferences.getFavorites(),
  positionSeconds: 0,
  durationSeconds: 0,

  init: async () => {
    set({
      currentStation: null,
      audioQuality: Preferences.getAudioQuality(),
      favorites: Preferences.getFavorites()
    });
  },

  playStation: async (station: Station) => {
    resetStationRmsDelay();
    const quality = resolvePlaybackQuality(get().audioQuality);
    const geoBlocked = Preferences.getGeoBlocked();
    const candidates = getStreamCandidates(station, quality, geoBlocked);
    const streamUrl = candidates[0] || station.directStreamUrls[0] || `https://lsn.lv/bbcradio.m3u8?station=${station.serviceId}&bitrate=320000`;

    set({
      currentStation: station,
      currentShow: null,
      isBuffering: true,
      currentPodcast: null,
      currentEpisode: null,
      positionSeconds: 0,
      durationSeconds: 0
    });
    Preferences.setLastStationId(station.id);

    try {
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: station.id,
        url: streamUrl,
        type: streamUrl.includes(".m3u8") ? TrackType.HLS : TrackType.Default,
        title: station.title,
        artist: "BBC Radio",
        artwork: station.logoUrl,
        isLiveStream: true
      });
      await TrackPlayer.play();
      set({ isPlaying: true, isBuffering: false });
      notifyNativePhonePlaybackStarted();
      void trackStationPlay(station.id, station.title);

      // Fetch show info immediately
      const show = await fetchShowInfo(station.id);
      set({ currentShow: show });
      if (show.title && show.title !== "BBC Radio") {
        useStationShowStore.getState().updateShow(station.id, {
          title: show.title,
          episodeTitle: show.episodeTitle,
          startTimeMs: show.startTimeMs,
          endTimeMs: show.endTimeMs,
          nextShowTitle: show.nextShowTitle,
          imageUrl: show.imageUrl
        });
      }
      beginScrobble(show.artist || "", show.track || "");
      if (show.artist || show.track) {
        Preferences.addRecentSong({
          artist: show.artist || "",
          track: show.track || "",
          imageUrl: show.imageUrl || station.logoUrl,
          stationId: station.id,
          stationName: station.title
        });
      }

      // Update TrackPlayer metadata with live show info
      const hasSong = !!(show.artist || show.track);
      const songTitle = show.track
        ? (show.artist ? `${show.artist} - ${show.track}` : show.track)
        : (show.artist || "");
      const showTitle = (show.title && show.title !== "BBC Radio") ? show.title : station.title;
      const subtitleText = hasSong
        ? songTitle
        : (show.episodeTitle && show.episodeTitle !== showTitle
          ? `${showTitle} - ${show.episodeTitle}`
          : showTitle);

      await TrackPlayer.updateMetadataForTrack(0, {
        title: station.title,
        artist: subtitleText,
        album: showTitle,
        artwork: (hasSong && show.imageUrl) ? show.imageUrl : (show.imageUrl || station.logoUrl)
      });

      // Poll show info every 10s (delayed RMS promotion triggers immediate refresh)
      if (showInfoInterval) clearInterval(showInfoInterval);
      showInfoInterval = setInterval(async () => {
        const { currentStation, isPlaying } = get();
        if (currentStation && isPlaying) {
          await get().refreshShowInfo();
        }
      }, 10000);
    } catch (err) {
      console.warn("Error playing station:", err);
      set({ isBuffering: false, isPlaying: false });
    }
  },

  playEpisode: async (podcast: Podcast, episode: Episode) => {
    resetStationRmsDelay();
    if (showInfoInterval) {
      clearInterval(showInfoInterval);
      showInfoInterval = null;
    }
    set({
      currentStation: null,
      currentShow: null,
      currentPodcast: podcast,
      currentEpisode: episode,
      isBuffering: true,
      isPlaying: false,
      positionSeconds: 0,
      durationSeconds: episode.durationMins * 60
    });
    try {
      await TrackPlayer.reset();
      const artwork = resolvePodcastArtwork(podcast, episode);
      await TrackPlayer.add({
        id: episode.id,
        url: getDownloadedUri(episode.id) ?? episode.audioUrl,
        type: TrackType.Default,
        title: episode.title,
        artist: podcast.title,
        artwork,
        duration: episode.durationMins * 60
      });
      await TrackPlayer.play();
      set({ isPlaying: true, isBuffering: false });
      notifyNativePhonePlaybackStarted();
      const podId = (podcast?.id || episode?.podcastId || "").trim();
      const epId = (episode?.id || "").trim();
      const podTitle = (podcast?.title || (episode as any)?.podcastTitle || "").trim();
      const epTitle = (episode?.title || "").trim();
      void trackEpisodePlay(podId, epId, epTitle, podTitle);
      Preferences.addPodcastHistory({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        imageUrl: artwork,
        audioUrl: episode.audioUrl,
        pubDate: episode.pubDate,
        durationMins: episode.durationMins,
        podcastId: podcast.id,
        podcastTitle: podcast.title
      });

      // Resume where the listener left off (mirrors the Kotlin app's position restore).
      const resumeSeconds = Preferences.getEpisodeProgress(episode.id);
      if (resumeSeconds > 5) {
        try {
          await TrackPlayer.seekTo(resumeSeconds);
          set({ positionSeconds: resumeSeconds });
        } catch {
          // Seeking before the track is ready is non-fatal.
        }
      }
    } catch (err) {
      console.warn("Error playing podcast episode:", err);
      set({ isBuffering: false, isPlaying: false });
    }
  },

  pause: async () => {
    try {
      await TrackPlayer.pause();
      set({ isPlaying: false });
    } catch (e) {
      console.warn("Pause error:", e);
    }
  },

  stop: async () => {
    try {
      resetStationRmsDelay();
      if (showInfoInterval) {
        clearInterval(showInfoInterval);
        showInfoInterval = null;
      }
      if (scrobbleTimer) {
        clearTimeout(scrobbleTimer);
        scrobbleTimer = null;
      }
      activeScrobbleKey = "";
      await TrackPlayer.reset();
      set({
        currentStation: null,
        currentShow: null,
        currentPodcast: null,
        currentEpisode: null,
        isPlaying: false,
        isBuffering: false,
        positionSeconds: 0,
        durationSeconds: 0
      });
    } catch (e) {
      console.warn("Stop error:", e);
      set({
        currentStation: null,
        currentShow: null,
        currentPodcast: null,
        currentEpisode: null,
        isPlaying: false,
        isBuffering: false,
        positionSeconds: 0,
        durationSeconds: 0
      });
    }
  },

  resume: async () => {
    const { currentStation, currentPodcast, currentEpisode } = get();
    if (currentEpisode && currentPodcast) {
      try {
        await TrackPlayer.play();
        set({ isPlaying: true });
        return;
      } catch (e) {
        await get().playEpisode(currentPodcast, currentEpisode);
        return;
      }
    }
    if (!currentStation) {
      const defaultStation = StationRepository.getAll()[0];
      await get().playStation(defaultStation);
      return;
    }
    try {
      const activeTrack = await TrackPlayer.getActiveTrack();
      if (!activeTrack) {
        await get().playStation(currentStation);
        return;
      }
      await TrackPlayer.play();
      set({ isPlaying: true });
    } catch (e) {
      console.warn("Resume fallback to playStation:", e);
      await get().playStation(currentStation);
    }
  },

  togglePlayPause: async () => {
    const { isPlaying } = get();
    if (isPlaying) {
      await get().pause();
    } else {
      await get().resume();
    }
  },

  setAudioQuality: async (quality: AudioQuality) => {
    Preferences.setAudioQuality(quality);
    set({ audioQuality: quality });
    const { currentStation, isPlaying } = get();
    if (currentStation && isPlaying) {
      // Re-stream at new quality
      await get().playStation(currentStation);
    }
  },

  toggleFavorite: (stationId: string) => {
    Preferences.toggleFavorite(stationId);
    set({ favorites: Preferences.getFavorites() });
  },

  setFavoritesOrder: (orderedIds: string[]) => {
    Preferences.saveFavoritesOrder(orderedIds);
    set({ favorites: Preferences.getFavorites() });
  },

  handleEpisodeProgress: (positionSeconds: number, durationSeconds: number) => {
    const { currentEpisode } = get();
    set({
      positionSeconds,
      durationSeconds: durationSeconds > 0 ? durationSeconds : get().durationSeconds
    });
    if (!currentEpisode) return;
    Preferences.setEpisodeProgress(currentEpisode.id, positionSeconds);
    if (durationSeconds > 0 && positionSeconds / durationSeconds >= 0.98) {
      Preferences.markEpisodePlayed(
        currentEpisode.id,
        currentEpisode.podcastId,
        parsePodcastDateEpoch(currentEpisode.pubDate)
      );
    }
  },

  seekTo: async (seconds: number) => {
    const { durationSeconds } = get();
    const target = Math.max(0, durationSeconds > 0 ? Math.min(seconds, durationSeconds) : seconds);
    set({ positionSeconds: target });
    try {
      await TrackPlayer.seekTo(target);
    } catch (error) {
      console.warn("Seek failed:", error);
    }
  },

  seekBy: async (deltaSeconds: number) => {
    const { positionSeconds } = get();
    await get().seekTo(positionSeconds + deltaSeconds);
  },

  toggleEpisodePlayed: (episodeId: string, podcastId?: string, pubDateEpochMs?: number) => {
    if (!episodeId) return false;
    if (Preferences.isEpisodePlayed(episodeId)) {
      Preferences.markEpisodeUnplayed(episodeId);
      return false;
    }
    Preferences.markEpisodePlayed(episodeId, podcastId, pubDateEpochMs);
    return true;
  },

  handleEpisodeEnded: async () => {
    const { currentPodcast, currentEpisode } = get();
    if (!currentEpisode) return;
    Preferences.markEpisodePlayed(
      currentEpisode.id,
      currentEpisode.podcastId,
      parsePodcastDateEpoch(currentEpisode.pubDate)
    );
    set({ positionSeconds: 0 });

    // Auto-delete the download once the episode finishes, mirroring the Kotlin app.
    if (Preferences.getSetting("pref_delete_played", false)) {
      try {
        const { useDownloadStore } = require("../downloads/downloadStore");
        if (useDownloadStore.getState().downloads[currentEpisode.id]) {
          useDownloadStore.getState().remove(currentEpisode.id);
        }
      } catch {
        // Downloads are optional; ignore failures.
      }
    }

    const autoplayNext = Preferences.getSetting("pref_autoplay_next", "none");
    if (autoplayNext === "none" || !currentPodcast) return;
    if (
      autoplayNext === "subscriptions" &&
      !Preferences.getSubscribedPodcasts().includes(currentPodcast.id)
    ) {
      return;
    }

    const cached = PodcastApi.getEpisodesFromCache(currentPodcast.id) || [];
    if (!cached.length) return;
    const oldestFirst = Preferences.getPodcastEpisodeSort(currentPodcast.id) === "oldest_first";
    const sorted = [...cached].sort((a, b) => {
      const aEpoch = parsePodcastDateEpoch(a.pubDate);
      const bEpoch = parsePodcastDateEpoch(b.pubDate);
      return oldestFirst ? aEpoch - bEpoch : bEpoch - aEpoch;
    });
    const index = sorted.findIndex((episode) => episode.id === currentEpisode.id);
    const next = sorted
      .slice(index + 1)
      .find((episode) => !Preferences.isEpisodePlayed(episode.id));
    if (next) await get().playEpisode(currentPodcast, next);
  },

  refreshShowInfo: async () => {
    const { currentStation, isPlaying } = get();
    if (currentStation) {
      const show = await fetchShowInfo(currentStation.id);
      set({ currentShow: show });
      if (show.title && show.title !== "BBC Radio") {
        useStationShowStore.getState().updateShow(currentStation.id, {
          title: show.title,
          episodeTitle: show.episodeTitle,
          startTimeMs: show.startTimeMs,
          endTimeMs: show.endTimeMs,
          nextShowTitle: show.nextShowTitle,
          imageUrl: show.imageUrl
        });
      }
      beginScrobble(show.artist || "", show.track || "");
      if (show.artist || show.track) {
        Preferences.addRecentSong({
          artist: show.artist || "",
          track: show.track || "",
          imageUrl: show.imageUrl || currentStation.logoUrl,
          stationId: currentStation.id,
          stationName: currentStation.title
        });
      }
      if (isPlaying) {
        const hasSong = !!(show.artist || show.track);
        const songTitle = show.track
          ? (show.artist ? `${show.artist} - ${show.track}` : show.track)
          : (show.artist || "");
        const showTitle = (show.title && show.title !== "BBC Radio") ? show.title : currentStation.title;
        const subtitleText = hasSong
          ? songTitle
          : (show.episodeTitle && show.episodeTitle !== showTitle
            ? `${showTitle} - ${show.episodeTitle}`
            : showTitle);

        await TrackPlayer.updateMetadataForTrack(0, {
          title: currentStation.title,
          artist: subtitleText,
          album: showTitle,
          artwork: (hasSong && show.imageUrl) ? show.imageUrl : (show.imageUrl || currentStation.logoUrl)
        });
      }
    }
  },

  playNext: async () => {
    const { currentStation } = get();
    const stations = stationRotation();
    if (!stations.length) return;
    const currentIndex = currentStation ? stations.findIndex(s => s.id === currentStation.id) : -1;
    const nextStation = stations[(currentIndex + 1) % stations.length];
    await get().playStation(nextStation);
  },

  playPrevious: async () => {
    const { currentStation } = get();
    const stations = stationRotation();
    if (!stations.length) return;
    const currentIndex = currentStation ? stations.findIndex(s => s.id === currentStation.id) : 0;
    const prevIndex = (currentIndex - 1 + stations.length) % stations.length;
    const prevStation = stations[prevIndex];
    await get().playStation(prevStation);
  }
}));

onRmsDelayedUpdate((stationId) => {
  const { currentStation, isPlaying, refreshShowInfo } = usePlayerStore.getState();
  if (currentStation?.id === stationId && isPlaying) {
    void refreshShowInfo();
  }
});
