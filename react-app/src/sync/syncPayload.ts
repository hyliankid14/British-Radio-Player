/**
 * Pure functions for building, merging, and applying Cloud Sync payloads.
 *
 * Kept pure without native dependencies (MMKV, React Native) following
 * the watchPayload.ts pattern so it can be verified with node:test.
 */
import type { AudioQuality } from "../data/stations.ts";
import type { SavedEpisodeEntry } from "../storage/preferences.ts";
import type { CloudSyncPayload, CloudSyncData, CloudSyncPlaylist, CloudSyncPreferences } from "./syncTypes.ts";
import { mergeCloudSyncPayload } from "./smartMerge.ts";

export interface SyncPreferencesAdapter {
  getFavorites(): string[];
  setFavorites(ids: string[]): void;
  getSubscribedPodcasts(): string[];
  setSubscribedPodcasts(ids: string[]): void;
  isPodcastNotificationsEnabled(id: string): boolean;
  setPodcastNotificationsEnabled(id: string, enabled: boolean): void;
  getPodcastPlaylists(): { id: string; name: string; isDefault: boolean; itemCount: number }[];
  setPodcastPlaylists(playlists: { id: string; name: string; isDefault: boolean; itemCount: number }[]): void;
  getPlaylistEntryMap(): Record<string, SavedEpisodeEntry[]>;
  setPlaylistEntryMap(all: Record<string, SavedEpisodeEntry[]>): void;
  getPodcastPlaylistEntries(id: string): SavedEpisodeEntry[];
  getPlayedEpisodeIds(): string[];
  setPlayedEpisodeIds(ids: string[]): void;
  getEpisodeProgressMap(): Record<string, number>;
  setEpisodeProgressMap(progress: Record<string, number>): void;
  getAudioQuality(): AudioQuality;
  setAudioQuality(quality: AudioQuality): void;
  getTheme(): string;
  setTheme(theme: string): void;
  getGeoBlocked(): boolean;
  setGeoBlocked(geoBlocked: boolean): void;
  getSetting<T extends string | boolean | number>(key: string, defaultValue: T): T;
  setSetting(key: string, value: string | boolean | number): void;
}

export function buildCloudSyncPayload(
  deviceId: string,
  adapter: SyncPreferencesAdapter
): CloudSyncPayload {
  const favorites = adapter.getFavorites();
  const subscriptions = adapter.getSubscribedPodcasts();
  const subscriptionNotifications = subscriptions.filter((id) =>
    adapter.isPodcastNotificationsEnabled(id)
  );

  const playlistEntryMap = adapter.getPlaylistEntryMap();
  const savedEpisodes = adapter.getPodcastPlaylistEntries("saved");

  const playlists: CloudSyncPlaylist[] = adapter.getPodcastPlaylists()
    .filter((p) => !p.isDefault && p.id !== "saved" && p.id !== "downloaded")
    .map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: false,
      updatedAtMs: Date.now(),
      entries: playlistEntryMap[p.id] || []
    }));

  const playedEpisodeIds = adapter.getPlayedEpisodeIds();
  const episodeProgress = adapter.getEpisodeProgressMap();

  const preferences: CloudSyncPreferences = {
    audioQuality: adapter.getAudioQuality(),
    theme: adapter.getTheme(),
    geoBlocked: adapter.getGeoBlocked(),
    wifiOnlyDownloads: adapter.getSetting<boolean>("pref_download_wifi", true),
    autoDownloadEnabled: adapter.getSetting<boolean>("pref_auto_download", false),
    autoDownloadLimit: adapter.getSetting<number>("pref_auto_download_limit", 1),
    deleteOnPlayed: adapter.getSetting<boolean>("pref_delete_played", false),
    maxDownloadedEpisodes: adapter.getSetting<number>("pref_max_downloads", 0),
    autoplayNext: adapter.getSetting<string>("pref_autoplay_next", "none"),
    scrollMode: adapter.getSetting<string>("pref_scroll_mode", "all"),
    stopOnBluetoothDisconnect: adapter.getSetting<boolean>("pref_stop_bluetooth", false),
    liveRadioPauseBuffering: adapter.getSetting<boolean>("pref_pause_buffering", true),
    updatedAtMs: adapter.getSetting<number>("pref_settings_updated_at_ms", Date.now())
  };

  const data: CloudSyncData = {
    favorites,
    subscriptions,
    subscriptionNotifications,
    playlists,
    savedEpisodes,
    playedEpisodeIds,
    episodeProgress,
    preferences
  };

  return {
    version: 2,
    deviceId,
    timestampMs: Date.now(),
    data
  };
}

export function applyCloudSyncPayload(
  payload: CloudSyncPayload,
  adapter: SyncPreferencesAdapter
): void {
  if (!payload || payload.version !== 2 || !payload.data) return;

  const data = payload.data;

  // 1. Favorites
  if (Array.isArray(data.favorites)) {
    adapter.setFavorites(data.favorites);
  }

  // 2. Subscriptions & notifications
  if (Array.isArray(data.subscriptions)) {
    adapter.setSubscribedPodcasts(data.subscriptions);
    if (Array.isArray(data.subscriptionNotifications)) {
      const notifSet = new Set(data.subscriptionNotifications);
      data.subscriptions.forEach((id) => {
        adapter.setPodcastNotificationsEnabled(id, notifSet.has(id));
      });
    }
  }

  // 3. Playlists and Saved Episodes
  const currentEntries = adapter.getPlaylistEntryMap();
  const updatedEntries: typeof currentEntries = { ...currentEntries };

  if (Array.isArray(data.savedEpisodes)) {
    updatedEntries.saved = data.savedEpisodes;
  }

  if (Array.isArray(data.playlists)) {
    const existingPlaylists = adapter.getPodcastPlaylists();
    const defaults = existingPlaylists.filter((p) => p.isDefault);
    const nonDefaults = data.playlists.map((p) => {
      updatedEntries[p.id] = p.entries || [];
      return {
        id: p.id,
        name: p.name,
        isDefault: false,
        itemCount: (p.entries || []).length
      };
    });
    adapter.setPodcastPlaylists([...defaults, ...nonDefaults]);
  }

  adapter.setPlaylistEntryMap(updatedEntries);

  // 4. Played Episodes & Progress
  if (Array.isArray(data.playedEpisodeIds)) {
    adapter.setPlayedEpisodeIds(data.playedEpisodeIds);
  }
  if (data.episodeProgress && typeof data.episodeProgress === "object") {
    adapter.setEpisodeProgressMap(data.episodeProgress);
  }

  // 5. Preferences
  if (data.preferences) {
    const p = data.preferences;
    if (p.audioQuality) adapter.setAudioQuality(p.audioQuality);
    if (p.theme) adapter.setTheme(p.theme);
    if (typeof p.geoBlocked === "boolean") adapter.setGeoBlocked(p.geoBlocked);
    if (typeof p.wifiOnlyDownloads === "boolean") adapter.setSetting("pref_download_wifi", p.wifiOnlyDownloads);
    if (typeof p.autoDownloadEnabled === "boolean") adapter.setSetting("pref_auto_download", p.autoDownloadEnabled);
    if (typeof p.autoDownloadLimit === "number") adapter.setSetting("pref_auto_download_limit", p.autoDownloadLimit);
    if (typeof p.deleteOnPlayed === "boolean") adapter.setSetting("pref_delete_played", p.deleteOnPlayed);
    if (typeof p.maxDownloadedEpisodes === "number") adapter.setSetting("pref_max_downloads", p.maxDownloadedEpisodes);
    if (typeof p.autoplayNext === "string") adapter.setSetting("pref_autoplay_next", p.autoplayNext);
    if (typeof p.scrollMode === "string") adapter.setSetting("pref_scroll_mode", p.scrollMode);
    if (typeof p.stopOnBluetoothDisconnect === "boolean") adapter.setSetting("pref_stop_bluetooth", p.stopOnBluetoothDisconnect);
    if (typeof p.liveRadioPauseBuffering === "boolean") adapter.setSetting("pref_pause_buffering", p.liveRadioPauseBuffering);
    if (typeof p.updatedAtMs === "number") adapter.setSetting("pref_settings_updated_at_ms", p.updatedAtMs);
  }
}

export function mergeAndApplyCloudSync(
  remotePayload: CloudSyncPayload,
  deviceId: string,
  adapter: SyncPreferencesAdapter
): CloudSyncPayload {
  const localPayload = buildCloudSyncPayload(deviceId, adapter);
  const merged = mergeCloudSyncPayload(localPayload, remotePayload);
  applyCloudSyncPayload(merged, adapter);
  return merged;
}
