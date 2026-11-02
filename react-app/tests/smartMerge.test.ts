import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeFavorites,
  mergeSubscriptions,
  mergeSubscriptionNotifications,
  mergePlaylists,
  mergeSavedEpisodes,
  mergePlayedEpisodeIds,
  mergeEpisodeProgress,
  mergePreferences,
  mergeCloudSyncData,
  mergeCloudSyncPayload
} from "../src/sync/smartMerge.ts";
import type { CloudSyncData, CloudSyncPayload, CloudSyncPlaylist, CloudSyncPreferences } from "../src/sync/syncTypes.ts";
import type { SavedEpisodeEntry } from "../src/storage/preferences.ts";

test("mergeFavorites preserves local order and appends remote additions without duplicates", () => {
  const local = ["bbc_radio_one", "bbc_radio_two", "bbc_6music"];
  const remote = ["bbc_radio_two", "bbc_radio_four", "bbc_radio_one", "bbc_1xtra"];

  const merged = mergeFavorites(local, remote);
  assert.deepEqual(merged, [
    "bbc_radio_one",
    "bbc_radio_two",
    "bbc_6music",
    "bbc_radio_four",
    "bbc_1xtra"
  ]);
});

test("mergeFavorites ignores empty or invalid strings", () => {
  const local = ["bbc_radio_one", "", "  "];
  const remote = ["", "bbc_radio_two"];

  const merged = mergeFavorites(local, remote);
  assert.deepEqual(merged, ["bbc_radio_one", "bbc_radio_two"]);
});

test("mergeSubscriptions combines subscriptions from both devices", () => {
  const local = ["p02pc9qc", "p02nrv35"];
  const remote = ["p02nrv35", "p0705299"];

  const merged = mergeSubscriptions(local, remote);
  assert.deepEqual(merged, ["p02pc9qc", "p02nrv35", "p0705299"]);
});

test("mergeSubscriptionNotifications retains notifications only for valid subscriptions", () => {
  const local = ["p02pc9qc"];
  const remote = ["p0705299", "unsubscribed_id"];
  const validSubs = ["p02pc9qc", "p0705299"];

  const merged = mergeSubscriptionNotifications(local, remote, validSubs);
  assert.deepEqual(merged, ["p02pc9qc", "p0705299"]);
});

test("mergePlaylists combines disjoint playlists and merges matching playlists", () => {
  const entryA: SavedEpisodeEntry = {
    id: "ep-1",
    title: "Ep 1",
    description: "",
    imageUrl: "",
    audioUrl: "",
    pubDate: "",
    durationMins: 30,
    podcastId: "pod-1",
    podcastTitle: "Pod 1"
  };
  const entryB: SavedEpisodeEntry = {
    id: "ep-2",
    title: "Ep 2",
    description: "",
    imageUrl: "",
    audioUrl: "",
    pubDate: "",
    durationMins: 45,
    podcastId: "pod-1",
    podcastTitle: "Pod 1"
  };

  const localPlaylists: CloudSyncPlaylist[] = [
    {
      id: "playlist-1",
      name: "Old Name",
      isDefault: false,
      updatedAtMs: 1000,
      entries: [entryA]
    },
    {
      id: "playlist-only-local",
      name: "Local Only",
      isDefault: false,
      updatedAtMs: 1500,
      entries: []
    }
  ];

  const remotePlaylists: CloudSyncPlaylist[] = [
    {
      id: "playlist-1",
      name: "Updated Name",
      isDefault: false,
      updatedAtMs: 2000, // Newer
      entries: [entryB]
    },
    {
      id: "playlist-only-remote",
      name: "Remote Only",
      isDefault: false,
      updatedAtMs: 1800,
      entries: [entryB]
    }
  ];

  const merged = mergePlaylists(localPlaylists, remotePlaylists);

  assert.equal(merged.length, 3);
  const p1 = merged.find((p) => p.id === "playlist-1");
  assert.ok(p1);
  assert.equal(p1.name, "Updated Name");
  assert.equal(p1.updatedAtMs, 2000);
  assert.equal(p1.entries.length, 2);
  assert.equal(p1.entries[0].id, "ep-1");
  assert.equal(p1.entries[1].id, "ep-2");

  assert.ok(merged.some((p) => p.id === "playlist-only-local"));
  assert.ok(merged.some((p) => p.id === "playlist-only-remote"));
});

test("mergeSavedEpisodes deduplicates by episode ID", () => {
  const entryA: SavedEpisodeEntry = {
    id: "ep-1",
    title: "Ep 1",
    description: "",
    imageUrl: "",
    audioUrl: "",
    pubDate: "",
    durationMins: 30,
    podcastId: "pod-1",
    podcastTitle: "Pod 1"
  };
  const entryB: SavedEpisodeEntry = {
    id: "ep-2",
    title: "Ep 2",
    description: "",
    imageUrl: "",
    audioUrl: "",
    pubDate: "",
    durationMins: 45,
    podcastId: "pod-1",
    podcastTitle: "Pod 1"
  };

  const merged = mergeSavedEpisodes([entryA], [entryA, entryB]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "ep-1");
  assert.equal(merged[1].id, "ep-2");
});

test("mergePlayedEpisodeIds unions played IDs", () => {
  const local = ["ep-1", "ep-2"];
  const remote = ["ep-2", "ep-3"];

  const merged = mergePlayedEpisodeIds(local, remote);
  assert.deepEqual(merged, ["ep-1", "ep-2", "ep-3"]);
});

test("mergeEpisodeProgress takes higher progress and removes played episodes", () => {
  const localProgress = {
    "ep-1": 120, // Remote has 300 -> 300
    "ep-2": 450, // Remote has 100 -> 450
    "ep-3": 60,  // Played -> should be purged
    "ep-4": 80   // Local only
  };
  const remoteProgress = {
    "ep-1": 300,
    "ep-2": 100,
    "ep-5": 200  // Remote only
  };
  const played = new Set(["ep-3"]);

  const merged = mergeEpisodeProgress(localProgress, remoteProgress, played);

  assert.equal(merged["ep-1"], 300);
  assert.equal(merged["ep-2"], 450);
  assert.equal(merged["ep-3"], undefined);
  assert.equal(merged["ep-4"], 80);
  assert.equal(merged["ep-5"], 200);
});

test("mergePreferences adopts remote when remote is newer", () => {
  const local: CloudSyncPreferences = {
    audioQuality: "HIGH",
    theme: "light",
    geoBlocked: false,
    updatedAtMs: 1000
  };
  const remote: CloudSyncPreferences = {
    audioQuality: "LOW",
    theme: "dark",
    updatedAtMs: 2000
  };

  const merged = mergePreferences(local, remote);
  assert.equal(merged.audioQuality, "LOW");
  assert.equal(merged.theme, "dark");
  assert.equal(merged.geoBlocked, false); // Preserved from local
  assert.equal(merged.updatedAtMs, 2000);
});

test("mergePreferences preserves local when local is newer", () => {
  const local: CloudSyncPreferences = {
    audioQuality: "HIGH",
    theme: "dark",
    updatedAtMs: 5000
  };
  const remote: CloudSyncPreferences = {
    audioQuality: "LOW",
    theme: "light",
    updatedAtMs: 2000
  };

  const merged = mergePreferences(local, remote);
  assert.equal(merged.audioQuality, "HIGH");
  assert.equal(merged.theme, "dark");
  assert.equal(merged.updatedAtMs, 5000);
});

test("mergeCloudSyncPayload merges complete payloads end-to-end", () => {
  const local: CloudSyncPayload = {
    version: 2,
    deviceId: "device-local",
    timestampMs: 1000,
    data: {
      favorites: ["station-a"],
      subscriptions: ["pod-1"],
      subscriptionNotifications: ["pod-1"],
      playlists: [],
      savedEpisodes: [],
      playedEpisodeIds: ["ep-1"],
      episodeProgress: { "ep-2": 100 },
      preferences: { theme: "dark", updatedAtMs: 1000 }
    }
  };

  const remote: CloudSyncPayload = {
    version: 2,
    deviceId: "device-remote",
    timestampMs: 2000,
    data: {
      favorites: ["station-b"],
      subscriptions: ["pod-2"],
      subscriptionNotifications: ["pod-2"],
      playlists: [],
      savedEpisodes: [],
      playedEpisodeIds: ["ep-3"],
      episodeProgress: { "ep-2": 250 },
      preferences: { theme: "light", updatedAtMs: 2000 }
    }
  };

  const merged = mergeCloudSyncPayload(local, remote);

  assert.equal(merged.version, 2);
  assert.ok(merged.timestampMs >= 2000);
  assert.deepEqual(merged.data.favorites, ["station-a", "station-b"]);
  assert.deepEqual(merged.data.subscriptions, ["pod-1", "pod-2"]);
  assert.deepEqual(merged.data.playedEpisodeIds, ["ep-1", "ep-3"]);
  assert.equal(merged.data.episodeProgress["ep-2"], 250);
  assert.equal(merged.data.preferences.theme, "light");
});
