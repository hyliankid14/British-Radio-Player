import { create } from "zustand";
import TrackPlayer, { State, TrackType } from "react-native-track-player";
import { Station, StationRepository, AudioQuality, getStreamCandidates } from "../data/stations";
import { Preferences } from "../storage/preferences";
import { CurrentShow, fetchShowInfo } from "../api/showInfo";
import { Podcast, Episode } from "../api/podcasts";

interface PlayerState {
  currentStation: Station | null;
  currentShow: CurrentShow | null;
  currentPodcast: Podcast | null;
  currentEpisode: Episode | null;
  isPlaying: boolean;
  isBuffering: boolean;
  audioQuality: AudioQuality;
  favorites: string[];
  init: () => Promise<void>;
  playStation: (station: Station) => Promise<void>;
  playEpisode: (podcast: Podcast, episode: Episode) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  setAudioQuality: (quality: AudioQuality) => Promise<void>;
  toggleFavorite: (stationId: string) => void;
  setFavoritesOrder: (orderedIds: string[]) => void;
  refreshShowInfo: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
}

let showInfoInterval: any = null;

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentStation: null,
  currentShow: null,
  currentPodcast: null,
  currentEpisode: null,
  isPlaying: false,
  isBuffering: false,
  audioQuality: Preferences.getAudioQuality(),
  favorites: Preferences.getFavorites(),

  init: async () => {
    set({
      currentStation: null,
      audioQuality: Preferences.getAudioQuality(),
      favorites: Preferences.getFavorites()
    });
  },

  playStation: async (station: Station) => {
    const quality = get().audioQuality;
    const geoBlocked = Preferences.getGeoBlocked();
    const candidates = getStreamCandidates(station, quality, geoBlocked);
    const streamUrl = candidates[0] || station.directStreamUrls[0] || `https://lsn.lv/bbcradio.m3u8?station=${station.serviceId}&bitrate=320000`;

    set({ currentStation: station, currentShow: null, isBuffering: true });
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

      // Fetch show info immediately
      const show = await fetchShowInfo(station.id);
      set({ currentShow: show });
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
      await TrackPlayer.updateMetadataForTrack(0, {
        title: show.track ? `${show.artist} - ${show.track}` : show.title,
        artist: show.track ? station.title : (show.episodeTitle || station.title),
        artwork: show.imageUrl || station.logoUrl
      });

      // Poll show info every 30s
      if (showInfoInterval) clearInterval(showInfoInterval);
      showInfoInterval = setInterval(async () => {
        const { currentStation, isPlaying } = get();
        if (currentStation && isPlaying) {
          const updated = await fetchShowInfo(currentStation.id);
          set({ currentShow: updated });
          if (updated.artist || updated.track) {
            Preferences.addRecentSong({
              artist: updated.artist || "",
              track: updated.track || "",
              imageUrl: updated.imageUrl || currentStation.logoUrl,
              stationId: currentStation.id,
              stationName: currentStation.title
            });
          }
          await TrackPlayer.updateMetadataForTrack(0, {
            title: updated.track ? `${updated.artist} - ${updated.track}` : updated.title,
            artist: updated.track ? currentStation.title : (updated.episodeTitle || currentStation.title),
            artwork: updated.imageUrl || currentStation.logoUrl
          });
        }
      }, 30000);
    } catch (err) {
      console.warn("Error playing station:", err);
      set({ isBuffering: false, isPlaying: false });
    }
  },

  playEpisode: async (podcast: Podcast, episode: Episode) => {
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
      isPlaying: false
    });
    try {
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: episode.id,
        url: episode.audioUrl,
        type: TrackType.Default,
        title: episode.title,
        artist: podcast.title,
        artwork: episode.imageUrl || podcast.imageUrl,
        duration: episode.durationMins * 60
      });
      await TrackPlayer.play();
      set({ isPlaying: true, isBuffering: false });
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
      if (showInfoInterval) {
        clearInterval(showInfoInterval);
        showInfoInterval = null;
      }
      await TrackPlayer.reset();
      set({
        currentStation: null,
        currentShow: null,
        currentPodcast: null,
        currentEpisode: null,
        isPlaying: false,
        isBuffering: false
      });
    } catch (e) {
      console.warn("Stop error:", e);
      set({
        currentStation: null,
        currentShow: null,
        currentPodcast: null,
        currentEpisode: null,
        isPlaying: false,
        isBuffering: false
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

  refreshShowInfo: async () => {
    const { currentStation } = get();
    if (currentStation) {
      const show = await fetchShowInfo(currentStation.id);
      set({ currentShow: show });
    }
  },

  playNext: async () => {
    const { currentStation } = get();
    const stations = StationRepository.getAll();
    if (!stations.length) return;
    const currentIndex = currentStation ? stations.findIndex(s => s.id === currentStation.id) : -1;
    const nextStation = stations[(currentIndex + 1) % stations.length];
    await get().playStation(nextStation);
  },

  playPrevious: async () => {
    const { currentStation } = get();
    const stations = StationRepository.getAll();
    if (!stations.length) return;
    const currentIndex = currentStation ? stations.findIndex(s => s.id === currentStation.id) : 0;
    const prevIndex = (currentIndex - 1 + stations.length) % stations.length;
    const prevStation = stations[prevIndex];
    await get().playStation(prevStation);
  }
}));
