import test from "node:test";
import assert from "node:assert/strict";
import {
  PlaybackAnalyticsManager,
  ANALYTICS_MIN_PLAY_MS
} from "../src/analytics/playbackAnalytics.ts";
import type { PlaybackAnalyticsStorage } from "../src/analytics/playbackAnalytics.ts";

function createMockStorage(): PlaybackAnalyticsStorage & { get(): string | null } {
  let storedId: string | null = null;
  return {
    getLastTrackedAnalyticsEpisodeId: () => storedId,
    setLastTrackedAnalyticsEpisodeId: (id: string | null) => {
      storedId = id;
    },
    get: () => storedId
  };
}

interface RecordedEvent {
  event: string;
  [key: string]: any;
}

function createManagerWithMocks(initialStoredEpisodeId: string | null = null) {
  const events: RecordedEvent[] = [];
  const storage = createMockStorage();
  if (initialStoredEpisodeId) {
    storage.setLastTrackedAnalyticsEpisodeId(initialStoredEpisodeId);
  }

  const manager = new PlaybackAnalyticsManager({
    storage,
    trackStationPlay: (stationId: string, stationTitle?: string) => {
      events.push({
        event: "station_play",
        station_id: stationId,
        station_name: stationTitle
      });
    },
    trackEpisodePlay: (
      podcastId: string,
      episodeId: string,
      episodeTitle?: string,
      podcastTitle?: string
    ) => {
      events.push({
        event: "episode_play",
        podcast_id: podcastId,
        episode_id: episodeId,
        episode_title: episodeTitle,
        podcast_title: podcastTitle
      });
    }
  });

  return { manager, storage, events };
}

test("PlaybackAnalytics: station play is tracked only after >10s of continuous playback", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  try {
    const { manager, events } = createManagerWithMocks();
    manager.onStationPlaybackRequested("bbc_radio_one", "BBC Radio 1");
    manager.onPlaybackStateChanged(true);

    // After 5 seconds, should NOT be tracked yet
    t.mock.timers.tick(5000);
    assert.equal(events.length, 0);

    // After reaching ANALYTICS_MIN_PLAY_MS (10,001ms), event should be recorded
    t.mock.timers.tick(5001);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "station_play");
    assert.equal(events[0].station_id, "bbc_radio_one");
    assert.equal(events[0].station_name, "BBC Radio 1");
  } finally {
    t.mock.timers.reset();
  }
});

test("PlaybackAnalytics: station play timer is cancelled on pause and rescheduled on resume", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  try {
    const { manager, events } = createManagerWithMocks();
    manager.onStationPlaybackRequested("bbc_radio_two", "BBC Radio 2");
    manager.onPlaybackStateChanged(true);

    // Play for 6 seconds
    t.mock.timers.tick(6000);
    assert.equal(events.length, 0);

    // Pause playback
    manager.onPlaybackStateChanged(false);

    // Advance while paused - nothing should fire
    t.mock.timers.tick(20000);
    assert.equal(events.length, 0);

    // Resume playback - requires full 10,001ms continuous playback
    manager.onPlaybackStateChanged(true);
    t.mock.timers.tick(6000);
    assert.equal(events.length, 0);

    t.mock.timers.tick(4001);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "station_play");
    assert.equal(events[0].station_id, "bbc_radio_two");
  } finally {
    t.mock.timers.reset();
  }
});

test("PlaybackAnalytics: stopping playback before 10s cancels pending station play", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  try {
    const { manager, events } = createManagerWithMocks();
    manager.onStationPlaybackRequested("bbc_radio_three", "BBC Radio 3");
    manager.onPlaybackStateChanged(true);

    t.mock.timers.tick(8000);
    assert.equal(events.length, 0);

    manager.onPlaybackStopped();

    t.mock.timers.tick(15000);
    assert.equal(events.length, 0);
  } finally {
    t.mock.timers.reset();
  }
});

test("PlaybackAnalytics: episode play tracks after 10s and deduplicates subsequent resumes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  try {
    const { manager, storage, events } = createManagerWithMocks();
    // Start fresh episode (not a resume)
    manager.onEpisodePlaybackRequested("p001", "ep101", "Ep Title", "Pod Title", false);
    manager.onPlaybackStateChanged(true);

    t.mock.timers.tick(10001);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "episode_play");
    assert.equal(events[0].podcast_id, "p001");
    assert.equal(events[0].episode_id, "ep101");
    assert.equal(manager.getLastTrackedEpisodeId(), "ep101");
    assert.equal(storage.get(), "ep101");

    // Listener pauses and resumes partway through the same episode (isResume = true)
    manager.onPlaybackStateChanged(false);
    manager.onEpisodePlaybackRequested("p001", "ep101", "Ep Title", "Pod Title", true);
    manager.onPlaybackStateChanged(true);

    t.mock.timers.tick(15000);
    // Should NOT send a second event because it's deduplicated
    assert.equal(events.length, 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("PlaybackAnalytics: restarting an episode from 0 clears dedup ID and tracks again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  try {
    const { manager, events } = createManagerWithMocks();
    // First play
    manager.onEpisodePlaybackRequested("p001", "ep101", "Ep Title", "Pod Title", false);
    manager.onPlaybackStateChanged(true);
    t.mock.timers.tick(10001);
    assert.equal(events.length, 1);

    // Episode stops
    manager.onPlaybackStopped();

    // Now restart from beginning (isResume = false)
    manager.onEpisodePlaybackRequested("p001", "ep101", "Ep Title", "Pod Title", false);
    manager.onPlaybackStateChanged(true);

    t.mock.timers.tick(10001);
    // Should count as a new play
    assert.equal(events.length, 2);
  } finally {
    t.mock.timers.reset();
  }
});

test("PlaybackAnalytics: switching items cancels previous pending analytics", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  try {
    const { manager, events } = createManagerWithMocks();
    // Start station 1
    manager.onStationPlaybackRequested("station_1", "Station 1");
    manager.onPlaybackStateChanged(true);
    t.mock.timers.tick(5000);

    // Switch to station 2 after 5s
    manager.onStationPlaybackRequested("station_2", "Station 2");
    manager.onPlaybackStateChanged(true);

    // Advance 6s (11s total from start, but only 6s on station 2)
    t.mock.timers.tick(6000);
    assert.equal(events.length, 0);

    // Advance another 5s (11s on station 2)
    t.mock.timers.tick(5000);
    assert.equal(events.length, 1);
    assert.equal(events[0].station_id, "station_2");
  } finally {
    t.mock.timers.reset();
  }
});

test("PlaybackAnalytics: restoring last tracked episode ID from persistent storage prevents duplicate on cold resume", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  try {
    // Initialized with existing episode id from storage
    const { manager, events } = createManagerWithMocks("ep999");
    assert.equal(manager.getLastTrackedEpisodeId(), "ep999");

    // Resuming ep999
    manager.onEpisodePlaybackRequested("p999", "ep999", "Ep 999", "Pod 999", true);
    manager.onPlaybackStateChanged(true);
    t.mock.timers.tick(15000);

    // Deduplication should suppress the play event
    assert.equal(events.length, 0);
  } finally {
    t.mock.timers.reset();
  }
});
