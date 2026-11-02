import type {
  CloudSyncData,
  CloudSyncPayload,
  CloudSyncPlaylist,
  CloudSyncPreferences
} from "./syncTypes";
import type { SavedEpisodeEntry } from "../storage/preferences";

function uniqueStrings(array: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of array) {
    if (typeof item === "string" && item.trim().length > 0 && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

export function mergeFavorites(local: string[] = [], remote: string[] = []): string[] {
  return uniqueStrings([...local, ...remote]);
}

export function mergeSubscriptions(local: string[] = [], remote: string[] = []): string[] {
  return uniqueStrings([...local, ...remote]);
}

export function mergeSubscriptionNotifications(
  local: string[] = [],
  remote: string[] = [],
  validSubscriptions?: string[]
): string[] {
  const merged = uniqueStrings([...local, ...remote]);
  if (!validSubscriptions) return merged;
  const validSet = new Set(validSubscriptions);
  return merged.filter((id) => validSet.has(id));
}

function mergePlaylistEntries(
  localEntries: SavedEpisodeEntry[] = [],
  remoteEntries: SavedEpisodeEntry[] = []
): SavedEpisodeEntry[] {
  const map = new Map<string, SavedEpisodeEntry>();
  // Keep local first
  for (const entry of localEntries) {
    if (entry && typeof entry.id === "string") {
      map.set(entry.id, entry);
    }
  }
  // Append new remote entries
  for (const entry of remoteEntries) {
    if (entry && typeof entry.id === "string" && !map.has(entry.id)) {
      map.set(entry.id, entry);
    }
  }
  return Array.from(map.values());
}

export function mergePlaylists(
  local: CloudSyncPlaylist[] = [],
  remote: CloudSyncPlaylist[] = []
): CloudSyncPlaylist[] {
  const playlistMap = new Map<string, CloudSyncPlaylist>();

  for (const p of local) {
    if (p && typeof p.id === "string") {
      playlistMap.set(p.id, { ...p, entries: [...(p.entries || [])] });
    }
  }

  for (const r of remote) {
    if (!r || typeof r.id !== "string") continue;
    const existing = playlistMap.get(r.id);
    if (!existing) {
      playlistMap.set(r.id, { ...r, entries: [...(r.entries || [])] });
    } else {
      // Both exist: if remote is newer, use remote name and updatedAtMs
      const isRemoteNewer = (r.updatedAtMs || 0) > (existing.updatedAtMs || 0);
      playlistMap.set(r.id, {
        id: r.id,
        name: isRemoteNewer ? r.name : existing.name,
        isDefault: existing.isDefault || r.isDefault,
        updatedAtMs: Math.max(existing.updatedAtMs || 0, r.updatedAtMs || 0),
        entries: mergePlaylistEntries(existing.entries, r.entries)
      });
    }
  }

  return Array.from(playlistMap.values());
}

export function mergeSavedEpisodes(
  local: SavedEpisodeEntry[] = [],
  remote: SavedEpisodeEntry[] = []
): SavedEpisodeEntry[] {
  return mergePlaylistEntries(local, remote);
}

export function mergePlayedEpisodeIds(local: string[] = [], remote: string[] = []): string[] {
  return uniqueStrings([...local, ...remote]);
}

export function mergeEpisodeProgress(
  localProgress: Record<string, number> = {},
  remoteProgress: Record<string, number> = {},
  playedIds: Set<string> = new Set()
): Record<string, number> {
  const result: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(localProgress), ...Object.keys(remoteProgress)]);

  for (const id of allKeys) {
    if (playedIds.has(id)) continue;
    const localSec = typeof localProgress[id] === "number" ? localProgress[id] : 0;
    const remoteSec = typeof remoteProgress[id] === "number" ? remoteProgress[id] : 0;
    const maxSec = Math.max(localSec, remoteSec);
    if (maxSec > 0) {
      result[id] = maxSec;
    }
  }

  return result;
}

export function mergePreferences(
  local: CloudSyncPreferences,
  remote: CloudSyncPreferences
): CloudSyncPreferences {
  const localTime = local?.updatedAtMs || 0;
  const remoteTime = remote?.updatedAtMs || 0;

  if (remoteTime > localTime) {
    return {
      ...local,
      ...remote,
      updatedAtMs: remoteTime
    };
  }

  return {
    ...remote,
    ...local,
    updatedAtMs: Math.max(localTime, remoteTime)
  };
}

export function mergeCloudSyncData(
  local: CloudSyncData,
  remote: CloudSyncData
): CloudSyncData {
  const favorites = mergeFavorites(local.favorites, remote.favorites);
  const subscriptions = mergeSubscriptions(local.subscriptions, remote.subscriptions);
  const subscriptionNotifications = mergeSubscriptionNotifications(
    local.subscriptionNotifications,
    remote.subscriptionNotifications,
    subscriptions
  );
  const playlists = mergePlaylists(local.playlists, remote.playlists);
  const savedEpisodes = mergeSavedEpisodes(local.savedEpisodes, remote.savedEpisodes);
  const playedEpisodeIds = mergePlayedEpisodeIds(local.playedEpisodeIds, remote.playedEpisodeIds);
  const playedSet = new Set(playedEpisodeIds);
  const episodeProgress = mergeEpisodeProgress(
    local.episodeProgress,
    remote.episodeProgress,
    playedSet
  );
  const preferences = mergePreferences(local.preferences, remote.preferences);

  return {
    favorites,
    subscriptions,
    subscriptionNotifications,
    playlists,
    savedEpisodes,
    playedEpisodeIds,
    episodeProgress,
    preferences
  };
}

export function mergeCloudSyncPayload(
  local: CloudSyncPayload,
  remote: CloudSyncPayload
): CloudSyncPayload {
  const mergedData = mergeCloudSyncData(local.data, remote.data);
  return {
    version: 2,
    deviceId: local.deviceId || remote.deviceId,
    timestampMs: Math.max(local.timestampMs || 0, remote.timestampMs || 0, Date.now()),
    data: mergedData
  };
}
