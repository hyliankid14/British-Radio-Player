import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";

mock.module("../src/storage/preferences", {
  namedExports: {
    Preferences: {
      getFavorites: mock.fn(() => []),
      getPlayedEpisodeIds: mock.fn(() => []),
      getPodcastHistory: mock.fn(() => []),
      getEpisodeProgress: mock.fn(() => 0),
      getLastFm: mock.fn(() => ({
        sessionKey: "",
        username: "",
        direct: false,
        broadcast: false,
        podcasts: false
      })),
      getSubscribedPodcasts: mock.fn(() => []),
      setFavorites: mock.fn(),
      setSubscribedPodcasts: mock.fn(),
      isEpisodePlayed: mock.fn(() => false),
      markEpisodePlayed: mock.fn()
    }
  }
});

mock.module("../src/watch/watchBridge", {
  namedExports: {
    WatchBridge: {
      isAvailable: mock.fn(() => true),
      syncState: mock.fn(() => true),
      drainReceivedState: mock.fn(() => null)
    }
  }
});

mock.module("../src/api/lastfm", {
  namedExports: {
    LASTFM_PROXY_URL: "https://proxy.example.com"
  }
});

import { pushWatchState, applyWatchState, initWatchSync } from "../src/watch/watchSync";
import { WatchBridge } from "../src/watch/watchBridge";
import { Preferences } from "../src/storage/preferences";

describe("WatchSync", () => {
  beforeEach(() => {
    (WatchBridge.syncState as any).mock.resetCalls();
    (Preferences.setFavorites as any).mock.resetCalls();
    (Preferences.setSubscribedPodcasts as any).mock.resetCalls();
    (Preferences.markEpisodePlayed as any).mock.resetCalls();
  });

  it("pushWatchState() constructs the correct payload shape", () => {
    pushWatchState();
    
    const syncCalls = (WatchBridge.syncState as any).mock.calls;
    assert.strictEqual(syncCalls.length, 1);
    
    const payloadStr = syncCalls[0].arguments[0];
    const payload = JSON.parse(payloadStr);
    
    assert.strictEqual(payload.has_subscription_snapshot, true);
    assert.strictEqual(payload.has_episode_snapshot, true);
    assert.strictEqual(payload.lastfm_proxy_url, "https://proxy.example.com");
  });

  it("applyWatchState() with { request: true } triggers pushWatchState()", () => {
    applyWatchState(JSON.stringify({ request: true }));
    
    const syncCalls = (WatchBridge.syncState as any).mock.calls;
    assert.strictEqual(syncCalls.length, 1);
  });

  it("applyWatchState() applies favourite order if present", () => {
    applyWatchState(JSON.stringify({ favourite_order: ["fav1", "fav2"] }));
    
    const favCalls = (Preferences.setFavorites as any).mock.calls;
    assert.strictEqual(favCalls.length, 1);
    assert.deepStrictEqual(favCalls[0].arguments[0], ["fav1", "fav2"]);
  });

  it("applyWatchState() skips subscription merge if has_subscription_snapshot is false", () => {
    applyWatchState(JSON.stringify({ 
      has_subscription_snapshot: false, 
      subscribed_podcast_ids: ["sub1"] 
    }));
    
    const subCalls = (Preferences.setSubscribedPodcasts as any).mock.calls;
    assert.strictEqual(subCalls.length, 0);
  });

  it("applyWatchState() marks episodes as played", () => {
    applyWatchState(JSON.stringify({ 
      has_episode_snapshot: true, 
      played_episode_ids: ["ep1"] 
    }));
    
    const playedCalls = (Preferences.markEpisodePlayed as any).mock.calls;
    assert.strictEqual(playedCalls.length, 1);
    assert.strictEqual(playedCalls[0].arguments[0], "ep1");
  });

  it("initWatchSync() is idempotent", () => {
    initWatchSync();
    initWatchSync();
    assert.ok(true); // Should not throw
  });
});
