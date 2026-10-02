import { createMMKV } from "react-native-mmkv";
import { NativeAndroid } from "../native/nativeAndroid";
import { AudioQuality } from "../data/stations";
import { mergeEpisodeProgress } from "./episodeProgress";
import { LastPlayed, normalizeLastPlayed, parseLastPlayed } from "./lastPlayed";
import { configureGeoBlockedStorage } from "../utils/geoBlock";
import type { QueuedScrobble } from "../audio/scrobbleQueue";
import { sanitizeScrobbleQueue } from "../audio/scrobbleQueue";
import { normalizeEpisodeId } from "../downloads/downloadLimits";
import {
  createPlayedIdLookup,
  isPlayedId,
  type PlayedIdLookup
} from "./playedIdLookup";
import { savePersistentRecentScrobbles, readPersistentRecentScrobbles } from "./persistentScrobbles";

export type { LastPlayed };

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
  /**
   * True when the app fetched this file automatically. The per-podcast download
   * limit only governs these, so manually requested downloads are never deleted.
   * Records written before this flag existed read as automatic.
   */
  isAutoDownloaded?: boolean;
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

export interface LastFmScrobbleEntry {
  artist: string;
  track: string;
  stationName?: string;
  timestampMs: number;
}

export interface ReviewPromptState {
  firstLaunchMs: number;
  sessionCount: number;
  activeDays: string[];
  totalListeningSeconds: number;
  completedEpisodesCount: number;
  lastPromptMs: number;
  lastPromptVersion: string;
  promptCount: number;
  hasReviewed: boolean;
}

export const DEFAULT_REVIEW_PROMPT_STATE: ReviewPromptState = {
  firstLaunchMs: 0,
  sessionCount: 0,
  activeDays: [],
  totalListeningSeconds: 0,
  completedEpisodesCount: 0,
  lastPromptMs: 0,
  lastPromptVersion: "",
  promptCount: 0,
  hasReviewed: false
};

let storage: {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string | boolean | number) => void;
  getBoolean: (key: string) => boolean | undefined;
  getNumber: (key: string) => number | undefined;
  contains: (key: string) => boolean;
  remove: (key: string) => boolean;
  clearAll: () => void;
  getAllKeys: () => string[];
  trim: () => void;
  addOnValueChangedListener: (listener: (key: string) => void) => { remove: () => void };
};

try {
  storage = createMMKV({ id: "british-radio-player-prefs", mode: "multi-process" });
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
    getAllKeys: () => Array.from(memoryStore.keys()),
    trim: () => {},
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

/**
 * Cache of parsed JSON blobs, keyed by the raw string each value was parsed from.
 *
 * Several preference values are whole objects or arrays that grow with use and get re-read
 * many times per render — once per list row in favourites, podcast-search and
 * playlist-detail, and once per second on the playback path. `storage.getString` is a
 * memory-mapped lookup, but `JSON.parse` of a growing map is not, so the parse dominated
 * the JS thread. Comparing the raw string means a blob is parsed once per actual change
 * rather than once per read.
 *
 * Cached values are treated as **immutable**. Writers must build a new value and pass it to
 * `writeJson` rather than mutating what a getter handed out, or the cached object and the
 * stored string would drift apart.
 */
const jsonCache = new Map<string, { raw: string | undefined; value: unknown }>();

/** Played-ids derived structures, rebuilt only when that key's stored string changes. */
let playedIdCache: {
  sourceRaw: string | undefined;
  ids: string[];
  lookup: PlayedIdLookup;
} | null = null;

/** Per-podcast tag lists, re-filtered only when that key's stored string changes. */
const podcastTagsCache = new Map<string, { raw: string; tags: string[] }>();

/** Reads a JSON object, reusing the cached parse while the stored string is unchanged. */
function readJsonObject<T>(key: string): Record<string, T> {
  const raw = storage.getString(key);
  const cached = jsonCache.get(key);
  if (cached && cached.raw === raw) return cached.value as Record<string, T>;
  const value = tryObject(raw) as Record<string, T>;
  jsonCache.set(key, { raw, value });
  return value;
}

/** Reads a JSON array, reusing the cached parse while the stored string is unchanged. */
function readJsonArray<T>(key: string): T[] {
  const raw = storage.getString(key);
  const cached = jsonCache.get(key);
  if (cached && cached.raw === raw) return cached.value as T[];
  let value: T[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) value = parsed as T[];
    } catch {
      value = [];
    }
  }
  jsonCache.set(key, { raw, value });
  return value;
}

/** Writes a JSON value and keeps the cached parse in step with it. */
function writeJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  storage.set(key, raw);
  jsonCache.set(key, { raw, value });
}

/**
 * Drops every cached parse.
 *
 * The store is opened in `multi-process` mode, so the native background worker can write
 * behind our back. Clearing on foreground is what keeps the cache honest without paying a
 * `checkContentChanged` on every read.
 */
export function invalidatePreferencesCache(): void {
  jsonCache.clear();
  podcastTagsCache.clear();
  playedIdCache = null;
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
  LASTFM_PODCASTS: "pref_lastfm_podcasts",
  LASTFM_LAST_SCROBBLED: "pref_lastfm_last_scrobbled",
  LASTFM_LAST_SCROBBLED_TIME_MS: "pref_lastfm_last_scrobbled_time_ms",
  LASTFM_RECENT_SCROBBLES: "pref_lastfm_recent_scrobbles"
  ,LASTFM_OUTBOX: "pref_lastfm_outbox"
  ,LASTFM_LAST_ERROR: "pref_lastfm_last_error"
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
  ,MAX_DOWNLOADS: "pref_max_downloads"
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
  ,LAST_PLAYED: "pref_last_played"
  // Podcast language index. A PID's BBC service and its feed language never change,
  // so these are written once per podcast and never expire.
  ,PODCAST_SERVICES_CACHE: "cache_podcast_services_data"
  ,PODCAST_LANGUAGES_CACHE: "cache_podcast_languages_data"
  ,FAILED_AUTO_DOWNLOADS: "pref_failed_auto_downloads"
  ,REVIEW_PROMPT_STATE: "pref_review_prompt_state"
};

/** Callbacks fired whenever an episode is marked as played. See `onEpisodePlayed`. */
const playedListeners = new Set<(episodeId: string) => void>();

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
  getLastFmRecentScrobbles(): LastFmScrobbleEntry[] {
    const raw = storage.getString(KEYS.LASTFM_RECENT_SCROBBLES);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fall back below
      }
    }
    // Check persistent storage (survives app uninstalls, reinstalls and updates)
    const persistent = readPersistentRecentScrobbles();
    if (persistent && persistent.length > 0) {
      storage.set(KEYS.LASTFM_RECENT_SCROBBLES, JSON.stringify(persistent));
      storage.set(KEYS.LASTFM_LAST_SCROBBLED, `${persistent[0].artist} - ${persistent[0].track}`);
      storage.set(KEYS.LASTFM_LAST_SCROBBLED_TIME_MS, persistent[0].timestampMs);
      return persistent;
    }
    const single = storage.getString(KEYS.LASTFM_LAST_SCROBBLED);
    if (single) {
      const stored = storage.getNumber(KEYS.LASTFM_LAST_SCROBBLED_TIME_MS);
      // Pre-4.0 installs and the Android legacy migration only persisted the
      // "artist - track" string, with no timestamp to recover. Never invent one:
      // a fabricated Date.now() renders as "Today at <now>" and shifts on every
      // read. 0 makes formatSongPlayedAt return "" so the row shows no time.
      const timeMs = typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : 0;
      const parts = single.split(" - ");
      return [{
        artist: parts[0] || "",
        track: parts.slice(1).join(" - ") || parts[0] || "",
        timestampMs: timeMs
      }];
    }
    return [];
  },

  setLastFmRecentScrobbles(entries: LastFmScrobbleEntry[]): void {
    const updated = entries.slice(0, 20);
    storage.set(KEYS.LASTFM_RECENT_SCROBBLES, JSON.stringify(updated));
    if (updated.length > 0) {
      storage.set(KEYS.LASTFM_LAST_SCROBBLED, `${updated[0].artist} - ${updated[0].track}`);
      storage.set(KEYS.LASTFM_LAST_SCROBBLED_TIME_MS, updated[0].timestampMs);
    } else {
      storage.remove(KEYS.LASTFM_LAST_SCROBBLED);
      storage.remove(KEYS.LASTFM_LAST_SCROBBLED_TIME_MS);
    }
    savePersistentRecentScrobbles(updated.slice(0, 5));
  },

  addLastFmRecentScrobble(entry: LastFmScrobbleEntry): void {
    if (!entry.artist.trim() && !entry.track.trim()) return;
    const sameTrack = (item: LastFmScrobbleEntry) =>
      item.artist.toLowerCase() === entry.artist.toLowerCase() &&
      item.track.toLowerCase() === entry.track.toLowerCase();
    // Rows recovered from the pre-4.0 single-string key carry no real time.
    // When that same track scrobbles for real, replace the row rather than
    // listing the track twice.
    const recent = this.getLastFmRecentScrobbles().filter(
      (item) => item.timestampMs > 0 || !sameTrack(item)
    );
    const isDup = recent.some(
      (item) => Math.abs(item.timestampMs - entry.timestampMs) < 60_000 && sameTrack(item)
    );
    if (isDup) return;

    const updated = [entry, ...recent].slice(0, 20);
    storage.set(KEYS.LASTFM_RECENT_SCROBBLES, JSON.stringify(updated));
    storage.set(KEYS.LASTFM_LAST_SCROBBLED, `${entry.artist} - ${entry.track}`);
    storage.set(KEYS.LASTFM_LAST_SCROBBLED_TIME_MS, entry.timestampMs);
    savePersistentRecentScrobbles(updated.slice(0, 5));
  },

  getLastFmLastScrobbled(): string {
    const recent = this.getLastFmRecentScrobbles();
    if (recent.length > 0) {
      return `${recent[0].artist} - ${recent[0].track}`;
    }
    return storage.getString(KEYS.LASTFM_LAST_SCROBBLED) || "";
  },

  setLastFmLastScrobbled(value: string): void {
    storage.set(KEYS.LASTFM_LAST_SCROBBLED, value);
    if (value) {
      const parts = value.split(" - ");
      this.addLastFmRecentScrobble({
        artist: parts[0] || "",
        track: parts.slice(1).join(" - ") || parts[0] || "",
        timestampMs: Date.now()
      });
    }
  },

  /** Scrobbles still waiting to be accepted by Last.fm. Newest first. */
  getLastFmOutbox(): QueuedScrobble[] {
    const raw = storage.getString(KEYS.LASTFM_OUTBOX);
    if (!raw) return [];
    try {
      return sanitizeScrobbleQueue(JSON.parse(raw));
    } catch {
      return [];
    }
  },

  setLastFmOutbox(queue: QueuedScrobble[]): void {
    if (queue.length === 0) {
      storage.remove(KEYS.LASTFM_OUTBOX);
      return;
    }
    storage.set(KEYS.LASTFM_OUTBOX, JSON.stringify(queue));
  },

  /** Most recent scrobble delivery failure, shown on the Last.fm settings page. */
  getLastFmLastError(): string {
    return storage.getString(KEYS.LASTFM_LAST_ERROR) || "";
  },

  setLastFmLastError(value: string): void {
    if (value) {
      storage.set(KEYS.LASTFM_LAST_ERROR, value);
    } else {
      storage.remove(KEYS.LASTFM_LAST_ERROR);
    }
  },
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
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  setFavorites(stationIds: string[]): void {
    const normalised = Array.from(new Set(stationIds.filter(Boolean)));
    storage.set(KEYS.FAVORITES, JSON.stringify(normalised));
    // Android Auto and CarPlay both read favourites from the shared auto snapshot, which
    // `autoSync` pushes on every preference change, so no platform-specific write is
    // needed here.
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

  /**
   * The most recent thing the listener started playing, or null when nothing has played yet.
   * Installs that predate this key fall back to the last station so their in-car resume is
   * unchanged.
   */
  getLastPlayed(): LastPlayed | null {
    return parseLastPlayed(storage.getString(KEYS.LAST_PLAYED), storage.getString(KEYS.LAST_STATION));
  },

  setLastPlayed(record: Omit<LastPlayed, "atMs"> & { atMs?: number }): void {
    const payload = normalizeLastPlayed(record);
    if (!payload) return;
    storage.set(KEYS.LAST_PLAYED, JSON.stringify(payload));
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

  /** Persists a minimal episode snapshot so the detail screen can open it even if it
   *  has since rotated off the RSS feed. Entries expire after 7 days. */
  setNotifiedEpisode(
    episodeId: string,
    data: { title: string; audioUrl: string; imageUrl: string; pubDate: string; durationMins: number; podcastId: string }
  ): void {
    if (!episodeId) return;
    storage.set(`pref_notified_ep_${episodeId}`, JSON.stringify({ ...data, storedAt: Date.now() }));
  },

  getNotifiedEpisode(
    episodeId: string
  ): { title: string; audioUrl: string; imageUrl: string; pubDate: string; durationMins: number; podcastId: string } | null {
    if (!episodeId) return null;
    try {
      const raw = storage.getString(`pref_notified_ep_${episodeId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { title: string; audioUrl: string; imageUrl: string; pubDate: string; durationMins: number; podcastId: string; storedAt: number };
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - (parsed.storedAt || 0) > SEVEN_DAYS) {
        storage.remove(`pref_notified_ep_${episodeId}`);
        return null;
      }
      return { title: parsed.title, audioUrl: parsed.audioUrl, imageUrl: parsed.imageUrl, pubDate: parsed.pubDate, durationMins: parsed.durationMins, podcastId: parsed.podcastId };
    } catch {
      return null;
    }
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
    // Tag lists are re-read once per row on the favourites and search screens, so the
    // parse plus the two regex filters are cached against the exact stored string.
    const cached = podcastTagsCache.get(podcastId);
    if (cached && cached.raw === raw) return cached.tags;
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        tags = parsed
          .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          .filter((tag) => !/^podcasts?$/i.test(tag.trim()));
      }
    } catch {
      tags = [];
    }
    podcastTagsCache.set(podcastId, { raw, tags });
    return tags;
  },

  setPodcastTags(podcastId: string, tags: string[]): void {
    const normalised = Array.from(
      new Set(
        tags
          .map((tag) => tag.trim())
          .filter((tag) => Boolean(tag) && !/^podcasts?$/i.test(tag))
      )
    );
    writeJson(`pref_podcast_tags_${podcastId}`, normalised);
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

  /**
   * Registers a callback fired whenever an episode is marked as played, so
   * download housekeeping can react without Preferences importing the store
   * (which would create a cycle).
   */
  onEpisodePlayed(listener: (episodeId: string) => void): () => void {
    playedListeners.add(listener);
    return () => {
      playedListeners.delete(listener);
    };
  },

  // ── Episode state (played / progress / history) ─────────────────────────────

  /**
   * Everything derived from the played-ids list, built once per actual change to it.
   *
   * `isEpisodePlayed` used to re-parse the whole list and walk every entry on each call,
   * which on the once-per-second playback path was O(episodes ever played) work per second
   * that only ever grew. `normalizeEpisodeId` is idempotent, so storing both the raw ids
   * and their normalised forms in Sets covers the previous `includes` plus
   * `normalizeEpisodeId(id) === (norm || episodeId)` scan exactly.
   */
  _playedIdCache(): {
    sourceRaw: string | undefined;
    ids: string[];
    lookup: PlayedIdLookup;
  } {
    const sourceRaw = storage.getString(KEYS.PLAYED_EPISODE_IDS);
    const cached = playedIdCache;
    if (cached && cached.sourceRaw === sourceRaw) return cached;
    const ids = readJsonArray<unknown>(KEYS.PLAYED_EPISODE_IDS).filter(
      (id): id is string => typeof id === "string"
    );
    const next = { sourceRaw, ids, lookup: createPlayedIdLookup(ids) };
    playedIdCache = next;
    return next;
  },

  getPlayedEpisodeIds(): string[] {
    return this._playedIdCache().ids;
  },

  isEpisodePlayed(episodeId: string): boolean {
    return isPlayedId(this._playedIdCache().lookup, episodeId);
  },

  /**
   * Played episode ids as a Set, so callers rendering a list can do O(1)
   * membership checks with a single MMKV read instead of one parse per row.
   */
  getPlayedEpisodeIdSet(): Set<string> {
    return new Set(this._playedIdCache().ids);
  },

  markEpisodePlayed(
    episodeId: string,
    podcastId?: string,
    pubDateEpochMs?: number,
    options?: { keepDownload?: boolean }
  ): void {
    if (!episodeId) return;
    const played = this.getPlayedEpisodeIds();
    if (!played.includes(episodeId)) {
      writeJson(KEYS.PLAYED_EPISODE_IDS, [...played, episodeId]);
    }
    this.removeEpisodeProgress(episodeId);
    if (podcastId && pubDateEpochMs && pubDateEpochMs > 0) {
      const existing = this.getLastPlayedEpoch(podcastId);
      if (pubDateEpochMs > existing) {
        writeJson(KEYS.LAST_PLAYED_EPOCH, {
          ...this.getMap(KEYS.LAST_PLAYED_EPOCH),
          [podcastId]: pubDateEpochMs
        });
      }
    }
    // `keepDownload` marks the episode played while it is still playing, so the
    // "Delete when completed" cleanup must leave the file alone until the end.
    if (!options?.keepDownload) {
      for (const listener of playedListeners) {
        try {
          listener(episodeId);
        } catch {
          // A listener must never block marking the episode as played.
        }
      }
    }
  },

  markEpisodeUnplayed(episodeId: string): void {
    writeJson(
      KEYS.PLAYED_EPISODE_IDS,
      this.getPlayedEpisodeIds().filter((id) => id !== episodeId)
    );
  },

  getEpisodeProgress(episodeId: string): number {
    return this.getMap(KEYS.EPISODE_PROGRESS)[episodeId] || this.getPodcastPosition(episodeId) || 0;
  },

  /**
   * Every episode's progress in one MMKV read, including the legacy
   * last-podcast-position fallback that `getEpisodeProgress` applies. Use this
   * when rendering a whole list instead of calling `getEpisodeProgress` per row.
   */
  getEpisodeProgressMap(): Record<string, number> {
    return mergeEpisodeProgress(
      this.getMap(KEYS.EPISODE_PROGRESS),
      this.getMap(KEYS.LAST_PODCAST_POSITIONS)
    );
  },

  setEpisodeProgress(episodeId: string, positionSeconds: number): void {
    if (!episodeId || positionSeconds <= 0) return;
    writeJson(KEYS.EPISODE_PROGRESS, {
      ...this.getMap(KEYS.EPISODE_PROGRESS),
      [episodeId]: Math.floor(positionSeconds)
    });
  },

  removeEpisodeProgress(episodeId: string): void {
    const map = this.getMap(KEYS.EPISODE_PROGRESS);
    if (map[episodeId] !== undefined) {
      const next = { ...map };
      delete next[episodeId];
      writeJson(KEYS.EPISODE_PROGRESS, next);
    }
  },

  getLastPlayedEpoch(podcastId: string): number {
    return this.getMap(KEYS.LAST_PLAYED_EPOCH)[podcastId] || 0;
  },

  setLastPlayedEpoch(podcastId: string, epochMs: number): void {
    if (!podcastId || epochMs <= 0) return;
    const map = this.getMap(KEYS.LAST_PLAYED_EPOCH);
    if (epochMs > (map[podcastId] || 0)) {
      writeJson(KEYS.LAST_PLAYED_EPOCH, { ...map, [podcastId]: epochMs });
    }
  },

  markEpisodesPlayed(episodes: { id: string; podcastId?: string; pubDateEpochMs?: number }[]): void {
    if (!episodes || episodes.length === 0) return;
    const played = new Set(this.getPlayedEpisodeIds());
    const progressMap = { ...this.getMap(KEYS.EPISODE_PROGRESS) };
    const epochMap = { ...this.getMap(KEYS.LAST_PLAYED_EPOCH) };

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

    writeJson(KEYS.PLAYED_EPISODE_IDS, Array.from(played));
    writeJson(KEYS.EPISODE_PROGRESS, progressMap);
    writeJson(KEYS.LAST_PLAYED_EPOCH, epochMap);
  },

  getPodcastEpisodeSort(podcastId: string): "newest_first" | "oldest_first" {
    const map = this.getStringMap(KEYS.EPISODE_SORT);
    return map[podcastId] === "oldest_first" ? "oldest_first" : "newest_first";
  },

  setPodcastEpisodeSort(podcastId: string, order: "newest_first" | "oldest_first"): void {
    writeJson(KEYS.EPISODE_SORT, { ...this.getStringMap(KEYS.EPISODE_SORT), [podcastId]: order });
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

  addPodcastHistory(entry: Partial<PodcastHistoryEntry> & { id: string }): void {
    if (!entry?.id) return;
    const epId = String(entry.id).trim();
    if (!epId) return;
    const existing = this.getPodcastHistory().filter((item) => item.id !== epId);
    const record: PodcastHistoryEntry = {
      id: epId,
      title: String(entry.title || "").trim(),
      description: String(entry.description || "").trim(),
      imageUrl: String(entry.imageUrl || "").trim(),
      audioUrl: String(entry.audioUrl || "").trim(),
      pubDate: String(entry.pubDate || "").trim(),
      durationMins: Number(entry.durationMins || 0),
      podcastId: String(entry.podcastId || "").trim(),
      podcastTitle: String(entry.podcastTitle || "").trim(),
      playedAtMs:
        typeof entry.playedAtMs === "number" && entry.playedAtMs > 0 ? entry.playedAtMs : Date.now()
    };
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
      if (!Array.isArray(entries)) return [];
      return entries
        .filter((entry) => entry && typeof entry.id === "string")
        .map((entry) => {
          const normId = normalizeEpisodeId(entry.id);
          return normId && normId !== entry.id ? { ...entry, id: normId } : entry;
        });
    } catch {
      return [];
    }
  },

  isEpisodeSaved(episodeId: string): boolean {
    const norm = normalizeEpisodeId(episodeId);
    return this.getPodcastPlaylistEntries("saved").some(
      (entry) => entry.id === episodeId || (norm && normalizeEpisodeId(entry.id) === norm)
    );
  },

  addPodcastPlaylistEntry(playlistId: string, entry: SavedEpisodeEntry): void {
    if (!entry?.id) return;
    const normId = normalizeEpisodeId(entry.id) || entry.id;
    const normalizedEntry: SavedEpisodeEntry = {
      ...entry,
      id: normId,
      savedAtMs: entry.savedAtMs ?? Date.now()
    };
    const all = this.getPlaylistEntryMap();
    const existing = (all[playlistId] || []).filter(
      (item) => item && item.id !== normId && normalizeEpisodeId(item.id) !== normId
    );
    const next = { ...all, [playlistId]: [normalizedEntry, ...existing] };
    writeJson(KEYS.PLAYLIST_ENTRIES, next);
    this.refreshPlaylistCounts(next);
  },

  removePodcastPlaylistEntry(playlistId: string, episodeId: string): void {
    const normId = normalizeEpisodeId(episodeId);
    const all = this.getPlaylistEntryMap();
    const next = {
      ...all,
      [playlistId]: (all[playlistId] || []).filter(
        (item) => item && item.id !== episodeId && (!normId || normalizeEpisodeId(item.id) !== normId)
      )
    };
    writeJson(KEYS.PLAYLIST_ENTRIES, next);
    this.refreshPlaylistCounts(next);
  },

  toggleSavedEpisode(entry: SavedEpisodeEntry): boolean {
    if (this.isEpisodeSaved(entry.id)) {
      this.removePodcastPlaylistEntry("saved", entry.id);
      return false;
    }
    this.addPodcastPlaylistEntry("saved", entry);
    return true;
  },

  /**
   * Startup housekeeping for the per-episode keys, which otherwise only ever grow.
   *
   * `pref_notified_ep_<id>` gets a key per notification and its seven-day expiry only ran if
   * that exact episode was read again, so nothing ever swept them and the key table grew by
   * one entry per notification for the life of the install. In `multi-process` mode every key
   * is also an entry in the interprocess lock table, so this is the part that really does get
   * expensive over time.
   *
   * Deliberately *not* swept: resume positions for episodes that were simply abandoned. They
   * are genuinely useful — someone who paused an episode expects to resume it — and with the
   * parsed-value cache plus bucketed writes, retaining them is cheap. Only positions for
   * already-played episodes are removed, which are leftovers that `markEpisodePlayed` is
   * supposed to delete anyway.
   *
   * @returns how many keys were removed
   */
pruneStalePerEpisodeKeys(): number {
    const NOTIFIED_PREFIX = "pref_notified_ep_";
    const NOTIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let removed = 0;

    for (const key of storage.getAllKeys()) {
      if (!key.startsWith(NOTIFIED_PREFIX)) continue;
      const raw = storage.getString(key);
      if (!raw) continue;
      let storedAt = 0;
      try {
        storedAt = (JSON.parse(raw) as { storedAt?: number })?.storedAt ?? 0;
      } catch {
        // Unparseable, so it cannot be judged in use. Drop it: the only writer is
        // `setNotifiedEpisode`, and the same data is recoverable from the RSS feed.
        storage.remove(key);
        removed += 1;
        continue;
      }
      if (now - storedAt > NOTIFIED_TTL_MS) {
        storage.remove(key);
        removed += 1;
      }
    }

    const played = this.getPlayedEpisodeIdSet();
    const progress = this.getMap(KEYS.EPISODE_PROGRESS);
    const staleProgress = Object.keys(progress).filter((episodeId) => {
      if (played.has(episodeId)) return true;
      const norm = normalizeEpisodeId(episodeId);
      return !!norm && played.has(norm);
    });
    if (staleProgress.length > 0) {
      const next = { ...progress };
      for (const episodeId of staleProgress) delete next[episodeId];
      writeJson(KEYS.EPISODE_PROGRESS, next);
    }

    if (removed > 0 || staleProgress.length > 0) {
      // MMKV does not shrink its file after deletes, so reclaim the space.
      storage.trim();
    }
    invalidatePreferencesCache();
    return removed + staleProgress.length;
  },

  getPlaylistEntryMap(): Record<string, SavedEpisodeEntry[]> {
    return readJsonObject<SavedEpisodeEntry[]>(KEYS.PLAYLIST_ENTRIES);
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
    return readJsonObject<DownloadedEpisodeRecord>(KEYS.DOWNLOADED_EPISODES);
  },

  getDownloadedEntry(episodeId: string): DownloadedEpisodeRecord | undefined {
    if (!episodeId) return undefined;
    const all = this.getDownloadedEntries();
    if (all[episodeId]) return all[episodeId];
    const norm = normalizeEpisodeId(episodeId);
    if (norm && all[norm]) return all[norm];
    for (const [id, rec] of Object.entries(all)) {
      if (!rec) continue;
      if (normalizeEpisodeId(id) === norm || (rec.entry?.id && normalizeEpisodeId(rec.entry.id) === norm)) {
        return rec;
      }
    }
    return undefined;
  },

  isEpisodeDownloaded(episodeId: string): boolean {
    return !!this.getDownloadedEntry(episodeId);
  },

  setDownloadedEntry(episodeId: string, record: DownloadedEpisodeRecord): void {
    if (!episodeId) return;
    const normId = normalizeEpisodeId(episodeId) || episodeId;
    const next: Record<string, DownloadedEpisodeRecord> = {};
    for (const [id, value] of Object.entries(this.getDownloadedEntries())) {
      if (id !== normId && normalizeEpisodeId(id) === normId) continue;
      next[id] = value;
    }
    next[normId] = {
      ...record,
      entry: record.entry
        ? { ...record.entry, id: normalizeEpisodeId(record.entry.id) || record.entry.id }
        : record.entry
    };
    writeJson(KEYS.DOWNLOADED_EPISODES, next);
  },

  removeDownloadedEntry(episodeId: string): void {
    const all = this.getDownloadedEntries();
    const normId = normalizeEpisodeId(episodeId);
    const next: Record<string, DownloadedEpisodeRecord> = {};
    let changed = false;
    for (const [id, value] of Object.entries(all)) {
      if (id === episodeId || (normId && normalizeEpisodeId(id) === normId)) {
        changed = true;
        continue;
      }
      next[id] = value;
    }
    if (changed) {
      writeJson(KEYS.DOWNLOADED_EPISODES, next);
    }
  },

  /** Removes every downloaded-episode record. */
  clearDownloadedEntries(): void {
    writeJson(KEYS.DOWNLOADED_EPISODES, {});
  },

  getFailedAutoDownloads(): Record<string, { timestampMs: number; count: number }> {
    return readJsonObject<{ timestampMs: number; count: number }>(KEYS.FAILED_AUTO_DOWNLOADS);
  },

  recordFailedAutoDownload(episodeId: string): void {
    if (!episodeId) return;
    const norm = normalizeEpisodeId(episodeId) || episodeId;
    const records = this.getFailedAutoDownloads();
    const existing = records[norm] || records[episodeId] || { count: 0, timestampMs: 0 };
    const next = { ...records };
    next[norm] = {
      count: existing.count + 1,
      timestampMs: Date.now()
    };
    if (episodeId !== norm) delete next[episodeId];
    writeJson(KEYS.FAILED_AUTO_DOWNLOADS, next);
  },

  clearFailedAutoDownload(episodeId: string): void {
    if (!episodeId) return;
    const norm = normalizeEpisodeId(episodeId) || episodeId;
    const records = this.getFailedAutoDownloads();
    const next = { ...records };
    let changed = false;
    for (const key of Object.keys(next)) {
      if (key === episodeId || normalizeEpisodeId(key) === norm) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) {
      writeJson(KEYS.FAILED_AUTO_DOWNLOADS, next);
    }
  },

  isAutoDownloadBlocked(episodeId: string): boolean {
    if (!episodeId) return false;
    const norm = normalizeEpisodeId(episodeId) || episodeId;
    const records = this.getFailedAutoDownloads();
    const entry = records[norm] || records[episodeId];
    if (!entry) return false;
    // Cool down for 12 hours after a failure, or 24 hours if it has failed multiple times
    const cooldownMs = entry.count >= 2 ? 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    return Date.now() - entry.timestampMs < cooldownMs;
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
    return readJsonObject<number>(key);
  },

  getStringMap(key: string): Record<string, string> {
    return readJsonObject<string>(key);
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

  // ── Podcast language index (permanent, no TTL) ──

  /** Podcast PID to its BBC service key, e.g. `radio4`, `radiocymru`. */
  getPodcastServiceMap(): Record<string, string> {
    return this.getStringMap(KEYS.PODCAST_SERVICES_CACHE);
  },

  /** Podcast PID to the `<language>` tag from its RSS feed, e.g. `cy`, `en-gb`. */
  getPodcastLanguageMap(): Record<string, string> {
    return this.getStringMap(KEYS.PODCAST_LANGUAGES_CACHE);
  },

  /**
   * @internal Merge freshly resolved service keys. Written in batches by the language
   * resolver, which resolves the whole catalogue in one pass rather than per podcast.
   */
  _mergePodcastServices(entries: Record<string, string>): void {
    if (Object.keys(entries).length === 0) return;
    writeJson(KEYS.PODCAST_SERVICES_CACHE, {
      ...this.getPodcastServiceMap(),
      ...entries
    });
  },

  /** @internal Merge freshly resolved feed language tags. Batched, like the service map. */
  _mergePodcastLanguages(entries: Record<string, string>): void {
    if (Object.keys(entries).length === 0) return;
    writeJson(KEYS.PODCAST_LANGUAGES_CACHE, {
      ...this.getPodcastLanguageMap(),
      ...entries
    });
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
        auto_download_limit: this.getSetting("pref_auto_download_limit", 1),
        download_on_wifi_only: this.getSetting("pref_download_wifi", true),
        delete_on_played: this.getSetting("pref_delete_played", false),
        max_downloaded_episodes: this.getSetting("pref_max_downloads", 0)
      },
      lastfm_prefs: {
        session_key: this.getLastFm().sessionKey,
        username: this.getLastFm().username,
        direct_scrobble_enabled: this.getLastFm().direct,
        broadcast_scrobble_enabled: this.getLastFm().broadcast,
        scrobble_podcasts: this.getLastFm().podcasts,
        recent_scrobbles: this.getLastFmRecentScrobbles().slice(0, 5),
        last_scrobbled_track: this.getLastFmLastScrobbled()
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
      if (data.lastfm) {
        if (Array.isArray(data.lastfm.recentScrobbles)) {
          this.setLastFmRecentScrobbles(data.lastfm.recentScrobbles);
        } else if (typeof data.lastfm.lastScrobbled === "string") {
          this.setLastFmLastScrobbled(data.lastfm.lastScrobbled);
        }
        if (data.lastfm.username && data.lastfm.sessionKey) {
          this.setLastFmSession(data.lastfm.username, data.lastfm.sessionKey);
        }
      }
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
        ["delete_on_played", "pref_delete_played"],
        ["max_downloaded_episodes", "pref_max_downloads"]
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

      // Last.fm preferences and scrobbles
      const lastfm = group("lastfm_prefs");
      if (Array.isArray(lastfm.recent_scrobbles)) {
        this.setLastFmRecentScrobbles(lastfm.recent_scrobbles as LastFmScrobbleEntry[]);
      } else if (typeof lastfm.last_scrobbled_track === "string" && lastfm.last_scrobbled_track.trim().length > 0) {
        this.setLastFmLastScrobbled(lastfm.last_scrobbled_track);
      }
      if (typeof lastfm.username === "string" && typeof lastfm.session_key === "string" && lastfm.session_key) {
        this.setLastFmSession(lastfm.username, lastfm.session_key);
      }
      if (typeof lastfm.direct_scrobble_enabled === "boolean") {
        this.setLastFmDirect(lastfm.direct_scrobble_enabled);
      }
      if (typeof lastfm.broadcast_scrobble_enabled === "boolean") {
        this.setLastFmBroadcast(lastfm.broadcast_scrobble_enabled);
      }
      if (typeof lastfm.scrobble_podcasts === "boolean") {
        this.setLastFmPodcasts(lastfm.scrobble_podcasts);
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
      return readJsonObject<{ average: number; count: number; mine?: number }>(
        KEYS.PODCAST_RATINGS_CACHE
      );
    } catch {
      return {};
    }
  },

  setCachedPodcastRatings(ratings: Record<string, { average: number; count: number; mine?: number }>): void {
    try {
      writeJson(KEYS.PODCAST_RATINGS_CACHE, ratings);
    } catch {}
  },

  updateCachedPodcastRating(podcastId: string, rating: { average: number; count: number; mine?: number }): void {
    try {
      this.setCachedPodcastRatings({
        ...this.getCachedPodcastRatings(),
        [podcastId]: rating
      });
    } catch {}
  },

  getReviewPromptState(): ReviewPromptState {
    const raw = storage.getString(KEYS.REVIEW_PROMPT_STATE);
    if (!raw) return { ...DEFAULT_REVIEW_PROMPT_STATE };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { ...DEFAULT_REVIEW_PROMPT_STATE };
      return {
        firstLaunchMs: typeof parsed.firstLaunchMs === "number" ? parsed.firstLaunchMs : 0,
        sessionCount: typeof parsed.sessionCount === "number" ? parsed.sessionCount : 0,
        activeDays: Array.isArray(parsed.activeDays) ? parsed.activeDays : [],
        totalListeningSeconds: typeof parsed.totalListeningSeconds === "number" ? parsed.totalListeningSeconds : 0,
        completedEpisodesCount: typeof parsed.completedEpisodesCount === "number" ? parsed.completedEpisodesCount : 0,
        lastPromptMs: typeof parsed.lastPromptMs === "number" ? parsed.lastPromptMs : 0,
        lastPromptVersion: typeof parsed.lastPromptVersion === "string" ? parsed.lastPromptVersion : "",
        promptCount: typeof parsed.promptCount === "number" ? parsed.promptCount : 0,
        hasReviewed: typeof parsed.hasReviewed === "boolean" ? parsed.hasReviewed : false
      };
    } catch {
      return { ...DEFAULT_REVIEW_PROMPT_STATE };
    }
  },

  setReviewPromptState(state: ReviewPromptState): void {
    try {
      writeJson(KEYS.REVIEW_PROMPT_STATE, state);
    } catch {}
  },
};

configureGeoBlockedStorage({
  getGeoBlocked: () => Preferences.getGeoBlocked(),
  setGeoBlocked: (val: boolean) => Preferences.setGeoBlocked(val)
});
