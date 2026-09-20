import { createMMKV } from "react-native-mmkv";
import { AudioQuality } from "../data/stations";

let storage: {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string | boolean | number) => void;
  getBoolean: (key: string) => boolean | undefined;
  getNumber: (key: string) => number | undefined;
  remove: (key: string) => boolean;
  clearAll: () => void;
};

try {
  storage = createMMKV({ id: "british-radio-player-prefs" });
} catch {
  // In-memory fallback for unit tests / web environments
  const memoryStore = new Map<string, any>();
  storage = {
    getString: (key: string) => memoryStore.get(key),
    set: (key: string, value: any) => memoryStore.set(key, value),
    getBoolean: (key: string) => memoryStore.get(key),
    getNumber: (key: string) => memoryStore.get(key),
    remove: (key: string) => memoryStore.delete(key),
    clearAll: () => memoryStore.clear()
  };
}

const KEYS = {
  FAVORITES: "pref_favorite_stations",
  AUDIO_QUALITY: "pref_audio_quality",
  GEO_BLOCKED: "pref_geo_blocked",
  THEME: "pref_theme_mode",
  LAST_STATION: "pref_last_station_id",
  LAST_PODCAST_POSITIONS: "pref_podcast_positions",
  SUBSCRIBED_PODCASTS: "pref_subscribed_podcasts",
  RECENTLY_PLAYED: "pref_recently_played_stations",
  OFFLINE_MODE: "pref_offline_mode",
  RECENT_SONGS: "pref_recent_songs",
  LASTFM_SESSION_KEY: "pref_lastfm_session_key",
  LASTFM_USERNAME: "pref_lastfm_username",
  LASTFM_DIRECT: "pref_lastfm_direct",
  LASTFM_BROADCAST: "pref_lastfm_broadcast",
  LASTFM_PODCASTS: "pref_lastfm_podcasts"
  ,AUTO_QUALITY: "pref_auto_quality"
  ,PODCAST_ARTWORK: "pref_podcast_artwork"
  ,PAUSE_BUFFERING: "pref_pause_buffering"
  ,SCROLL_MODE: "pref_scroll_mode"
  ,SHAKE_RANDOM: "pref_shake_random"
  ,STOP_BLUETOOTH: "pref_stop_bluetooth"
  ,AUTOPLAY_NEXT: "pref_autoplay_next"
  ,SUB_REFRESH: "pref_subscription_refresh"
  ,AUTO_DOWNLOAD: "pref_auto_download"
  ,AUTO_DOWNLOAD_LIMIT: "pref_auto_download_limit"
  ,AUTO_DOWNLOAD_SAVED: "pref_auto_download_saved"
  ,DOWNLOAD_WIFI: "pref_download_wifi"
  ,DELETE_PLAYED: "pref_delete_played"
  ,INDEX_NOTIFICATIONS: "pref_index_notifications"
  ,EXCLUDE_NON_ENGLISH: "pref_exclude_non_english"
  ,ANALYTICS: "pref_analytics"
  ,STARTUP_PAGE: "pref_startup_page"
  ,ALARM: "pref_alarm"
};

export const Preferences = {
  getLastFm(): { sessionKey: string; username: string; direct: boolean; broadcast: boolean; podcasts: boolean } {
    return {
      sessionKey: storage.getString(KEYS.LASTFM_SESSION_KEY) || "",
      username: storage.getString(KEYS.LASTFM_USERNAME) || "",
      direct: storage.getBoolean(KEYS.LASTFM_DIRECT) ?? true,
      broadcast: storage.getBoolean(KEYS.LASTFM_BROADCAST) ?? true,
      podcasts: storage.getBoolean(KEYS.LASTFM_PODCASTS) ?? false
    };
  },

  setLastFmSession(username: string, sessionKey: string): void {
    storage.set(KEYS.LASTFM_USERNAME, username);
    storage.set(KEYS.LASTFM_SESSION_KEY, sessionKey);
    storage.set(KEYS.LASTFM_DIRECT, true);
  },

  clearLastFmSession(): void {
    storage.remove(KEYS.LASTFM_USERNAME);
    storage.remove(KEYS.LASTFM_SESSION_KEY);
    storage.remove(KEYS.LASTFM_DIRECT);
  },

  setLastFmDirect(value: boolean): void { storage.set(KEYS.LASTFM_DIRECT, value); },
  setLastFmBroadcast(value: boolean): void { storage.set(KEYS.LASTFM_BROADCAST, value); },
  setLastFmPodcasts(value: boolean): void { storage.set(KEYS.LASTFM_PODCASTS, value); },
  getSetting<T extends string | boolean | number>(key: string, fallback: T): T {
    const value = typeof fallback === "boolean" ? storage.getBoolean(key) : typeof fallback === "number" ? storage.getNumber(key) : storage.getString(key);
    return (value ?? fallback) as T;
  },
  setSetting(key: string, value: string | boolean | number): void { storage.set(key, value); },
  getLastFmLastScrobbled(): string { return storage.getString("pref_lastfm_last_scrobbled") || ""; },
  setLastFmLastScrobbled(value: string): void { storage.set("pref_lastfm_last_scrobbled", value); },
  getRecentSongs(): {
    artist: string;
    track: string;
    imageUrl: string;
    stationId: string;
    stationName: string;
    playedAtMs: number;
  }[] {
    const raw = storage.getString(KEYS.RECENT_SONGS);
    if (!raw) return [];
    try {
      const songs = JSON.parse(raw);
      return Array.isArray(songs) ? songs.filter((song) => song && typeof song === "object") : [];
    } catch {
      return [];
    }
  },

  addRecentSong(song: {
    artist: string;
    track: string;
    imageUrl: string;
    stationId: string;
    stationName: string;
  }): void {
    if (!song.artist.trim() && !song.track.trim()) return;
    const now = Date.now();
    const recent = this.getRecentSongs();
    const duplicate = recent.some(
      (entry) =>
        now - entry.playedAtMs < 5 * 60 * 1000 &&
        entry.artist === song.artist &&
        entry.track === song.track
    );
    if (duplicate) return;
    storage.set(
      KEYS.RECENT_SONGS,
      JSON.stringify([{ ...song, playedAtMs: now }, ...recent].slice(0, 50))
    );
  },

  getFavorites(): string[] {
    const raw = storage.getString(KEYS.FAVORITES);
    if (!raw) return ["radio1", "radio2", "radio4", "radio5live", "radio6"];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  setFavorites(stationIds: string[]): void {
    const normalised = Array.from(new Set(stationIds.filter(Boolean)));
    storage.set(KEYS.FAVORITES, JSON.stringify(normalised));
  },

  saveFavoritesOrder(orderedIds: string[]): void {
    this.setFavorites(orderedIds);
  },

  toggleFavorite(stationId: string): boolean {
    const favorites = this.getFavorites();
    const index = favorites.indexOf(stationId);
    let isFav = false;
    if (index >= 0) {
      favorites.splice(index, 1);
      isFav = false;
    } else {
      favorites.push(stationId);
      isFav = true;
    }
    this.setFavorites(favorites);
    return isFav;
  },

  isFavorite(stationId: string): boolean {
    return this.getFavorites().includes(stationId);
  },

  getAudioQuality(): AudioQuality {
    return (storage.getString(KEYS.AUDIO_QUALITY) as AudioQuality) || "HIGH";
  },

  setAudioQuality(quality: AudioQuality): void {
    storage.set(KEYS.AUDIO_QUALITY, quality);
  },

  getGeoBlocked(): boolean {
    return storage.getBoolean(KEYS.GEO_BLOCKED) ?? false;
  },

  setGeoBlocked(val: boolean): void {
    storage.set(KEYS.GEO_BLOCKED, val);
  },

  getTheme(): "system" | "dark" | "light" {
    return (storage.getString(KEYS.THEME) as any) || "system";
  },

  setTheme(theme: "system" | "dark" | "light"): void {
    storage.set(KEYS.THEME, theme);
  },

  getLastStationId(): string {
    return storage.getString(KEYS.LAST_STATION) || "radio1";
  },

  setLastStationId(stationId: string): void {
    storage.set(KEYS.LAST_STATION, stationId);
  },

  getPodcastPosition(episodeId: string): number {
    const raw = storage.getString(KEYS.LAST_PODCAST_POSITIONS);
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw);
      return parsed[episodeId] || 0;
    } catch {
      return 0;
    }
  },

  setPodcastPosition(episodeId: string, positionSeconds: number): void {
    const raw = storage.getString(KEYS.LAST_PODCAST_POSITIONS);
    let parsed: Record<string, number> = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {}
    }
    parsed[episodeId] = Math.floor(positionSeconds);
    storage.set(KEYS.LAST_PODCAST_POSITIONS, JSON.stringify(parsed));
  },

  getSubscribedPodcasts(): string[] {
    const raw = storage.getString(KEYS.SUBSCRIBED_PODCASTS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  setSubscribedPodcasts(podcastIds: string[]): void {
    storage.set(KEYS.SUBSCRIBED_PODCASTS, JSON.stringify(podcastIds));
  },

  getPodcastTags(podcastId: string, defaultTags: string[] = []): string[] {
    const raw = storage.getString(`pref_podcast_tags_${podcastId}`);
    if (!raw) {
      return defaultTags.filter((tag) => !/^podcasts?$/i.test(tag));
    }
    try {
      const tags = JSON.parse(raw);
      return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [];
    } catch {
      return [];
    }
  },

  setPodcastTags(podcastId: string, tags: string[]): void {
    const normalised = Array.from(
      new Set(tags.map((tag) => tag.trim()).filter(Boolean))
    );
    storage.set(`pref_podcast_tags_${podcastId}`, JSON.stringify(normalised));
  },

  addPodcastTag(podcastId: string, defaultTags: string[], tag: string): void {
    this.setPodcastTags(podcastId, [...this.getPodcastTags(podcastId, defaultTags), tag]);
  },

  removePodcastTag(podcastId: string, defaultTags: string[], tag: string): void {
    this.setPodcastTags(
      podcastId,
      this.getPodcastTags(podcastId, defaultTags).filter((existing) => existing !== tag)
    );
  },

  getSubscribedPodcastSort(): string {
    return storage.getString("pref_subscribed_podcast_sort") || "most_recently_updated";
  },

  setSubscribedPodcastSort(sort: string): void {
    storage.set("pref_subscribed_podcast_sort", sort);
  },

  getSubscribedPodcastManualOrder(): string[] {
    const raw = storage.getString("pref_subscribed_podcast_manual_order");
    if (!raw) return [];
    try {
      const order = JSON.parse(raw);
      return Array.isArray(order) ? order.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  },

  setSubscribedPodcastManualOrder(ids: string[]): void {
    storage.set("pref_subscribed_podcast_manual_order", JSON.stringify(ids));
  },

  getPodcastPlaylists(): { id: string; name: string; isDefault: boolean; itemCount: number }[] {
    const raw = storage.getString("pref_podcast_playlists");
    const defaults = [
      { id: "saved", name: "Saved Episodes", isDefault: true, itemCount: 0 },
      { id: "downloaded", name: "Downloaded Files", isDefault: true, itemCount: 0 }
    ];
    if (!raw) return defaults;
    try {
      const playlists = JSON.parse(raw);
      return Array.isArray(playlists) ? [...defaults, ...playlists.filter((item) =>
        item && typeof item.id === "string" && typeof item.name === "string"
      ).map((item) => ({
        ...item,
        isDefault: false,
        itemCount: typeof item.itemCount === "number" ? item.itemCount : 0
      }))] : defaults;
    } catch {
      return defaults;
    }
  },

  setPodcastPlaylists(playlists: { id: string; name: string; isDefault: boolean; itemCount: number }[]): void {
    storage.set(
      "pref_podcast_playlists",
      JSON.stringify(playlists.filter((playlist) => !playlist.isDefault))
    );
  },

  createPodcastPlaylist(name: string): void {
    const playlists = this.getPodcastPlaylists();
    playlists.push({ id: `playlist-${Date.now()}`, name: name.trim(), isDefault: false, itemCount: 0 });
    this.setPodcastPlaylists(playlists);
  },

  renamePodcastPlaylist(id: string, name: string): void {
    const playlists = this.getPodcastPlaylists().map((playlist) =>
      playlist.id === id ? { ...playlist, name: name.trim() } : playlist
    );
    this.setPodcastPlaylists(playlists);
  },

  deletePodcastPlaylist(id: string): void {
    this.setPodcastPlaylists(this.getPodcastPlaylists().filter((playlist) => playlist.id !== id));
  },

  getHidePlayedEpisodesInPlaylists(): boolean {
    return storage.getBoolean("pref_hide_played_episodes_in_playlists") ?? false;
  },

  setHidePlayedEpisodesInPlaylists(hidden: boolean): void {
    storage.set("pref_hide_played_episodes_in_playlists", hidden);
  },

  getRecentPodcastSearches(): string[] {
    const raw = storage.getString("pref_recent_podcast_searches");
    if (!raw) return [];
    try {
      const searches = JSON.parse(raw);
      if (!Array.isArray(searches)) return [];
      const validSearches = searches.filter(
        (search): search is string => typeof search === "string" && search.trim().length > 0
      );
      return validSearches.filter(
        (search, index) =>
          !validSearches.some(
            (other, otherIndex) =>
              index !== otherIndex &&
              other.length > search.length &&
              other.toLowerCase().startsWith(search.toLowerCase())
          )
      );
    } catch {
      return [];
    }
  },

  addRecentPodcastSearch(query: string): void {
    const value = query.trim();
    if (!value) return;
    this.setRecentPodcastSearches([
      value,
      ...this.getRecentPodcastSearches().filter((search) => search.toLowerCase() !== value.toLowerCase())
    ].slice(0, 10));
  },

  setRecentPodcastSearches(searches: string[]): void {
    storage.set("pref_recent_podcast_searches", JSON.stringify(searches));
  },

  getSavedPodcastSearches(): { id: string; name: string; query: string; notificationsEnabled: boolean }[] {
    const raw = storage.getString("pref_saved_podcast_searches");
    if (!raw) return [];
    try {
      const searches = JSON.parse(raw);
      return Array.isArray(searches) ? searches.filter((search) =>
        search && typeof search.id === "string" && typeof search.name === "string" &&
        typeof search.query === "string"
      ) : [];
    } catch {
      return [];
    }
  },

  savePodcastSearch(
    search: { id: string; name: string; query: string; notificationsEnabled: boolean }
  ): void {
    const searches = this.getSavedPodcastSearches().filter((item) => item.id !== search.id);
    storage.set("pref_saved_podcast_searches", JSON.stringify([...searches, search]));
  },

  updatePodcastSearchNotifications(id: string, enabled: boolean): void {
    const searches = this.getSavedPodcastSearches().map((search) =>
      search.id === id ? { ...search, notificationsEnabled: enabled } : search
    );
    storage.set("pref_saved_podcast_searches", JSON.stringify(searches));
  },

  removePodcastSearch(id: string): void {
    storage.set(
      "pref_saved_podcast_searches",
      JSON.stringify(this.getSavedPodcastSearches().filter((search) => search.id !== id))
    );
  },

  togglePodcastSubscription(podcastId: string): boolean {
    const subscribed = this.getSubscribedPodcasts();
    const index = subscribed.indexOf(podcastId);
    let isSub = false;
    if (index >= 0) {
      subscribed.splice(index, 1);
      isSub = false;
    } else {
      subscribed.push(podcastId);
      isSub = true;
    }
    this.setSubscribedPodcasts(subscribed);
    return isSub;
  },

  exportBackup(): string {
    return JSON.stringify({
      favorites: this.getFavorites(),
      audioQuality: this.getAudioQuality(),
      geoBlocked: this.getGeoBlocked(),
      theme: this.getTheme(),
      exportedAt: new Date().toISOString(),
      version: 1
    }, null, 2);
  },

  importBackup(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (Array.isArray(data.favorites)) this.setFavorites(data.favorites);
      if (data.audioQuality) this.setAudioQuality(data.audioQuality);
      if (typeof data.geoBlocked === "boolean") this.setGeoBlocked(data.geoBlocked);
      if (data.theme) this.setTheme(data.theme);
      return true;
    } catch {
      return false;
    }
  }
};
