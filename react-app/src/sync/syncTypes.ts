import type { AudioQuality } from "../data/stations";
import type { SavedEpisodeEntry } from "../storage/preferences";

export interface CloudSyncPlaylist {
  id: string;
  name: string;
  isDefault: boolean;
  updatedAtMs: number;
  entries: SavedEpisodeEntry[];
}

export interface CloudSyncPreferences {
  audioQuality?: AudioQuality;
  theme?: string;
  geoBlocked?: boolean;
  wifiOnlyDownloads?: boolean;
  autoDownloadEnabled?: boolean;
  autoDownloadLimit?: number;
  deleteOnPlayed?: boolean;
  maxDownloadedEpisodes?: number;
  autoplayNext?: string;
  scrollMode?: string;
  stopOnBluetoothDisconnect?: boolean;
  liveRadioPauseBuffering?: boolean;
  updatedAtMs: number;
}

export interface CloudSyncData {
  favorites: string[];
  subscriptions: string[];
  subscriptionNotifications: string[];
  playlists: CloudSyncPlaylist[];
  savedEpisodes: SavedEpisodeEntry[];
  playedEpisodeIds: string[];
  episodeProgress: Record<string, number>; // episodeId -> seconds
  preferences: CloudSyncPreferences;
}

export interface CloudSyncPayload {
  version: 2;
  deviceId: string;
  timestampMs: number;
  data: CloudSyncData;
}
