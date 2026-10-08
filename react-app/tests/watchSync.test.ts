/**
 * Tests for the pure payload-building and state-merge logic in watchPayload.ts.
 *
 * Following the same pattern as preferences.test.ts: logic is tested against
 * local in-memory implementations so no native modules (MMKV, expo-file-system,
 * react-native) are loaded at all.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWatchPayload,
  mergeWatchState,
  type WatchStateSink,
  type PodcastHistoryEntry
} from "../src/watch/watchPayload.ts";

// ---------------------------------------------------------------------------
// buildWatchPayload
// ---------------------------------------------------------------------------

test("buildWatchPayload() always includes has_subscription_snapshot = true", () => {
  const payload = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: "https://proxy.example.com"
  });
  assert.equal(payload.has_subscription_snapshot, true);
  assert.equal(payload.has_episode_snapshot, true);
});

test("buildWatchPayload() copies proxy URL into payload", () => {
  const payload = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "sk", username: "user", direct: true, broadcast: false, podcasts: true },
    lastFmProxyUrl: "https://proxy.example.com"
  });
  assert.equal(payload.lastfm_proxy_url, "https://proxy.example.com");
  assert.equal(payload.lastfm_session_key, "sk");
  assert.equal(payload.lastfm_direct_enabled, true);
});

test("buildWatchPayload() mirrors favourites to both favourite_ids and favourite_order", () => {
  const favs = ["radio1", "radio2"];
  const payload = buildWatchPayload({
    favourites: favs,
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: ""
  });
  assert.deepEqual(payload.favourite_ids, favs);
  assert.deepEqual(payload.favourite_order, favs);
});

test("buildWatchPayload() converts episode progress from seconds to ms", () => {
  const payload = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [{ id: "ep1" }],
    episodeProgressSeconds: (id) => (id === "ep1" ? 90 : 0),
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: ""
  });
  const progress = JSON.parse(payload.episode_progress_json);
  assert.equal(progress["ep1"], 90 * 1000); // 90s → 90000ms
});

test("buildWatchPayload() includes scroll_mode with fallback to 'all'", () => {
  const payloadDefault = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: ""
  });
  assert.equal(payloadDefault.scroll_mode, "all");

  const payloadFavs = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: "",
    scrollMode: "favourites"
  });
  assert.equal(payloadFavs.scroll_mode, "favourites");
});

test("buildWatchPayload() includes analytics_enabled when provided", () => {
  const payloadTrue = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: "",
    analyticsEnabled: true
  });
  assert.equal(payloadTrue.analytics_enabled, true);

  const payloadFalse = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: [],
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: "",
    analyticsEnabled: false
  });
  assert.equal(payloadFalse.analytics_enabled, false);
});

test("buildWatchPayload() serializes subscribedPodcasts into subscribed_podcasts_json", () => {
  const podcasts = [
    { id: "p002w6r2", title: "Desert Island Discs", rssUrl: "https://podcasts.files.bbci.co.uk/p002w6r2.rss", imageUrl: "https://example.com/art.jpg" }
  ];
  const payload = buildWatchPayload({
    favourites: [],
    subscribedPodcastIds: ["p002w6r2"],
    subscribedPodcasts: podcasts,
    playedEpisodeIds: [],
    podcastHistory: [],
    episodeProgressSeconds: () => 0,
    lastFm: { sessionKey: "", username: "", direct: false, broadcast: false, podcasts: false },
    lastFmProxyUrl: ""
  });
  assert.ok(payload.subscribed_podcasts_json);
  const parsed = JSON.parse(payload.subscribed_podcasts_json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "Desert Island Discs");
  assert.equal(parsed[0].id, "p002w6r2");
});

// ---------------------------------------------------------------------------
// mergeWatchState — helper to create an in-memory sink
// ---------------------------------------------------------------------------

function createSink(): WatchStateSink & {
  favs: string[];
  subs: string[];
  played: Set<string>;
  progress: Map<string, number>;
  history: PodcastHistoryEntry[];
} {
  const played = new Set<string>();
  return {
    favs: [],
    subs: [],
    played,
    progress: new Map(),
    history: [],
    setFavorites(ids) { this.favs = ids; },
    setSubscribedPodcasts(ids) { this.subs = ids; },
    isEpisodePlayed(id) { return played.has(id); },
    markEpisodePlayed(id) { played.add(id); },
    markEpisodeUnplayed(id) { played.delete(id); },
    setEpisodeProgress(id, s) { this.progress.set(id, s); },
    removeEpisodeProgress(id) { this.progress.delete(id); },
    addPodcastHistory(entry) { this.history.push(entry); }
  };
}

test("mergeWatchState() returns true and triggers push on { request: true }", () => {
  const sink = createSink();
  const shouldPush = mergeWatchState({ request: true }, sink);
  assert.equal(shouldPush, true);
  assert.equal(sink.favs.length, 0); // no state applied
});

test("mergeWatchState() applies non-empty favourite_order", () => {
  const sink = createSink();
  mergeWatchState({ favourite_order: ["radio1", "radio2"] }, sink);
  assert.deepEqual(sink.favs, ["radio1", "radio2"]);
});

test("mergeWatchState() applies empty favourite_order (clears favourites)", () => {
  const sink = createSink();
  sink.favs = ["radio1"];
  mergeWatchState({ favourite_order: [] }, sink);
  assert.deepEqual(sink.favs, []);
});

test("mergeWatchState() falls back to favourite_ids if favourite_order is absent", () => {
  const sink = createSink();
  mergeWatchState({ favourite_ids: ["radio4"] }, sink);
  assert.deepEqual(sink.favs, ["radio4"]);
});

test("mergeWatchState() skips subscription merge when has_subscription_snapshot is false", () => {
  const sink = createSink();
  mergeWatchState({
    has_subscription_snapshot: false,
    subscribed_podcast_ids: ["pod1"]
  }, sink);
  assert.equal(sink.subs.length, 0);
});

test("mergeWatchState() applies subscriptions when has_subscription_snapshot is true", () => {
  const sink = createSink();
  mergeWatchState({
    has_subscription_snapshot: true,
    subscribed_podcast_ids: ["pod1", "pod2"]
  }, sink);
  assert.deepEqual(sink.subs, ["pod1", "pod2"]);
});

test("mergeWatchState() marks unplayed episodes as played", () => {
  const sink = createSink();
  mergeWatchState({
    has_episode_snapshot: true,
    played_episode_ids: ["ep1", "ep2"]
  }, sink);
  assert.ok(sink.played.has("ep1"));
  assert.ok(sink.played.has("ep2"));
});

test("mergeWatchState() does not double-mark already-played episodes", () => {
  const sink = createSink();
  sink.played.add("ep1");
  mergeWatchState({
    has_episode_snapshot: true,
    played_episode_ids: ["ep1"]
  }, sink);
  // markEpisodePlayed should not have been called (ep1 was already played)
  // The set still has ep1 but from the initial manual add, not from the merge.
  assert.ok(sink.played.has("ep1"));
});

test("mergeWatchState() saves episode progress as seconds (converts from ms)", () => {
  const sink = createSink();
  mergeWatchState({
    has_episode_snapshot: true,
    played_episode_ids: [],
    episode_progress_json: JSON.stringify({ ep3: 45000 })
  }, sink);
  assert.equal(sink.progress.get("ep3"), 45); // 45000ms → 45s
});

test("mergeWatchState() skips progress for already-played episodes", () => {
  const sink = createSink();
  sink.played.add("ep4");
  mergeWatchState({
    has_episode_snapshot: true,
    played_episode_ids: [],
    episode_progress_json: JSON.stringify({ ep4: 30000 })
  }, sink);
  assert.equal(sink.progress.has("ep4"), false);
});

test("mergeWatchState() merges podcast history", () => {
  const sink = createSink();
  mergeWatchState({
    has_episode_snapshot: true,
    played_episode_ids: [],
    history_meta_json: JSON.stringify([{ id: "ep5", title: "Episode 5" }])
  }, sink);
  assert.equal(sink.history.length, 1);
  assert.equal(sink.history[0].id, "ep5");
});

test("mergeWatchState() handles malformed episode_progress_json gracefully", () => {
  const sink = createSink();
  assert.doesNotThrow(() =>
    mergeWatchState({
      has_episode_snapshot: true,
      played_episode_ids: [],
      episode_progress_json: "INVALID"
    }, sink)
  );
});

test("mergeWatchState() returns false for normal state updates (no push needed)", () => {
  const sink = createSink();
  const shouldPush = mergeWatchState({ favourite_order: ["radio1"] }, sink);
  assert.equal(shouldPush, false);
});

test("mergeWatchState() unmarks episodes in unplayed_episode_ids", () => {
  const sink = createSink();
  sink.played.add("ep1");
  sink.played.add("ep2");
  mergeWatchState({
    unplayed_episode_ids: ["ep1"]
  }, sink);
  assert.equal(sink.played.has("ep1"), false);
  assert.equal(sink.played.has("ep2"), true);
});

test("mergeWatchState() clears episode progress when posMs is 0 or negative", () => {
  const sink = createSink();
  sink.progress.set("ep3", 45);
  mergeWatchState({
    episode_progress_json: JSON.stringify({ ep3: 0 })
  }, sink);
  assert.equal(sink.progress.has("ep3"), false);
});

test("mergeWatchState() applies progress even when played_episode_ids is omitted", () => {
  const sink = createSink();
  mergeWatchState({
    has_episode_snapshot: true,
    episode_progress_json: JSON.stringify({ ep4: 90000 })
  }, sink);
  assert.equal(sink.progress.get("ep4"), 90);
});
