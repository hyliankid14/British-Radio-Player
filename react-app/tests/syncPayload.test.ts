import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCloudSyncPayload,
  applyCloudSyncPayload,
  mergeAndApplyCloudSync,
  type SyncPreferencesAdapter
} from "../src/sync/syncPayload.ts";
import type { AudioQuality } from "../src/data/stations.ts";
import type { SavedEpisodeEntry } from "../src/storage/preferences.ts";

function createMockAdapter(): SyncPreferencesAdapter {
  let favorites: string[] = [];
  let subscriptions: string[] = [];
  const notifications = new Set<string>();
  let playlists: { id: string; name: string; isDefault: boolean; itemCount: number }[] = [
    { id: "saved", name: "Saved Episodes", isDefault: true, itemCount: 0 },
    { id: "downloaded", name: "Downloaded Files", isDefault: true, itemCount: 0 }
  ];
  let playlistEntries: Record<string, SavedEpisodeEntry[]> = { saved: [] };
  let playedEpisodeIds: string[] = [];
  let episodeProgress: Record<string, number> = {};
  let audioQuality: AudioQuality = "HIGH";
  let theme = "system";
  let geoBlocked = false;
  const settings = new Map<string, any>();

  return {
    getFavorites: () => [...favorites],
    setFavorites: (ids) => { favorites = [...ids]; },
    getSubscribedPodcasts: () => [...subscriptions],
    setSubscribedPodcasts: (ids) => { subscriptions = [...ids]; },
    isPodcastNotificationsEnabled: (id) => notifications.has(id),
    setPodcastNotificationsEnabled: (id, enabled) => {
      if (enabled) notifications.add(id);
      else notifications.delete(id);
    },
    getPodcastPlaylists: () => [...playlists],
    setPodcastPlaylists: (p) => { playlists = [...p]; },
    getPlaylistEntryMap: () => ({ ...playlistEntries }),
    setPlaylistEntryMap: (all) => {
      playlistEntries = { ...all };
      playlists = playlists.map((p) => ({
        ...p,
        itemCount: (all[p.id] || []).length
      }));
    },
    getPodcastPlaylistEntries: (id) => playlistEntries[id] || [],
    getPlayedEpisodeIds: () => [...playedEpisodeIds],
    setPlayedEpisodeIds: (ids) => { playedEpisodeIds = [...ids]; },
    getEpisodeProgressMap: () => ({ ...episodeProgress }),
    setEpisodeProgressMap: (p) => { episodeProgress = { ...p }; },
    getAudioQuality: () => audioQuality,
    setAudioQuality: (q) => { audioQuality = q; },
    getTheme: () => theme,
    setTheme: (t) => { theme = t; },
    getGeoBlocked: () => geoBlocked,
    setGeoBlocked: (g) => { geoBlocked = g; },
    getSetting: <T extends string | boolean | number>(key: string, defaultValue: T): T => {
      return (settings.has(key) ? settings.get(key) : defaultValue) as T;
    },
    setSetting: (key, val) => { settings.set(key, val); }
  };
}

test("buildCloudSyncPayload captures complete local state", () => {
  const adapter = createMockAdapter();
  adapter.setFavorites(["bbc_radio_one"]);
  adapter.setSubscribedPodcasts(["pod-123"]);
  adapter.setPodcastNotificationsEnabled("pod-123", true);
  adapter.setAudioQuality("MEDIUM");

  const payload = buildCloudSyncPayload("phone-1", adapter);

  assert.equal(payload.version, 2);
  assert.equal(payload.deviceId, "phone-1");
  assert.deepEqual(payload.data.favorites, ["bbc_radio_one"]);
  assert.deepEqual(payload.data.subscriptions, ["pod-123"]);
  assert.deepEqual(payload.data.subscriptionNotifications, ["pod-123"]);
  assert.equal(payload.data.preferences.audioQuality, "MEDIUM");
});

test("applyCloudSyncPayload restores state to adapter", () => {
  const adapter = createMockAdapter();
  const payload = {
    version: 2 as const,
    deviceId: "remote-device",
    timestampMs: 5000,
    data: {
      favorites: ["bbc_6music"],
      subscriptions: ["pod-news"],
      subscriptionNotifications: ["pod-news"],
      playlists: [
        {
          id: "custom-1",
          name: "Commute",
          isDefault: false,
          updatedAtMs: 5000,
          entries: [
            {
              id: "ep-1",
              title: "Daily",
              description: "",
              imageUrl: "",
              audioUrl: "",
              pubDate: "",
              durationMins: 20,
              podcastId: "pod-news",
              podcastTitle: "News"
            }
          ]
        }
      ],
      savedEpisodes: [],
      playedEpisodeIds: ["ep-played"],
      episodeProgress: { "ep-prog": 500 },
      preferences: {
        audioQuality: "LOW" as AudioQuality,
        theme: "dark",
        updatedAtMs: 5000
      }
    }
  };

  applyCloudSyncPayload(payload, adapter);

  assert.deepEqual(adapter.getFavorites(), ["bbc_6music"]);
  assert.deepEqual(adapter.getSubscribedPodcasts(), ["pod-news"]);
  assert.equal(adapter.isPodcastNotificationsEnabled("pod-news"), true);
  assert.equal(adapter.getAudioQuality(), "LOW");
  assert.equal(adapter.getTheme(), "dark");
  assert.deepEqual(adapter.getPlayedEpisodeIds(), ["ep-played"]);
  assert.equal(adapter.getEpisodeProgressMap()["ep-prog"], 500);

  const playlists = adapter.getPodcastPlaylists();
  const custom = playlists.find((p) => p.id === "custom-1");
  assert.ok(custom);
  assert.equal(custom.name, "Commute");
  assert.equal(custom.itemCount, 1);
});

test("mergeAndApplyCloudSync merges remote into local state and applies result", () => {
  const adapter = createMockAdapter();
  adapter.setFavorites(["bbc_radio_one"]);
  adapter.setSubscribedPodcasts(["pod-local"]);

  const remotePayload = {
    version: 2 as const,
    deviceId: "remote-device",
    timestampMs: Date.now(),
    data: {
      favorites: ["bbc_radio_two"],
      subscriptions: ["pod-remote"],
      subscriptionNotifications: [],
      playlists: [],
      savedEpisodes: [],
      playedEpisodeIds: [],
      episodeProgress: {},
      preferences: {
        theme: "dark",
        updatedAtMs: Date.now() + 1000
      }
    }
  };

  mergeAndApplyCloudSync(remotePayload, "local-device", adapter);

  assert.deepEqual(adapter.getFavorites(), ["bbc_radio_one", "bbc_radio_two"]);
  assert.deepEqual(adapter.getSubscribedPodcasts(), ["pod-local", "pod-remote"]);
  assert.equal(adapter.getTheme(), "dark");
});
