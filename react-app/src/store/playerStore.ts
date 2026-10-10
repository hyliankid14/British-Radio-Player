import { create } from "zustand";
import TrackPlayer, { State, TrackType } from "react-native-track-player";
import {
  Station,
  StationRepository,
  AudioQuality,
  getStreamCandidates,
  resolveEffectiveAudioQuality
} from "../data/stations";
import { Preferences } from "../storage/preferences";
import { CurrentShow, fetchShowInfo, onRmsDelayedUpdate, resetStationRmsDelay, isPlaceholderArtwork, resolveRecentSong } from "../api/showInfo";
import { useStationShowStore } from "./stationShowStore";
import { Podcast, Episode, PodcastApi } from "../api/podcasts";
import { shouldMarkEpisodePlayed, resolveEffectiveDuration } from "../podcasts/episodePlaybackStatus";
import { parseEpisodeDateEpoch } from "../podcasts/episodeDates";
import { findNextEpisodeToPlay } from "../podcasts/autoplayNext";
import { ScrobbleManager } from "../audio/scrobbleManager";
import { ScrobbleOutbox } from "../audio/scrobbleOutbox";
import { notifyNativePhonePlaybackStarted } from "../auto/autoBridge";
import { notifyCarPlayPhonePlaybackStopped } from "../auto/carPlayBridge";
import { getDownloadedUri } from "../downloads/downloadStore";
import { deleteDownloadWhenPlayed, pruneDownloads, setDownloadInUseEpisode } from "../downloads/downloadCleanup";
import { getNetworkStatus, subscribeNetwork } from "./networkStore";
import { PlaybackAnalytics } from "../analytics/playbackAnalytics";
import { getStationIdentArtwork } from "../utils/stationIdents";

import { probeGeoBlock, isStationUkOnly, isSportsStation } from "../utils/geoBlock";
import {
  recordListeningSeconds,
  recordEpisodeCompleted,
  requestReviewIfEligible
} from "../reviews/reviewManager.ts";

interface PlayerState {
  currentStation: Station | null;
  currentShow: CurrentShow | null;
  currentPodcast: Podcast | null;
  currentEpisode: Episode | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isRestoring: boolean;
  audioQuality: AudioQuality;
  favorites: string[];
  positionSeconds: number;
  durationSeconds: number;
  playbackError: string | null;
  init: () => Promise<void>;
  syncWithTrackPlayer: () => Promise<boolean>;
  playStation: (station: Station) => Promise<void>;
  playEpisode: (podcast: Podcast, episode: Episode) => Promise<void>;
  playRandomPodcast: () => Promise<void>;
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
  refreshShowInfo: (skipDelay?: boolean) => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  handleEpisodeProgress: (positionSeconds: number, durationSeconds: number) => void;
  handleEpisodeEnded: () => Promise<void>;
  clearPlaybackError: () => void;
  handlePlaybackError: (error: any) => Promise<void>;
  handlePlaybackState: (state: State) => void;
}

let showInfoInterval: any = null;

/**
 * Resume position is only useful to roughly the second, but persisting it on every
 * `PlaybackProgressUpdated` meant a synchronous MMKV write once a second, each one firing
 * every `Preferences.onChanged` listener. Writes are therefore bucketed to
 * `PROGRESS_WRITE_INTERVAL_SECONDS`, and the in-store `positionSeconds` still updates every
 * tick so the seek bar and time readouts stay smooth. Anything that ends or repositions
 * playback flushes explicitly, so a normal pause, stop or seek always persists exactly.
 */
const PROGRESS_WRITE_INTERVAL_SECONDS = 5;
let pendingProgress: { episodeId: string; seconds: number } | null = null;
let lastProgressBucket = -1;

function queueEpisodeProgressWrite(episodeId: string, positionSeconds: number): void {
  pendingProgress = { episodeId, seconds: positionSeconds };
  const bucket = Math.floor(positionSeconds / PROGRESS_WRITE_INTERVAL_SECONDS);
  if (bucket === lastProgressBucket) return;
  flushEpisodeProgress();
}

/** Persists any bucketed resume position immediately. */
export function flushEpisodeProgress(): void {
  const pending = pendingProgress;
  if (!pending) return;
  pendingProgress = null;
  lastProgressBucket = Math.floor(pending.seconds / PROGRESS_WRITE_INTERVAL_SECONDS);
  Preferences.setEpisodeProgress(pending.episodeId, pending.seconds);
}

/** Drops the bucketed position, for when the episode it belongs to no longer needs it. */
function discardPendingProgress(): void {
  pendingProgress = null;
  lastProgressBucket = -1;
}

let activePlaybackSegmentStartMs = 0;
let continuousPlaybackStartMs = 0;
let listeningFlushTimer: ReturnType<typeof setInterval> | null = null;

export function flushActiveListeningTime(): number {
  if (activePlaybackSegmentStartMs === 0) return 0;
  const now = Date.now();
  const elapsedSec = Math.floor((now - activePlaybackSegmentStartMs) / 1000);
  activePlaybackSegmentStartMs = now;
  if (elapsedSec > 0) {
    recordListeningSeconds(elapsedSec);
  }
  return elapsedSec;
}

let lastShowInfoPollMs = 0;

function startShowInfoInterval() {
  if (showInfoInterval) clearInterval(showInfoInterval);
  showInfoInterval = setInterval(async () => {
    const { currentStation, isPlaying } = usePlayerStore.getState();
    if (currentStation && isPlaying) {
      const now = Date.now();
      if (now - lastShowInfoPollMs >= 4000) {
        lastShowInfoPollMs = now;
        await usePlayerStore.getState().refreshShowInfo();
      }
    }
  }, 5000);
}

function stopShowInfoInterval() {
  if (showInfoInterval) {
    clearInterval(showInfoInterval);
    showInfoInterval = null;
  }
}

/** Resolves the effective stream quality, honouring the Auto-detect preference and network status. */
export function resolvePlaybackQuality(explicit: AudioQuality): AudioQuality {
  return resolveEffectiveAudioQuality(
    explicit,
    Preferences.getSetting("pref_auto_quality", true),
    getNetworkStatus()
  );
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
function resolvePodcastArtwork(podcast?: Podcast | null, episode?: Episode | null): string {
  const preference = Preferences.getSetting<string>("pref_podcast_artwork", "episode");
  const podImg = podcast?.imageUrl || "";
  const epImg = episode?.imageUrl || "";
  return preference === "podcast" ? (podImg || epImg) : (epImg || podImg);
}

let stationCandidates: string[] = [];
let stationCandidateIndex = 0;
let stationBeingPlayed: Station | null = null;
let stationPlaybackSessionId = 0;
let currentStationQuality: AudioQuality | null = null;
let endingEpisodeId: string | null = null;
let lastTrackMetadata: { title: string; artist?: string; album?: string; artwork?: any } | null = null;

async function updateTrack0Metadata(metadata: {
  title: string;
  artist?: string;
  album?: string;
  artwork?: any;
}): Promise<void> {
  if (
    lastTrackMetadata &&
    lastTrackMetadata.title === metadata.title &&
    lastTrackMetadata.artist === metadata.artist &&
    lastTrackMetadata.album === metadata.album &&
    lastTrackMetadata.artwork === metadata.artwork
  ) {
    return;
  }
  try {
    const results = await Promise.allSettled([
      TrackPlayer.updateMetadataForTrack(0, metadata),
      TrackPlayer.updateNowPlayingMetadata(metadata)
    ]);
    const anySucceeded = results.some((r) => r.status === "fulfilled");
    if (anySucceeded) {
      lastTrackMetadata = metadata;
    }
  } catch (err) {
    console.warn("Error updating track metadata:", err);
  }
}

async function tryNextStationCandidate(sessionId: number, reason: string): Promise<boolean> {
  if (sessionId !== stationPlaybackSessionId) return false;
  const station = stationBeingPlayed;
  if (!station) return false;


  const failedCandidate = stationCandidates[stationCandidateIndex];
  if (stationCandidateIndex + 1 < stationCandidates.length) {
    stationCandidateIndex += 1;
    console.warn(
      `Falling back to station candidate ${stationCandidateIndex + 1}/${stationCandidates.length} for ${station.title}: ${stationCandidates[stationCandidateIndex]} (${reason})`
    );
    usePlayerStore.setState({ isBuffering: true });
    return startStationCandidate(stationCandidateIndex, sessionId);
  }

  // If geoBlocked was not yet true, but all UK candidates failed, try international candidate list
  if (!Preferences.getGeoBlocked() && !isStationUkOnly(station.id)) {
    Preferences.setGeoBlocked(true);
    const quality = resolvePlaybackQuality(usePlayerStore.getState().audioQuality);
    const nonUkCandidates = getStreamCandidates(station, quality, true);
    if (nonUkCandidates.length > 0 && nonUkCandidates[0] !== failedCandidate) {
      stationCandidates = nonUkCandidates;
      stationCandidateIndex = 0;
      console.warn(
        `Falling back to international stream for ${station.title}: ${stationCandidates[0]}`
      );
      usePlayerStore.setState({ isBuffering: true });
      return startStationCandidate(0, sessionId);
    }
  }

  console.error(`All stream candidates failed for ${station.title}: ${reason}`);
  ScrobbleManager.onPlaybackStopped();
  stopShowInfoInterval();
  lastTrackMetadata = null;
  await TrackPlayer.reset().catch(() => {});

  const isGeo = Preferences.getGeoBlocked();
  const errorMessage = isStationUkOnly(station.id)
    ? `${station.title} is only available in the UK due to broadcasting rights.`
    : isGeo
      ? `${station.title} is currently unavailable in your region. Live sports and certain programmes may be restricted outside the UK.`
      : `Unable to connect to ${station.title}. Please check your connection and try again.`;

  usePlayerStore.setState({
    isPlaying: false,
    isBuffering: false,
    playbackError: errorMessage
  });
  return false;
}

async function startStationCandidate(index: number, sessionId: number): Promise<boolean> {
  if (sessionId !== stationPlaybackSessionId) return false;
  const station = stationBeingPlayed;
  if (!station || index >= stationCandidates.length) return false;

  const streamUrl = stationCandidates[index];
  try {
    ScrobbleManager.onPlaybackStopped();
    await TrackPlayer.reset();
    const artwork = getStationIdentArtwork(station.id);
    await TrackPlayer.add({
      id: station.id,
      url: streamUrl,
      type: streamUrl.includes(".m3u8") ? TrackType.HLS : TrackType.Default,
      title: station.title,
      artist: "BBC Radio",
      artwork,
      isLiveStream: true
    });
    lastTrackMetadata = {
      title: station.title,
      artist: "BBC Radio",
      artwork
    };
    await TrackPlayer.play();
    if (sessionId === stationPlaybackSessionId) {
      usePlayerStore.setState({ isPlaying: true, isBuffering: false, playbackError: null });
      notifyNativePhonePlaybackStarted();
      PlaybackAnalytics.onStationPlaybackRequested(station.id, station.title);
      PlaybackAnalytics.onPlaybackStateChanged(true);
    }
    return true;
  } catch (err) {
    console.warn(`Candidate ${index} (${streamUrl}) failed:`, err);
    return tryNextStationCandidate(sessionId, String(err));
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentStation: null,
  currentShow: null,
  currentPodcast: null,
  currentEpisode: null,
  isPlaying: false,
  isBuffering: false,
  isRestoring: true,
  audioQuality: Preferences.getAudioQuality(),
  favorites: Preferences.getFavorites(),
  positionSeconds: 0,
  durationSeconds: 0,
  playbackError: null,

  syncWithTrackPlayer: async (): Promise<boolean> => {
    try {
      const activeTrack = (await TrackPlayer.getActiveTrack()) || (await TrackPlayer.getQueue())[0];
      const playbackState = await TrackPlayer.getPlaybackState();
      const state = (playbackState as any)?.state ?? playbackState;
      const isPlaying = state === State.Playing;
      const isBuffering = state === State.Buffering || state === State.Loading;

      if (!activeTrack?.id) {
        set({ isRestoring: false });
        return false;
      }

      // Check if active track is a radio station
      let station = StationRepository.getById(activeTrack.id);
      if (!station) {
        const lastPlayed = Preferences.getLastPlayed();
        if (lastPlayed?.kind === "station" && lastPlayed.id) {
          station = StationRepository.getById(lastPlayed.id);
        }
      }

      if (station) {
        stationBeingPlayed = station;
        stationPlaybackSessionId += 1;
        const quality = resolvePlaybackQuality(get().audioQuality);
        currentStationQuality = quality;
        stationCandidates = getStreamCandidates(station, quality, Preferences.getGeoBlocked());
        stationCandidateIndex = 0;

        let restoredShow: CurrentShow | null = null;
        if (
          activeTrack.title &&
          activeTrack.title !== station.title &&
          activeTrack.title !== `BBC ${station.title}`
        ) {
          restoredShow = {
            title: activeTrack.title,
            artist: activeTrack.artist && activeTrack.artist !== "BBC Radio" ? activeTrack.artist : undefined,
            imageUrl: typeof activeTrack.artwork === "string" ? activeTrack.artwork : undefined
          };
        }

        set({
          currentStation: station,
          currentShow: restoredShow,
          currentEpisode: null,
          currentPodcast: null,
          isPlaying,
          isBuffering,
          isRestoring: false
        });

        if (isPlaying) {
          startShowInfoInterval();
        }
        void get().refreshShowInfo(true);
        return true;
      }

      // Check if active track is a podcast episode
      const history = Preferences.getPodcastHistory();
      const historyMatch = history.find((h) => h.id === activeTrack.id);
      const lastPlayed = Preferences.getLastPlayed();
      const podId = historyMatch?.podcastId || (lastPlayed?.kind === "episode" ? lastPlayed.podcastId : "");
      const epId = activeTrack.id;

      const episode: Episode = {
        id: epId,
        title: activeTrack.title || historyMatch?.title || "",
        description: historyMatch?.description || "",
        audioUrl: activeTrack.url || historyMatch?.audioUrl || "",
        imageUrl: (typeof activeTrack.artwork === "string" ? activeTrack.artwork : "") || historyMatch?.imageUrl || "",
        pubDate: historyMatch?.pubDate || "",
        durationMins: historyMatch?.durationMins || Math.round((activeTrack.duration || 0) / 60),
        podcastId: podId
      };

      const podcast: Podcast = {
        id: podId,
        title: activeTrack.artist || historyMatch?.podcastTitle || "Podcast",
        description: "",
        rssUrl: podId ? `https://podcasts.files.bbci.co.uk/${podId}.rss` : "",
        htmlUrl: "",
        imageUrl: (typeof activeTrack.artwork === "string" ? activeTrack.artwork : "") || historyMatch?.imageUrl || "",
        genres: [],
        typicalDurationMins: episode.durationMins
      };

      try {
        const progress = await TrackPlayer.getProgress();
        if (progress) {
          set({
            positionSeconds: progress.position || 0,
            durationSeconds: progress.duration || 0
          });
        }
      } catch {
        // Non-critical
      }

      set({
        currentStation: null,
        currentShow: null,
        currentEpisode: episode,
        currentPodcast: podcast,
        isPlaying,
        isBuffering,
        isRestoring: false
      });
      return true;
    } catch (err) {
      console.warn("Failed to sync with TrackPlayer:", err);
      set({ isRestoring: false });
      return false;
    }
  },

  init: async () => {
    set({
      audioQuality: Preferences.getAudioQuality(),
      favorites: Preferences.getFavorites(),
      playbackError: null
    });
    // Deliver anything left queued by a previous run before a new scrobble is added.
    ScrobbleOutbox.flush();

    // Check if TrackPlayer was already playing in the background
    await get().syncWithTrackPlayer();
  },

  playStation: async (station: Station) => {
    resetStationRmsDelay();
    if (isSportsStation(station.id)) {
      await probeGeoBlock();
    } else {
      void probeGeoBlock();
    }
    const quality = resolvePlaybackQuality(get().audioQuality);
    currentStationQuality = quality;
    const geoBlocked = Preferences.getGeoBlocked();
    const candidates = getStreamCandidates(station, quality, geoBlocked);

    stationPlaybackSessionId += 1;
    const sessionId = stationPlaybackSessionId;
    stationBeingPlayed = station;
    stationCandidates = candidates;
    stationCandidateIndex = 0;

    set({
      currentStation: station,
      currentShow: null,
      isBuffering: true,
      currentPodcast: null,
      currentEpisode: null,
      positionSeconds: 0,
      durationSeconds: 0,
      playbackError: null
    });
    Preferences.setLastStationId(station.id);
    Preferences.setLastPlayed({ kind: "station", id: station.id, podcastId: "" });

    if (candidates.length === 0) {
      set({
        isPlaying: false,
        isBuffering: false,
        playbackError: `${station.title} is only available to listeners in the UK due to broadcasting rights.`
      });
      return;
    }

    // Query RMS immediately on station launch without waiting for audio stream setup
    const initialShowPromise = fetchShowInfo(station.id, true)
      .then((show) => {
        if (usePlayerStore.getState().currentStation?.id === station.id) {
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
          if (show.artist || show.track) {
            ScrobbleManager.onTrackStarted(
              show.artist || "",
              show.track || "",
              station.title,
              show.durationSec || 0,
              false
            );
          } else {
            ScrobbleManager.onNoTrackPlaying();
          }
          const song = resolveRecentSong(show, station.logoUrl);
          if (song) {
            Preferences.addRecentSong({
              artist: song.artist,
              track: song.track,
              imageUrl: song.imageUrl,
              stationId: station.id,
              stationName: station.title
            });
          }
        }
        return show;
      })
      .catch((err) => {
        console.warn("Immediate show info fetch failed:", err);
        return null;
      });

    const started = await startStationCandidate(0, sessionId);
    if (!started || sessionId !== stationPlaybackSessionId) {
      return;
    }

    try {
      // The stream is up, so prefer a fresh read here. `fetchShowInfo` de-duplicates
      // per station, so when the tune-in fetch above is still in flight this joins it
      // rather than issuing a second identical pair of requests and discarding the first.
      const show =
        (await fetchShowInfo(station.id, true).catch(() => null)) ||
        (await initialShowPromise) ||
        { title: station.title };
      if (sessionId !== stationPlaybackSessionId) return;

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
      if (show.artist || show.track) {
        ScrobbleManager.onTrackStarted(
          show.artist || "",
          show.track || "",
          station.title,
          show.durationSec || 0,
          false
        );
      } else {
        ScrobbleManager.onNoTrackPlaying();
      }
      const song = resolveRecentSong(show, station.logoUrl);
      if (song) {
        Preferences.addRecentSong({
          artist: song.artist,
          track: song.track,
          imageUrl: song.imageUrl,
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

      const rawArt = show.songImageUrl || show.rawImageUrl;
      const songArtwork = hasSong && rawArt && !isPlaceholderArtwork(rawArt, station.logoUrl)
        ? rawArt
        : undefined;

      await updateTrack0Metadata({
        title: station.title,
        artist: subtitleText,
        album: showTitle,
        artwork: songArtwork || getStationIdentArtwork(station.id)
      });

      // Poll show info every 5s (delayed RMS promotion triggers immediate refresh)
      startShowInfoInterval();
    } catch (err) {
      console.warn("Error updating station metadata:", err);
    }
  },

  playEpisode: async (podcast: Podcast, episode: Episode) => {
    endingEpisodeId = null;
    stationPlaybackSessionId += 1;
    stationBeingPlayed = null;
    stationCandidates = [];
    stationCandidateIndex = 0;
    resetStationRmsDelay();
    stopShowInfoInterval();
    lastTrackMetadata = null;
    // The previous episode's position belongs to the previous episode.
    discardPendingProgress();
    const podId = (podcast?.id || episode?.podcastId || "").trim();
    const epId = (episode?.id || "").trim();
    const podTitle = (podcast?.title || (episode as any)?.podcastTitle || "").trim();
    const epTitle = (episode?.title || "").trim();
    const artwork = resolvePodcastArtwork(podcast, episode);

    set({
      currentStation: null,
      currentShow: null,
      currentPodcast:
        podcast ||
        (podId
          ? {
              id: podId,
              title: podTitle,
              description: "",
              rssUrl: "",
              htmlUrl: "",
              imageUrl: artwork,
              genres: [],
              typicalDurationMins: episode?.durationMins || 0
            }
          : null),
      currentEpisode: episode,
      isBuffering: true,
      isPlaying: false,
      playbackError: null,
      positionSeconds: 0,
      durationSeconds: (episode?.durationMins || 0) * 60
    });
    // Protect this episode's download from "Delete when completed" while it streams.
    setDownloadInUseEpisode(episode?.id || null);
    Preferences.setLastPlayed({ kind: "episode", id: epId || episode.id, podcastId: podId });

    // Record to listening history immediately (mirrors Kotlin RadioService.kt)
    try {
      Preferences.addPodcastHistory({
        id: epId || episode.id,
        title: epTitle || episode.title,
        description: episode.description || "",
        imageUrl: artwork || episode.imageUrl || podcast?.imageUrl || "",
        audioUrl: episode.audioUrl || "",
        pubDate: episode.pubDate || "",
        durationMins: episode.durationMins || 0,
        podcastId: podId,
        podcastTitle: podTitle
      });
    } catch (histErr) {
      console.warn("Failed to record podcast history:", histErr);
    }

    try {
      ScrobbleManager.onPlaybackStopped();
      lastTrackMetadata = null;
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: epId || episode.id,
        url: getDownloadedUri(epId || episode.id) ?? episode.audioUrl,
        type: TrackType.Default,
        title: epTitle || episode.title,
        artist: podTitle || podcast?.title || "BBC Radio",
        artwork,
        duration: (episode.durationMins || 0) * 60
      });
      await TrackPlayer.play();
      set({ isPlaying: true, isBuffering: false });
      notifyNativePhonePlaybackStarted();

      const durationSec = (episode.durationMins || 0) * 60;
      ScrobbleManager.onTrackStarted(
        podTitle || podcast?.title || "BBC Radio",
        epTitle || episode.title,
        podTitle || podcast?.title || "",
        durationSec,
        true
      );

      // Resume where the listener left off (mirrors the Kotlin app's position restore).
      const resumeSeconds = Preferences.getEpisodeProgress(epId || episode.id);
      const isResume = resumeSeconds > 5 && !Preferences.isEpisodePlayed(epId || episode.id);
      PlaybackAnalytics.onEpisodePlaybackRequested(podId, epId, epTitle, podTitle, isResume);
      PlaybackAnalytics.onPlaybackStateChanged(true);

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

  playRandomPodcast: async () => {
    try {
      const catalog = await PodcastApi.fetchLiveCatalog();
      if (!catalog || catalog.length === 0) return;
      const shuffled = [...catalog].sort(() => Math.random() - 0.5);
      for (const podcast of shuffled.slice(0, 15)) {
        try {
          const episodes = await PodcastApi.fetchEpisodes(podcast.rssUrl, podcast.id);
          if (!episodes || episodes.length === 0) continue;
          const latest = [...episodes].sort(
            (a, b) => parseEpisodeDateEpoch(b.pubDate) - parseEpisodeDateEpoch(a.pubDate)
          )[0];
          if (!latest) continue;
          await usePlayerStore.getState().playEpisode(podcast, latest);
          return;
        } catch {
          // Try next podcast
        }
      }
    } catch (err) {
      console.warn("Failed to play random podcast:", err);
    }
  },

  pause: async () => {
    try {
      currentStationQuality = null;
      stopShowInfoInterval();
      ScrobbleManager.onPlaybackPaused();
      PlaybackAnalytics.onPlaybackStateChanged(false);
      await TrackPlayer.pause();
      set({ isPlaying: false });

      const { currentEpisode, positionSeconds, durationSeconds } = get();
      if (currentEpisode) {
        const effectiveDuration = resolveEffectiveDuration(
          durationSeconds,
          0,
          currentEpisode.durationMins
        );
        if (shouldMarkEpisodePlayed(positionSeconds, effectiveDuration)) {
          discardPendingProgress();
          Preferences.markEpisodePlayed(
            currentEpisode.id,
            currentEpisode.podcastId,
            parseEpisodeDateEpoch(currentEpisode.pubDate),
            { keepDownload: true }
          );
        } else {
          flushEpisodeProgress();
        }
      }
    } catch (e) {
      console.warn("Pause error:", e);
    }
  },

  stop: async () => {
    stationPlaybackSessionId += 1;
    stationBeingPlayed = null;
    stationCandidates = [];
    stationCandidateIndex = 0;
    currentStationQuality = null;
    setDownloadInUseEpisode(null);
    PlaybackAnalytics.onPlaybackStopped();

    const { currentEpisode, positionSeconds, durationSeconds } = get();
    if (currentEpisode) {
      const effectiveDuration = resolveEffectiveDuration(
        durationSeconds,
        0,
        currentEpisode.durationMins
      );
      if (shouldMarkEpisodePlayed(positionSeconds, effectiveDuration)) {
        discardPendingProgress();
        Preferences.markEpisodePlayed(
          currentEpisode.id,
          currentEpisode.podcastId,
          parseEpisodeDateEpoch(currentEpisode.pubDate)
        );
        deleteDownloadWhenPlayed(currentEpisode.id);
        pruneDownloads();
      } else {
        flushEpisodeProgress();
      }
    }

    try {
      resetStationRmsDelay();
      stopShowInfoInterval();
      ScrobbleManager.onPlaybackStopped();
      notifyCarPlayPhonePlaybackStopped();
      lastTrackMetadata = null;
      await TrackPlayer.reset();
      set({
        currentStation: null,
        currentShow: null,
        currentPodcast: null,
        currentEpisode: null,
        isPlaying: false,
        isBuffering: false,
        playbackError: null,
        positionSeconds: 0,
        durationSeconds: 0
      });
    } catch (e) {
      console.warn("Stop error:", e);
      ScrobbleManager.onPlaybackStopped();
      set({
        currentStation: null,
        currentShow: null,
        currentPodcast: null,
        currentEpisode: null,
        isPlaying: false,
        isBuffering: false,
        playbackError: null,
        positionSeconds: 0,
        durationSeconds: 0
      });
    }
  },

  resume: async () => {
    const { currentStation, currentPodcast, currentEpisode } = get();
    if (currentEpisode) {
      try {
        await TrackPlayer.play();
        set({ isPlaying: true });
        ScrobbleManager.onPlaybackResumed();
        PlaybackAnalytics.onPlaybackStateChanged(true);
        return;
      } catch (e) {
        const pod: Podcast = currentPodcast || {
          id: currentEpisode.podcastId || "",
          title: (currentEpisode as any).podcastTitle || "",
          description: "",
          rssUrl: "",
          htmlUrl: "",
          imageUrl: currentEpisode.imageUrl,
          genres: [],
          typicalDurationMins: currentEpisode.durationMins
        };
        await get().playEpisode(pod, currentEpisode);
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
      ScrobbleManager.onPlaybackResumed();
      PlaybackAnalytics.onPlaybackStateChanged(true);
      startShowInfoInterval();
      void get().refreshShowInfo(true);
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
    if (quality === "AUTO") {
      Preferences.setSetting("pref_auto_quality", true);
    } else {
      Preferences.setSetting("pref_auto_quality", false);
    }
    Preferences.setAudioQuality(quality);
    set({ audioQuality: quality });
    const { currentStation, isPlaying } = get();
    if (currentStation && isPlaying) {
      // Re-stream at new quality
      await get().playStation(currentStation);
    }
  },

  toggleFavorite: (stationId: string) => {
    const isFav = Preferences.toggleFavorite(stationId);
    set({ favorites: Preferences.getFavorites() });
    if (isFav) {
      setTimeout(() => void requestReviewIfEligible("favorite_station_added"), 2000);
    }
  },

  setFavoritesOrder: (orderedIds: string[]) => {
    Preferences.saveFavoritesOrder(orderedIds);
    set({ favorites: Preferences.getFavorites() });
  },

  handleEpisodeProgress: (positionSeconds: number, durationSeconds: number) => {
    const { currentEpisode, currentStation, isPlaying, isBuffering } = get();
    const effectiveDuration = resolveEffectiveDuration(
      durationSeconds,
      get().durationSeconds,
      currentEpisode?.durationMins
    );
    set({
      positionSeconds,
      durationSeconds: effectiveDuration > 0 ? effectiveDuration : get().durationSeconds
    });

    if (!currentEpisode) {
      // While a live station plays, TrackPlayer's native service emits PlaybackProgressUpdated
      // every second in both foreground and background. Standard JS setInterval is throttled or
      // completely suspended by mobile OSes in the background, so use progress ticks to drive
      // periodic show-info polling and keep notification metadata fresh.
      if (currentStation && (isPlaying || isBuffering || stationBeingPlayed?.id === currentStation.id)) {
        const now = Date.now();
        if (now - lastShowInfoPollMs >= 5000) {
          lastShowInfoPollMs = now;
          void get().refreshShowInfo();
        }
      }
      return;
    }

    const alreadyPlayed = Preferences.isEpisodePlayed(currentEpisode.id);
    if (shouldMarkEpisodePlayed(positionSeconds, effectiveDuration)) {
      if (!alreadyPlayed) {
        // Marking played deletes the stored progress, so a queued write for this episode
        // must not resurrect it afterwards.
        discardPendingProgress();
        Preferences.markEpisodePlayed(
          currentEpisode.id,
          currentEpisode.podcastId,
          parseEpisodeDateEpoch(currentEpisode.pubDate),
          // Still playing, so a "Delete when completed" download must be kept.
          { keepDownload: true }
        );
      }
    } else if (!alreadyPlayed) {
      queueEpisodeProgressWrite(currentEpisode.id, positionSeconds);
    }
  },

  seekTo: async (seconds: number) => {
    const { durationSeconds, currentEpisode } = get();
    const effectiveDuration = resolveEffectiveDuration(
      durationSeconds,
      0,
      currentEpisode?.durationMins
    );
    const target = Math.max(0, effectiveDuration > 0 ? Math.min(seconds, effectiveDuration) : seconds);
    set({ positionSeconds: target });
    // A seek repositions playback, so the queued position is now wrong.
    if (currentEpisode) flushEpisodeProgress();
    try {
      await TrackPlayer.seekTo(target);
    } catch (error) {
      console.warn("Seek failed:", error);
    }

    if (currentEpisode && effectiveDuration > 0) {
      if (target >= effectiveDuration - 1) {
        void get().handleEpisodeEnded();
      } else if (shouldMarkEpisodePlayed(target, effectiveDuration)) {
        discardPendingProgress();
        Preferences.markEpisodePlayed(
          currentEpisode.id,
          currentEpisode.podcastId,
          parseEpisodeDateEpoch(currentEpisode.pubDate),
          { keepDownload: true }
        );
      }
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
    const { currentEpisode, isPlaying } = get();
    Preferences.markEpisodePlayed(
      episodeId,
      podcastId,
      pubDateEpochMs,
      { keepDownload: currentEpisode?.id === episodeId && isPlaying }
    );
    return true;
  },

  handleEpisodeEnded: async () => {
    const { currentPodcast, currentEpisode } = get();
    if (!currentEpisode) return;
    if (endingEpisodeId === currentEpisode.id) return;
    endingEpisodeId = currentEpisode.id;

    try {
      ScrobbleManager.onPlaybackStopped();
      // Playback is over, so the file is free to go once the episode counts as played.
      setDownloadInUseEpisode(null);
      discardPendingProgress();
      Preferences.markEpisodePlayed(
        currentEpisode.id,
        currentEpisode.podcastId,
        parseEpisodeDateEpoch(currentEpisode.pubDate)
      );
      recordEpisodeCompleted();
      setTimeout(() => void requestReviewIfEligible("episode_ended"), 1500);
      set({ positionSeconds: 0, isPlaying: false, isBuffering: false });

      // Auto-delete the download once the episode finishes, mirroring the Kotlin app.
      deleteDownloadWhenPlayed(currentEpisode.id);
      // The finished file was exempt from earlier pruning, so trim again now.
      pruneDownloads();

      const podId = currentPodcast?.id || currentEpisode.podcastId;
      if (!podId) return;

      const isOldestFirst = Preferences.getPodcastEpisodeSort(podId) === "oldest_first";
      const autoplayPref = Preferences.getSetting<string>("pref_autoplay_next", "none");
      const isSubscribed = Preferences.getSubscribedPodcasts().includes(podId);

      // Advance automatically for podcasts sorted oldest to newest, or when autoplay
      // is configured ("all" or "subscriptions" for subscribed podcasts).
      const shouldAdvance =
        isOldestFirst ||
        autoplayPref === "all" ||
        (autoplayPref === "subscriptions" && isSubscribed);

      if (!shouldAdvance) return;

      const podcast: Podcast =
        currentPodcast || {
          id: podId,
          title: (currentEpisode as any).podcastTitle || "",
          description: "",
          rssUrl: `https://podcasts.files.bbci.co.uk/${podId}.rss`,
          htmlUrl: "",
          imageUrl: currentEpisode.imageUrl || "",
          genres: [],
          typicalDurationMins: currentEpisode.durationMins || 0
        };

      // Retrieve episodes from memory cache, network RSS, or downloaded records
      let episodes = PodcastApi.getEpisodesFromCache(podId);
      if (!episodes || episodes.length === 0) {
        const rssUrl = podcast.rssUrl || `https://podcasts.files.bbci.co.uk/${podId}.rss`;
        try {
          episodes = await PodcastApi.fetchEpisodes(rssUrl, podId);
        } catch {
          episodes = [];
        }
      }
      if (!episodes || episodes.length === 0) {
        const downloaded = Preferences.getDownloadedEntries();
        const fromDownloads: Episode[] = [];
        for (const [id, rec] of Object.entries(downloaded)) {
          if (rec?.entry?.podcastId === podId && rec.entry.audioUrl) {
            fromDownloads.push({
              id: rec.entry.id || id,
              title: rec.entry.title || "",
              description: rec.entry.description || "",
              audioUrl: rec.entry.audioUrl,
              imageUrl: rec.entry.imageUrl || podcast.imageUrl || "",
              pubDate: rec.entry.pubDate,
              durationMins: rec.entry.durationMins || 0,
              podcastId: podId
            });
          }
        }
        episodes = fromDownloads;
      }
      if (!episodes || episodes.length === 0) return;

      const order = isOldestFirst ? "oldest_first" : "newest_first";
      const isPlayed = (epId: string) => Preferences.isEpisodePlayed(epId);
      const next = findNextEpisodeToPlay(episodes, currentEpisode, order, isPlayed);
      if (next) {
        await get().playEpisode(podcast, next);
      }
    } finally {
      setTimeout(() => {
        if (endingEpisodeId === currentEpisode.id) {
          endingEpisodeId = null;
        }
      }, 1000);
    }
  },

  refreshShowInfo: async (skipDelay: boolean = false) => {
    const { currentStation } = get();
    if (currentStation) {
      const show = await fetchShowInfo(currentStation.id, skipDelay);
      const latestStation = get().currentStation;
      if (!latestStation || latestStation.id !== currentStation.id) {
        return;
      }
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
      if (show.artist || show.track) {
        ScrobbleManager.onTrackStarted(
          show.artist || "",
          show.track || "",
          currentStation.title,
          show.durationSec || 0,
          false
        );
      } else {
        ScrobbleManager.onNoTrackPlaying();
      }
      const song = resolveRecentSong(show, currentStation.logoUrl);
      if (song) {
        Preferences.addRecentSong({
          artist: song.artist,
          track: song.track,
          imageUrl: song.imageUrl,
          stationId: currentStation.id,
          stationName: currentStation.title
        });
      }

      // Re-read current playback state from the store rather than stale closure
      const { isPlaying, isBuffering } = get();
      if (isPlaying || isBuffering || stationBeingPlayed?.id === currentStation.id) {
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

        const rawArt = show.songImageUrl || show.rawImageUrl;
        const songArtwork = hasSong && rawArt && !isPlaceholderArtwork(rawArt, currentStation.logoUrl)
          ? rawArt
          : undefined;

        await updateTrack0Metadata({
          title: currentStation.title,
          artist: subtitleText,
          album: showTitle,
          artwork: songArtwork || getStationIdentArtwork(currentStation.id)
        });
      }
    }
  },

  playNext: async () => {
    const { currentStation, currentEpisode } = get();
    if (currentEpisode) {
      await get().seekBy(30);
      return;
    }
    const stations = stationRotation();
    if (!stations.length) return;
    const currentIndex = currentStation ? stations.findIndex(s => s.id === currentStation.id) : -1;
    const nextStation = stations[(currentIndex + 1) % stations.length];
    await get().playStation(nextStation);
  },

  playPrevious: async () => {
    const { currentStation, currentEpisode } = get();
    if (currentEpisode) {
      await get().seekBy(-10);
      return;
    }
    const stations = stationRotation();
    if (!stations.length) return;
    const currentIndex = currentStation ? stations.findIndex(s => s.id === currentStation.id) : 0;
    const prevIndex = (currentIndex - 1 + stations.length) % stations.length;
    const prevStation = stations[prevIndex];
    await get().playStation(prevStation);
  },

  clearPlaybackError: () => {
    set({ playbackError: null });
  },

  handlePlaybackError: async (error: any) => {
    console.warn("TrackPlayer playback error received:", error);
    const { currentStation } = get();
    if (currentStation && stationBeingPlayed?.id === currentStation.id) {
      await tryNextStationCandidate(
        stationPlaybackSessionId,
        error?.message || error?.code || "PlaybackError"
      );
      return;
    }
    const { currentEpisode } = get();
    if (currentEpisode) {
      set({ isPlaying: false, isBuffering: false, playbackError: "Playback failed for this episode." });
    }
  },

  handlePlaybackState: (state: State) => {
    if (state === State.Playing) {
      if (activePlaybackSegmentStartMs === 0) {
        activePlaybackSegmentStartMs = Date.now();
        if (continuousPlaybackStartMs === 0) {
          continuousPlaybackStartMs = activePlaybackSegmentStartMs;
        }
      }
      if (!listeningFlushTimer) {
        listeningFlushTimer = setInterval(() => {
          flushActiveListeningTime();
        }, 15000);
      }
      PlaybackAnalytics.onPlaybackStateChanged(true);
      set({ isPlaying: true, isBuffering: false, playbackError: null });
      if (get().currentStation) {
        startShowInfoInterval();
        void get().refreshShowInfo();
      }
    } else if (state === State.Buffering || state === State.Loading) {
      set({ isBuffering: true });
    } else if (state === State.Ended) {
      stopShowInfoInterval();
      if (listeningFlushTimer) {
        clearInterval(listeningFlushTimer);
        listeningFlushTimer = null;
      }
      flushActiveListeningTime();
      activePlaybackSegmentStartMs = 0;
      continuousPlaybackStartMs = 0;
      PlaybackAnalytics.onPlaybackStopped();
      set({ isPlaying: false, isBuffering: false });
      if (get().currentEpisode) {
        void get().handleEpisodeEnded();
      }
    } else if (state === State.Paused || state === State.Stopped) {
      if (get().isBuffering) {
        // Ignore transient stopped state while TrackPlayer resets and buffers a new track/candidate
        return;
      }
      stopShowInfoInterval();
      if (listeningFlushTimer) {
        clearInterval(listeningFlushTimer);
        listeningFlushTimer = null;
      }
      flushActiveListeningTime();
      const continuousDurationSec =
        continuousPlaybackStartMs > 0
          ? Math.floor((Date.now() - continuousPlaybackStartMs) / 1000)
          : 0;
      activePlaybackSegmentStartMs = 0;
      continuousPlaybackStartMs = 0;
      if (state === State.Paused) {
        PlaybackAnalytics.onPlaybackStateChanged(false);
      } else {
        PlaybackAnalytics.onPlaybackStopped();
      }
      set({ isPlaying: false, isBuffering: false });
      if (continuousDurationSec >= 1200) {
        setTimeout(() => void requestReviewIfEligible("long_playback_paused"), 1500);
      }
    } else if (state === State.Error) {
      stopShowInfoInterval();
      if (listeningFlushTimer) {
        clearInterval(listeningFlushTimer);
        listeningFlushTimer = null;
      }
      flushActiveListeningTime();
      activePlaybackSegmentStartMs = 0;
      continuousPlaybackStartMs = 0;
      PlaybackAnalytics.onPlaybackStopped();
      const { currentStation } = get();
      if (currentStation && stationBeingPlayed?.id === currentStation.id) {
        void tryNextStationCandidate(stationPlaybackSessionId, "State.Error");
      } else {
        set({ isPlaying: false, isBuffering: false });
      }
    }
  }
}));

onRmsDelayedUpdate((stationId) => {
  const { currentStation, refreshShowInfo } = usePlayerStore.getState();
  if (currentStation?.id === stationId && (stationBeingPlayed?.id === stationId || currentStation)) {
    void refreshShowInfo();
  }
});

subscribeNetwork((status) => {
  if (!status.isOnline) return;
  const store = usePlayerStore.getState();
  const { currentStation, isPlaying, audioQuality } = store;
  if (!isPlaying || !currentStation) return;

  const isAuto = audioQuality === "AUTO" || Preferences.getSetting("pref_auto_quality", true);
  if (!isAuto) return;

  const targetQuality = resolvePlaybackQuality(audioQuality);
  if (currentStationQuality && targetQuality !== currentStationQuality) {
    console.log(
      `Network changed (${status.isWifi ? "Wi-Fi" : "Cellular"}), switching bitrate from ${currentStationQuality} to ${targetQuality}`
    );
    currentStationQuality = targetQuality;
    void store.playStation(currentStation);
  }
});
