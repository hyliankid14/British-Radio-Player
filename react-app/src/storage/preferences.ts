import { createMMKV } from "react-native-mmkv";
import { NativeAndroid } from "../native/nativeAndroid";
import { AudioQuality } from "../data/stations";

export interface SavedEpisodeEntry {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  audioUrl: string;
  pubDate: string;
  durationMins: number;
  podcastId: string;
  podcastTitle: string;
  savedAtMs?: number;
}

export interface DownloadedEpisodeRecord {
  localUri: string;
  sizeBytes?: number;
  downloadedAtMs: number;
  entry: SavedEpisodeEntry;
}

export interface PodcastHistoryEntry {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  audioUrl: string;
  pubDate: string;
  durationMins: number;
  podcastId: string;
  podcastTitle: string;
  playedAtMs: number;
}

let storage: {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string | boolean | number) => void;
  getBoolean: (key: string) => boolean | undefined;
  getNumber: (key: string) => number | undefined;
  contains: (key: string) => boolean;
  remove: (key: string) => boolean;
  clearAll: () => void;
  addOnValueChangedListener: (listener: (key: string) => void) => { remove: () => void };
};

try {
  storage = createMMKV({ id: "british-radio-player-prefs" });
} catch {
  // In-memory fallback for unit tests / web environments
  const memoryStore = new Map<string, any>();
  const memoryListeners = new Set<(key: string) => void>();
  storage = {
    getString: (key: string) => memoryStore.get(key),
    set: (key: string, value: any) => {
      memoryStore.set(key, value);
      memoryListeners.forEach((listener) => listener(key));
    },
    getBoolean: (key: string) => memoryStore.get(key),
    getNumber: (key: string) => memoryStore.get(key),
    contains: (key: string) => memoryStore.has(key),
    remove: (key: string) => {
      const existed = memoryStore.delete(key);
      memoryListeners.forEach((listener) => listener(key));
      return existed;
    },
    clearAll: () => {
      memoryStore.clear();
      memoryListeners.forEach((listener) => listener(""));
    },
    addOnValueChangedListener: (listener: (key: string) => void) => {
      memoryListeners.add(listener);
      return { remove: () => memoryListeners.delete(listener) };
    }
  };
}

/** Parses a JSON object string, returning an empty object on any failure. */
function tryObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const KEYS = {
  FAVORITES: "pref_favorite_stations",  AUDIO_QUALITY: "pref_audio_quality",
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
  ,PLAYED_EPISODE_IDS: "pref_played_episode_ids"
  ,EPISODE_PROGRESS: "pref_episode_progress"
  ,PODCAST_HISTORY: "pref_podcast_history"
  ,PLAYLIST_ENTRIES: "pref_podcast_playlist_entries"
  ,DOWNLOADED_EPISODES: "pref_downloaded_episodes"
  ,LAST_PLAYED_EPOCH: "pref_last_played_epoch"
  ,EPISODE_SORT: "pref_podcast_episode_sort"
  // Snapshot caches — mirroring Kotlin RemoteIndexClient 6-hour TTL disk cache
  ,POPULAR_PODCASTS_CACHE: "cache_popular_podcasts_data"
  ,POPULAR_PODCASTS_CACHE_AT: "cache_popular_podcasts_at"
  ,NEW_PODCASTS_CACHE: "cache_new_podcasts_data"
  ,NEW_PODCASTS_CACHE_AT: "cache_new_podcasts_at"
  ,ANONYMOUS_INSTALL_ID: "pref_anon_install_id"
  ,PODCAST_RATINGS_CACHE: "cache_podcast_ratings_data"
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
  hasSetting(key: string): boolean {
    return storage.contains(key);
  },
  getSetting<T extends string | boolean | number>(key: string, fallback: T): T {
    const value = typeof fallback === "boolean" ? storage.getBoolean(key) : typeof fallback === "number" ? storage.getNumber(key) : storage.getString(key);
    return (value ?? fallback) as T;
  },
  setSetting(key: string, value: string | boolean | number): void {
    storage.set(key, value);
    if (key === KEYS.ANALYTICS && typeof value === "boolean") {
      try {
        NativeAndroid.setNativeAnalyticsEnabled(value);
      } catch {
        // Ignore off Android
      }
    }
  },
  getStartupPage(): string { return storage.getString(KEYS.STARTUP_PAGE) || "all_stations"; },
  setStartupPage(value: string): void { storage.set(KEYS.STARTUP_PAGE, value); },
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

  getPodcastMetadata(podcastId: string): { title?: string; imageUrl?: string } | null {
    const raw = storage.getString(`pref_podcast_meta_${podcastId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  setPodcastMetadata(podcastId: string, meta: { title?: string; imageUrl?: string }): void {
    if (!podcastId) return;
    const existing = this.getPodcastMetadata(podcastId) || {};
    const updated = {
      title: meta.title && meta.title !== podcastId ? meta.title : existing.title,
      imageUrl: meta.imageUrl || existing.imageUrl
    };
    storage.set(`pref_podcast_meta_${podcastId}`, JSON.stringify(updated));
  },

  isPodcastNotificationsEnabled(podcastId: string): boolean {
    if (!this.getSubscribedPodcasts().includes(podcastId)) return false;
    return storage.getBoolean(`pref_podcast_notifications_${podcastId}`) ?? false;
  },

  setPodcastNotificationsEnabled(podcastId: string, enabled: boolean): void {
    storage.set(`pref_podcast_notifications_${podcastId}`, enabled);
  },

  togglePodcastNotifications(podcastId: string): boolean {
    const enabled = !this.isPodcastNotificationsEnabled(podcastId);
    storage.set(`pref_podcast_notifications_${podcastId}`, enabled);
    return enabled;
  },

  getPodcastTags(podcastId: string, defaultTags: string[] = []): string[] {
    const raw = storage.getString(`pref_podcast_tags_${podcastId}`);
    if (!raw) {
      return defaultTags.filter((tag) => !/^podcasts?$/i.test(tag));
    }
    try {
      const tags = JSON.parse(raw);
      return Array.isArray(tags)
        ? tags
            .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
            .filter((tag) => !/^podcasts?$/i.test(tag.trim()))
        : [];
    } catch {
      return [];
    }
  },

  setPodcastTags(podcastId: string, tags: string[]): void {
    const normalised = Array.from(
      new Set(
        tags
          .map((tag) => tag.trim())
          .filter((tag) => Boolean(tag) && !/^podcasts?$/i.test(tag))
      )
    );
    storage.set(`pref_podcast_tags_${podcastId}`, JSON.stringify(normalised));
  },

  addPodcastTag(podcastId: string, defaultTags: string[], tag: string): void {
    if (/^podcasts?$/i.test(tag.trim())) return;
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
    const entryMap = this.getPlaylistEntryMap();
    const defaults = [
      { id: "saved", name: "Saved Episodes", isDefault: true, itemCount: (entryMap["saved"] || []).length },
      { id: "downloaded", name: "Downloaded Files", isDefault: true, itemCount: Object.keys(this.getDownloadedEntries()).length }
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

  getHidePlayedEpisodesInPodcastDetail(podcastId: string): boolean {
    return storage.getBoolean(`hide_played_podcast_detail_${podcastId}`) ?? false;
  },

  setHidePlayedEpisodesInPodcastDetail(podcastId: string, hidden: boolean): void {
    storage.set(`hide_played_podcast_detail_${podcastId}`, hidden);
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

  getSavedPodcastSearches(): { id: string; name: string; query: string; notificationsEnabled: boolean; latestResultDate?: string }[] {
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
    search: { id: string; name: string; query: string; notificationsEnabled: boolean; latestResultDate?: string }
  ): void {
    const searches = this.getSavedPodcastSearches().filter((item) => item.id !== search.id);
    storage.set("pref_saved_podcast_searches", JSON.stringify([...searches, search]));
  },

  updatePodcastSearchLatestResult(id: string, latestResultDate?: string): void {
    const searches = this.getSavedPodcastSearches().map((search) =>
      search.id === id ? { ...search, latestResultDate } : search
    );
    storage.set("pref_saved_podcast_searches", JSON.stringify(searches));
  },

  updatePodcastSearchNotifications(id: string, enabled: boolean): void {
    const searches = this.getSavedPodcastSearches().map((search) =>
      search.id === id ? { ...search, notificationsEnabled: enabled } : search
    );
    storage.set("pref_saved_podcast_searches", JSON.stringify(searches));
  },

  updatePodcastSearch(
    id: string,
    updates: { name?: string; query?: string; notificationsEnabled?: boolean; latestResultDate?: string }
  ): void {
    const searches = this.getSavedPodcastSearches().map((search) =>
      search.id === id ? { ...search, ...updates } : search
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

  setPodcastSubscribed(podcastId: string, subscribedState: boolean): void {
    const subscribed = this.getSubscribedPodcasts();
    const index = subscribed.indexOf(podcastId);
    if (subscribedState && index < 0) {
      subscribed.push(podcastId);
      this.setSubscribedPodcasts(subscribed);
    } else if (!subscribedState && index >= 0) {
      subscribed.splice(index, 1);
      this.setSubscribedPodcasts(subscribed);
    }
  },

  onChanged(listener: (key: string) => void): { remove: () => void } {
    return storage.addOnValueChangedListener(listener);
  },

  // ── Episode state (played / progress / history) ─────────────────────────────

  getPlayedEpisodeIds(): string[] {
    const raw = storage.getString(KEYS.PLAYED_EPISODE_IDS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  },

  isEpisodePlayed(episodeId: string): boolean {
    return this.getPlayedEpisodeIds().includes(episodeId);
  },

  markEpisodePlayed(episodeId: string, podcastId?: string, pubDateEpochMs?: number): void {
    if (!episodeId) return;
    const played = this.getPlayedEpisodeIds();
    if (!played.includes(episodeId)) {
      storage.set(KEYS.PLAYED_EPISODE_IDS, JSON.stringify([...played, episodeId]));
    }
    this.removeEpisodeProgress(episodeId);
    if (podcastId && pubDateEpochMs && pubDateEpochMs > 0) {
      const existing = this.getLastPlayedEpoch(podcastId);
      if (pubDateEpochMs > existing) {
        const map = this.getMap(KEYS.LAST_PLAYED_EPOCH);
        map[podcastId] = pubDateEpochMs;
        storage.set(KEYS.LAST_PLAYED_EPOCH, JSON.stringify(map));
      }
    }
  },

  markEpisodeUnplayed(episodeId: string): void {
    const played = this.getPlayedEpisodeIds().filter((id) => id !== episodeId);
    storage.set(KEYS.PLAYED_EPISODE_IDS, JSON.stringify(played));
  },

  getEpisodeProgress(episodeId: string): number {
    return this.getMap(KEYS.EPISODE_PROGRESS)[episodeId] || this.getPodcastPosition(episodeId) || 0;
  },

  setEpisodeProgress(episodeId: string, positionSeconds: number): void {
    if (!episodeId || positionSeconds <= 0) return;
    const map = this.getMap(KEYS.EPISODE_PROGRESS);
    map[episodeId] = Math.floor(positionSeconds);
    storage.set(KEYS.EPISODE_PROGRESS, JSON.stringify(map));
  },

  removeEpisodeProgress(episodeId: string): void {
    const map = this.getMap(KEYS.EPISODE_PROGRESS);
    if (map[episodeId] !== undefined) {
      delete map[episodeId];
      storage.set(KEYS.EPISODE_PROGRESS, JSON.stringify(map));
    }
  },

  getLastPlayedEpoch(podcastId: string): number {
    return this.getMap(KEYS.LAST_PLAYED_EPOCH)[podcastId] || 0;
  },

  setLastPlayedEpoch(podcastId: string, epochMs: number): void {
    if (!podcastId || epochMs <= 0) return;
    const map = this.getMap(KEYS.LAST_PLAYED_EPOCH);
    if (epochMs > (map[podcastId] || 0)) {
      map[podcastId] = epochMs;
      storage.set(KEYS.LAST_PLAYED_EPOCH, JSON.stringify(map));
    }
  },

  markEpisodesPlayed(episodes: { id: string; podcastId?: string; pubDateEpochMs?: number }[]): void {
    if (!episodes || episodes.length === 0) return;
    const played = new Set(this.getPlayedEpisodeIds());
    const progressMap = this.getMap(KEYS.EPISODE_PROGRESS);
    const epochMap = this.getMap(KEYS.LAST_PLAYED_EPOCH);

    for (const ep of episodes) {
      if (!ep.id) continue;
      played.add(ep.id);
      delete progressMap[ep.id];
      if (ep.podcastId && ep.pubDateEpochMs && ep.pubDateEpochMs > 0) {
        if (ep.pubDateEpochMs > (epochMap[ep.podcastId] || 0)) {
          epochMap[ep.podcastId] = ep.pubDateEpochMs;
        }
      }
    }

    storage.set(KEYS.PLAYED_EPISODE_IDS, JSON.stringify(Array.from(played)));
    storage.set(KEYS.EPISODE_PROGRESS, JSON.stringify(progressMap));
    storage.set(KEYS.LAST_PLAYED_EPOCH, JSON.stringify(epochMap));
  },

  getPodcastEpisodeSort(podcastId: string): "newest_first" | "oldest_first" {
    const map = this.getStringMap(KEYS.EPISODE_SORT);
    return map[podcastId] === "oldest_first" ? "oldest_first" : "newest_first";
  },

  setPodcastEpisodeSort(podcastId: string, order: "newest_first" | "oldest_first"): void {
    const map = this.getStringMap(KEYS.EPISODE_SORT);
    map[podcastId] = order;
    storage.set(KEYS.EPISODE_SORT, JSON.stringify(map));
  },

  getPodcastHistory(): PodcastHistoryEntry[] {
    const raw = storage.getString(KEYS.PODCAST_HISTORY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is PodcastHistoryEntry => entry && typeof entry.id === "string")
        : [];
    } catch {
      return [];
    }
  },

  addPodcastHistory(entry: Omit<PodcastHistoryEntry, "playedAtMs"> & { playedAtMs?: number }): void {
    if (!entry?.id) return;
    const existing = this.getPodcastHistory().filter((item) => item.id !== entry.id);
    const record: PodcastHistoryEntry = { ...entry, playedAtMs: entry.playedAtMs ?? Date.now() };
    storage.set(KEYS.PODCAST_HISTORY, JSON.stringify([record, ...existing].slice(0, 20)));
  },

  clearPodcastHistory(): void {
    storage.set(KEYS.PODCAST_HISTORY, JSON.stringify([]));
  },

  removePodcastHistoryEntry(id: string): void {
    storage.set(
      KEYS.PODCAST_HISTORY,
      JSON.stringify(this.getPodcastHistory().filter((item) => item.id !== id))
    );
  },

  // ── Playlist entries (Saved Episodes and user playlists) ────────────────────

  getPodcastPlaylistEntries(playlistId: string): SavedEpisodeEntry[] {
    const raw = storage.getString(KEYS.PLAYLIST_ENTRIES);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Record<string, SavedEpisodeEntry[]>;
      const entries = parsed?.[playlistId];
      return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry.id === "string") : [];
    } catch {
      return [];
    }
  },

  isEpisodeSaved(episodeId: string): boolean {
    return this.getPodcastPlaylistEntries("saved").some((entry) => entry.id === episodeId);
  },

  addPodcastPlaylistEntry(playlistId: string, entry: SavedEpisodeEntry): void {
    if (!entry?.id) return;
    const all = this.getPlaylistEntryMap();
    const existing = (all[playlistId] || []).filter((item) => item.id !== entry.id);
    all[playlistId] = [{ ...entry, savedAtMs: entry.savedAtMs ?? Date.now() }, ...existing];
    storage.set(KEYS.PLAYLIST_ENTRIES, JSON.stringify(all));
    this.refreshPlaylistCounts(all);
  },

  removePodcastPlaylistEntry(playlistId: string, episodeId: string): void {
    const all = this.getPlaylistEntryMap();
    all[playlistId] = (all[playlistId] || []).filter((item) => item.id !== episodeId);
    storage.set(KEYS.PLAYLIST_ENTRIES, JSON.stringify(all));
    this.refreshPlaylistCounts(all);
  },

  toggleSavedEpisode(entry: SavedEpisodeEntry): boolean {
    if (this.isEpisodeSaved(entry.id)) {
      this.removePodcastPlaylistEntry("saved", entry.id);
      return false;
    }
    this.addPodcastPlaylistEntry("saved", entry);
    return true;
  },

  getPlaylistEntryMap(): Record<string, SavedEpisodeEntry[]> {
    const raw = storage.getString(KEYS.PLAYLIST_ENTRIES);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as Record<string, SavedEpisodeEntry[]> : {};
    } catch {
      return {};
    }
  },

  refreshPlaylistCounts(all: Record<string, SavedEpisodeEntry[]>): void {
    const playlists = this.getPodcastPlaylists().filter((playlist) => !playlist.isDefault);
    if (!playlists.length) return;
    this.setPodcastPlaylists(
      playlists.map((playlist) => ({ ...playlist, itemCount: (all[playlist.id] || []).length }))
    );
  },

  // ── Offline downloads ───────────────────────────────────────────────────────

  getDownloadedEntries(): Record<string, DownloadedEpisodeRecord> {
    const raw = storage.getString(KEYS.DOWNLOADED_EPISODES);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? parsed as Record<string, DownloadedEpisodeRecord>
        : {};
    } catch {
      return {};
    }
  },

  getDownloadedEntry(episodeId: string): DownloadedEpisodeRecord | undefined {
    return this.getDownloadedEntries()[episodeId];
  },

  isEpisodeDownloaded(episodeId: string): boolean {
    return !!this.getDownloadedEntries()[episodeId];
  },

  setDownloadedEntry(episodeId: string, record: DownloadedEpisodeRecord): void {
    if (!episodeId) return;
    const all = this.getDownloadedEntries();
    all[episodeId] = record;
    storage.set(KEYS.DOWNLOADED_EPISODES, JSON.stringify(all));
  },

  removeDownloadedEntry(episodeId: string): void {
    const all = this.getDownloadedEntries();
    if (all[episodeId]) {
      delete all[episodeId];
      storage.set(KEYS.DOWNLOADED_EPISODES, JSON.stringify(all));
    }
  },

  /** Removes every downloaded-episode record. */
  clearDownloadedEntries(): void {
    storage.set(KEYS.DOWNLOADED_EPISODES, JSON.stringify({}));
  },

  /** Empties a podcast playlist without deleting the playlist itself. */
  clearPodcastPlaylistEntries(playlistId: string): void {
    const raw = storage.getString(KEYS.PLAYLIST_ENTRIES);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, SavedEpisodeEntry[]>;
      if (parsed && typeof parsed === "object") {
        parsed[playlistId] = [];
        storage.set(KEYS.PLAYLIST_ENTRIES, JSON.stringify(parsed));
      }
    } catch {
      // Ignore malformed data.
    }
  },

  getMap(key: string): Record<string, number> {
    const raw = storage.getString(key);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  },

  getStringMap(key: string): Record<string, string> {
    const raw = storage.getString(key);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  },

  // ── Snapshot caches (Popular & New Podcasts — 6-hour TTL, mirrors Kotlin) ──

  /** @internal Read cache regardless of TTL — used as last-resort fallback. */
  _readPopularPodcastsRaw(): { id: string; name: string; plays: number }[] | null {
    const raw = storage.getString(KEYS.POPULAR_PODCASTS_CACHE);
    if (!raw) return null;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : null; } catch { return null; }
  },

  /** @internal Read new-podcasts cache regardless of TTL. */
  _readNewPodcastsRaw(): { id: string; title: string; first_seen_epoch_ms?: number; oldest_pub_epoch_ms?: number }[] | null {
    const raw = storage.getString(KEYS.NEW_PODCASTS_CACHE);
    if (!raw) return null;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : null; } catch { return null; }
  },

  /** Read the cached popular podcasts list. Returns null when absent or stale (>6 h). */
  getCachedPopularPodcasts(): { id: string; name: string; plays: number }[] | null {
    const cachedAt = storage.getNumber(KEYS.POPULAR_PODCASTS_CACHE_AT) ?? 0;
    if (Date.now() - cachedAt > 6 * 60 * 60 * 1000) return null;
    return this._readPopularPodcastsRaw();
  },

  /** Persist a fresh popular podcasts list with the current timestamp. */
  setCachedPopularPodcasts(entries: { id: string; name: string; plays: number }[]): void {
    storage.set(KEYS.POPULAR_PODCASTS_CACHE, JSON.stringify(entries));
    storage.set(KEYS.POPULAR_PODCASTS_CACHE_AT, Date.now());
  },

  /** Read the cached new podcasts list. Returns null when absent or stale (>6 h). */
  getCachedNewPodcasts(): { id: string; title: string; first_seen_epoch_ms?: number; oldest_pub_epoch_ms?: number }[] | null {
    const cachedAt = storage.getNumber(KEYS.NEW_PODCASTS_CACHE_AT) ?? 0;
    if (Date.now() - cachedAt > 6 * 60 * 60 * 1000) return null;
    return this._readNewPodcastsRaw();
  },

  /** Persist a fresh new podcasts list with the current timestamp. */
  setCachedNewPodcasts(entries: { id: string; title: string; first_seen_epoch_ms?: number; oldest_pub_epoch_ms?: number }[]): void {
    storage.set(KEYS.NEW_PODCASTS_CACHE, JSON.stringify(entries.slice(0, 50)));
    storage.set(KEYS.NEW_PODCASTS_CACHE_AT, Date.now());
  },

  /**
   * Exports preferences in the same grouped shape as the legacy Kotlin backup so either app
   * can restore the other's file. Kotlin group names map onto the React MMKV keys.
   */
  exportBackup(): string {
    const qualityToKotlin: Record<AudioQuality, string> = {
      HIGH: "320kbps",
      MEDIUM: "128kbps",
      LOW: "96kbps",
      AUTO: "320kbps"
    };
    // React scroll/autoplay values map onto the Kotlin preference vocabulary.
    const scrollToKotlin: Record<string, string> = {
      all: "all_stations",
      favourites: "favorites"
    };
    const autoplayToKotlin: Record<string, string> = {
      all: "all_podcasts",
      subscriptions: "subscriptions_only",
      none: "none"
    };
    const progressMs: Record<string, number> = {};
    const playedPrefs = tryObject(storage.getString("pref_episode_progress"));
    Object.entries(playedPrefs).forEach(([episodeId, seconds]) => {
      progressMs[`progress_${episodeId}`] = Math.round(Number(seconds) * 1000);
    });

    const playlists = [
      {
        id: "saved",
        name: "Saved Episodes",
        isDefault: true,
        entries: this.getPodcastPlaylistEntries("saved")
      },
      ...this.getPodcastPlaylists()
        .filter((playlist) => !playlist.isDefault && playlist.id !== "saved" && playlist.id !== "downloaded")
        .map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          isDefault: false,
          entries: this.getPodcastPlaylistEntries(playlist.id)
        }))
    ];

    const root: Record<string, unknown> = {
      favorites_prefs: {
        favorite_stations: this.getFavorites(),
        favorite_stations_order_string: this.getFavorites().join(",")
      },
      podcast_subscriptions: {
        subscribed_ids: this.getSubscribedPodcasts(),
        notifications_enabled: this.getSubscribedPodcasts().filter((id) =>
          this.isPodcastNotificationsEnabled(id)
        )
      },
      saved_episodes_prefs: {
        saved_set: this.getPodcastPlaylistEntries("saved").map((entry) => JSON.stringify(entry))
      },
      podcast_playlists_prefs: { playlists },
      saved_searches_prefs: { saved_searches_json: this.getSavedPodcastSearches() },
      played_episodes_prefs: {
        played_ids: this.getPlayedEpisodeIds(),
        ...progressMs
      },
      played_history_prefs: { history_json: this.getPodcastHistory() },
      playback_prefs: {
        last_station_id: this.getLastStationId(),
        auto_resume_android_auto: this.getSetting("pref_carplay_auto_resume", false),
        hide_played_android_auto: this.getSetting("pref_carplay_hide_played", false),
        hide_played_playlists: this.getHidePlayedEpisodesInPlaylists(),
        shake_random_podcast: this.getSetting("pref_shake_random", false),
        podcast_artwork_source: this.getSetting("pref_podcast_artwork", "episode"),
        autoplay_next_episode: autoplayToKotlin[this.getSetting<string>("pref_autoplay_next", "none")] || "none",
        stop_on_bluetooth_disconnect: this.getSetting("pref_stop_bluetooth", false),
        live_radio_pause_buffering: this.getSetting("pref_pause_buffering", true)
      },
      scrolling_prefs: { scroll_mode: scrollToKotlin[this.getSetting<string>("pref_scroll_mode", "all")] || "all_stations" },
      index_prefs: {
        new_podcast_notifications_enabled: this.getSetting("pref_n_notifications", false),
        index_interval_days: this.getSetting("pref_n_interval_days", 1)
      },
      subscription_refresh_prefs: {
        refresh_interval_minutes: this.getSetting("pref_subscription_refresh", 60)
      },
      podcast_filter_prefs: {
        exclude_non_english: this.getSetting("pref_exclude_non_english", false)
      },
      theme_prefs: {
        selected_theme: this.getTheme(),
        audio_quality: qualityToKotlin[this.getAudioQuality()] || "320kbps",
        auto_detect_quality: this.getSetting("pref_auto_quality", true)
      },
      download_prefs: {
        auto_download_enabled: this.getSetting("pref_auto_download", false),
        auto_download_limit: this.getSetting("pref_auto_download_limit", 5),
        download_on_wifi_only: this.getSetting("pref_download_wifi", true),
        delete_on_played: this.getSetting("pref_delete_played", false)
      }
    };

    return JSON.stringify(root, null, 2);
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
  },

  importKotlinBackup(jsonString: string): boolean {
    try {
      const root = JSON.parse(jsonString) as Record<string, unknown>;
      const isKotlinBackup = [
        "favorites_prefs",
        "podcast_subscriptions",
        "saved_searches_prefs",
        "playback_prefs",
        "theme_prefs"
      ].some((name) => Object.prototype.hasOwnProperty.call(root, name));
      if (!isKotlinBackup) return false;
      const group = (name: string): Record<string, unknown> => {
        const value = root[name];
        return value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : {};
      };
      const stringArray = (value: unknown): string[] | null => {
        if (!Array.isArray(value)) return null;
        return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      };
      const setIfPresent = (key: string, value: unknown) => {
        if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
          storage.set(key, value);
        }
      };

      const favorites = group("favorites_prefs");
      const favoriteIds = stringArray(favorites.favorite_stations) ||
        (typeof favorites.favorite_stations_order_string === "string"
          ? favorites.favorite_stations_order_string.split(",").filter(Boolean)
          : null);
      if (favoriteIds) this.setFavorites(favoriteIds);

      const subscriptions = group("podcast_subscriptions");
      const subscribedIds = stringArray(subscriptions.subscribed_ids);
      if (subscribedIds) this.setSubscribedPodcasts(subscribedIds);
      const notificationIds = stringArray(subscriptions.notifications_enabled);
      if (notificationIds) {
        notificationIds.forEach((podcastId) => storage.set(`pref_podcast_notifications_${podcastId}`, true));
      }

      const savedSearches = group("saved_searches_prefs").saved_searches_json;
      if (typeof savedSearches === "string") {
        const parsed = JSON.parse(savedSearches);
        if (Array.isArray(parsed)) {
          const searches = parsed
            .filter((item) => item && typeof item === "object")
            .map((item) => {
              const search = item as Record<string, unknown>;
              return {
                id: String(search.id || `search-${Date.now()}`),
                name: String(search.name || search.query || "Saved search"),
                query: String(search.query || ""),
                notificationsEnabled: Boolean(search.notificationsEnabled),
                latestResultDate: typeof search.lastMatchEpoch === "number" && search.lastMatchEpoch > 0
                  ? new Date(search.lastMatchEpoch).toISOString()
                  : typeof search.latestResultDate === "string"
                  ? search.latestResultDate
                  : undefined
              };
            })
            .filter((item) => item.query.trim().length > 0);
          storage.set("pref_saved_podcast_searches", JSON.stringify(searches));
        }
      }

      const theme = group("theme_prefs");
      const selectedTheme = theme.selected_theme;
      if (selectedTheme === "light" || selectedTheme === "dark" || selectedTheme === "system") {
        this.setTheme(selectedTheme);
      }
      const quality = theme.audio_quality;
      const qualityMap: Record<string, AudioQuality> = {
        "320kbps": "HIGH",
        "128kbps": "MEDIUM",
        "96kbps": "LOW",
        "48kbps": "LOW"
      };
      if (typeof quality === "string" && qualityMap[quality]) this.setAudioQuality(qualityMap[quality]);
      if (typeof theme.auto_detect_quality === "boolean") this.setSetting("pref_auto_quality", theme.auto_detect_quality);

      const playback = group("playback_prefs");
      const playbackMap: Record<string, string> = {
        live_radio_pause_buffering: "pref_pause_buffering",
        shake_random_podcast: "pref_shake_random",
        auto_resume_android_auto: "pref_carplay_auto_resume",
        hide_played_android_auto: "pref_carplay_hide_played",
        podcast_artwork_source: "pref_podcast_artwork"
      };
      Object.entries(playbackMap).forEach(([source, target]) => setIfPresent(target, playback[source]));
      setIfPresent("pref_stop_bluetooth", playback.stop_on_bluetooth_disconnect);

      // Autoplay and scroll values use a different vocabulary in the Kotlin build.
      const autoplayFromKotlin: Record<string, string> = {
        all_podcasts: "all",
        subscriptions_only: "subscriptions",
        none: "none"
      };
      if (
        typeof playback.autoplay_next_episode === "string" &&
        autoplayFromKotlin[playback.autoplay_next_episode]
      ) {
        setIfPresent("pref_autoplay_next", autoplayFromKotlin[playback.autoplay_next_episode]);
      }

      const scrollFromKotlin: Record<string, string> = {
        all_stations: "all",
        favorites: "favourites",
        all: "all",
        favourites: "favourites"
      };
      const scrolling = group("scrolling_prefs");
      if (typeof scrolling.scroll_mode === "string" && scrollFromKotlin[scrolling.scroll_mode]) {
        setIfPresent("pref_scroll_mode", scrollFromKotlin[scrolling.scroll_mode]);
      }

      const indexing = group("index_prefs");
      setIfPresent("pref_n_notifications", indexing.new_podcast_notifications_enabled);
      setIfPresent("pref_n_interval_days", indexing.index_interval_days);
      setIfPresent("pref_n_wifi_only", indexing.index_wifi_only);

      const filters = group("podcast_filter_prefs");
      setIfPresent("pref_exclude_non_english", filters.exclude_non_english);
      const subscriptionsSettings = group("subscription_refresh_prefs");
      setIfPresent("pref_subscription_refresh", subscriptionsSettings.refresh_interval_minutes);
      const downloads = group("download_prefs");
      [
        ["auto_download_enabled", "pref_auto_download"],
        ["auto_download_limit", "pref_auto_download_limit"],
        ["download_on_wifi_only", "pref_download_wifi"],
        ["delete_on_played", "pref_delete_played"]
      ].forEach(([source, target]) => setIfPresent(target, downloads[source]));

      // Played episodes, progress and history.
      const played = group("played_episodes_prefs");
      const playedIds = stringArray(played.played_ids);
      if (playedIds) storage.set("pref_played_episode_ids", JSON.stringify(playedIds));
      const progressMap: Record<string, number> = {};
      Object.entries(played).forEach(([key, value]) => {
        if (key.startsWith("progress_") && typeof value === "number" && value > 0) {
          progressMap[key.replace("progress_", "")] = Math.round(value / 1000);
        }
      });
      if (Object.keys(progressMap).length > 0) {
        storage.set("pref_episode_progress", JSON.stringify(progressMap));
      }

      const historyRaw = group("played_history_prefs").history_json;
      if (typeof historyRaw === "string") {
        const history = JSON.parse(historyRaw);
        if (Array.isArray(history)) storage.set("pref_podcast_history", JSON.stringify(history));
      }

      // Playlists and saved episodes.
      const playlistEntries: Record<string, unknown[]> = {};
      const playlistsRaw = group("podcast_playlists_prefs").playlists;
      const playlistSummaries: { id: string; name: string; isDefault: boolean; itemCount: number }[] = [];
      const parsePlaylists = (raw: unknown) => {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed)) return;
        parsed.forEach((item) => {
          if (!item || typeof item !== "object") return;
          const playlist = item as Record<string, unknown>;
          const id = String(playlist.id || "");
          if (!id) return;
          const entries = Array.isArray(playlist.entries) ? playlist.entries : [];
          playlistEntries[id] = entries;
          const isDefault = Boolean(playlist.isDefault) || id === "saved";
          if (!isDefault && id !== "downloaded") {
            playlistSummaries.push({
              id,
              name: String(playlist.name || "Playlist"),
              isDefault: false,
              itemCount: entries.length
            });
          }
        });
      };
      try {
        parsePlaylists(playlistsRaw);
      } catch {
        // Ignore malformed playlist data.
      }
      const savedSet = group("saved_episodes_prefs").saved_set;
      const savedEntries = stringArray(savedSet);
      if (savedEntries && savedEntries.length > 0) {
        try {
          playlistEntries.saved = savedEntries.map((entry) => JSON.parse(entry));
        } catch {
          // Ignore malformed saved episodes.
        }
      }
      if (Object.keys(playlistEntries).length > 0) {
        storage.set("pref_podcast_playlist_entries", JSON.stringify(playlistEntries));
      }
      if (playlistSummaries.length > 0) {
        storage.set("pref_podcast_playlists", JSON.stringify(playlistSummaries));
      }

      // Recent songs.
      const songsRaw = group("recent_songs_prefs").songs_json;
      if (typeof songsRaw === "string") {
        const songs = JSON.parse(songsRaw);
        if (Array.isArray(songs)) storage.set("pref_recent_songs", JSON.stringify(songs));
      }

      return true;
    } catch {
      return false;
    }
  },

  getAnonymousInstallId(): string {
    let id = storage.getString(KEYS.ANONYMOUS_INSTALL_ID);
    if (!id) {
      id = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      storage.set(KEYS.ANONYMOUS_INSTALL_ID, id);
    }
    return id;
  },

  getCachedPodcastRatings(): Record<string, { average: number; count: number; mine?: number }> {
    try {
      const raw = storage.getString(KEYS.PODCAST_RATINGS_CACHE);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  setCachedPodcastRatings(ratings: Record<string, { average: number; count: number; mine?: number }>): void {
    try {
      storage.set(KEYS.PODCAST_RATINGS_CACHE, JSON.stringify(ratings));
    } catch {}
  },

  updateCachedPodcastRating(podcastId: string, rating: { average: number; count: number; mine?: number }): void {
    try {
      const all = this.getCachedPodcastRatings();
      all[podcastId] = rating;
      this.setCachedPodcastRatings(all);
    } catch {}
  },
};
