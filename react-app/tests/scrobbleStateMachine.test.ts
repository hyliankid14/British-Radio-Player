import test from "node:test";
import assert from "node:assert/strict";
import {
  ScrobbleStateMachine,
  METADATA_GAP_TOLERANCE_MS,
  SCROBBLE_REARM_COOLDOWN_MS,
  SLS_STATE_START,
  SLS_STATE_PAUSE,
  SLS_STATE_RESUME,
  SLS_STATE_COMPLETE
} from "../src/audio/scrobbleStateMachine.ts";
import type {
  ScrobbleDeps,
  ScrobbleSubmission,
  ScrobbleHistoryEntry
} from "../src/audio/scrobbleStateMachine.ts";

interface Harness {
  machine: ScrobbleStateMachine;
  submitted: ScrobbleSubmission[];
  history: ScrobbleHistoryEntry[];
  broadcasts: { state: number; artist: string; track: string }[];
  nowPlaying: { artist: string; track: string }[];
  /** Moves the clock forward, firing the scrobble countdown when it comes due. */
  advance(ms: number): void;
}

function createHarness(overrides: Partial<ScrobbleDeps> = {}): Harness {
  let clock = 1_700_000_000_000;
  const submitted: ScrobbleSubmission[] = [];
  const history: ScrobbleHistoryEntry[] = [];
  const broadcasts: { state: number; artist: string; track: string }[] = [];
  const nowPlaying: { artist: string; track: string }[] = [];

  // Single-slot fake timer: the state machine only ever has one countdown armed.
  let nextHandle = 1;
  let armed: { handle: number; dueMs: number; run: () => void } | null = null;

  const advance = (ms: number): void => {
    const target = clock + ms;
    while (armed && armed.dueMs <= target) {
      clock = armed.dueMs;
      const due = armed;
      armed = null;
      due.run();
    }
    clock = target;
  };

  const deps: ScrobbleDeps = {
    now: () => clock,
    canScrobble: () => true,
    podcastsEnabled: () => true,
    broadcastEnabled: () => true,
    submit: (entry) => submitted.push(entry),
    record: (entry) => history.push(entry),
    nowPlaying: (artist, track) => nowPlaying.push({ artist, track }),
    broadcast: (state, artist, track) => broadcasts.push({ state, artist, track }),
    schedule: (run, delayMs) => {
      const handle = nextHandle++;
      armed = { handle, dueMs: clock + delayMs, run };
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle) => {
      if (armed && armed.handle === handle) armed = null;
    },
    ...overrides
  };

  return {
    machine: new ScrobbleStateMachine(deps),
    submitted,
    history,
    broadcasts,
    nowPlaying,
    advance
  };
}

test("a track reaching its threshold is scrobbled with its start timestamp", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Sun-El Musician", "Bring Me More Bass", "BBC Radio 1", 207, false);
  assert.deepEqual(h.submitted, []);

  // 207s track -> 50% = 103.5s threshold.
  h.advance(104_000);
  h.machine.onProgress(104, 207);

  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].artist, "Sun-El Musician");
  assert.equal(h.submitted[0].album, "BBC Radio 1");
  assert.equal(h.submitted[0].durationSec, 207);
  assert.equal(h.submitted[0].timestampSec, 1_700_000_000);
  assert.equal(h.history.length, 1);
});

test("a metadata gap does not restart the listen clock", () => {
  // Regression: onNoTrackPlaying used to null the active track, so the 20s handover gap
  // between every pair of tracks restarted the listen clock. Short tracks then never
  // reached their threshold and nothing was ever scrobbled.
  const h = createHarness();
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);

  h.advance(40_000);
  h.machine.onProgress(40, 120);
  assert.equal(h.submitted.length, 0, "40s into a 120s track must not scrobble");

  // Normal handover: metadata goes quiet, then the same track is reported again.
  h.advance(10_000);
  h.machine.onNoTrackPlaying();
  assert.equal(h.machine.getActiveTrack()?.metadataMissing, true);

  h.advance(10_000);
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);
  assert.equal(h.machine.getActiveTrack()?.metadataMissing, false);

  // 60s of accumulated listening survives the gap, so the 60s threshold (50% of 120s)
  // is met at 60s of real time rather than never.
  h.advance(1_000);
  h.machine.onProgress(61, 120);

  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].track, "Track A");
});

test("a track that only qualifies because of the handover gap is still scrobbled", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist B", "Track B", "BBC Radio 6 Music", 100, false);

  // 45s in, then metadata goes quiet and never returns.
  h.advance(45_000);
  h.machine.onProgress(45, 100);

  // The gap itself pushes the track past 50% of 100s.
  h.advance(10_000);
  h.machine.onNoTrackPlaying();

  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].track, "Track B");
});

test("a metadata gap longer than the tolerance retires the track without crediting it", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist C", "Track C", "BBC Radio 4", 600, false);

  // Well under the 240s cap threshold.
  h.advance(30_000);
  h.machine.onNoTrackPlaying();
  assert.notEqual(h.machine.getActiveTrack(), null);

  // Speech/news break: far past the tolerance, so the track is dropped rather than
  // credited long after it finished.
  h.advance(METADATA_GAP_TOLERANCE_MS + 10_000);
  h.machine.onNoTrackPlaying();

  assert.equal(h.machine.getActiveTrack(), null);
  assert.equal(h.submitted.length, 0);
});

test("a stale stalled track is expired by the progress tick", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist D", "Track D", "BBC Radio 3", 400, false);

  h.advance(10_000);
  h.machine.onNoTrackPlaying();
  h.advance(METADATA_GAP_TOLERANCE_MS + 5_000);
  h.machine.onProgress(400, 400);

  assert.equal(h.machine.getActiveTrack(), null);
  assert.equal(h.submitted.length, 0);
});

test("a new track still scrobbles the previous one", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist E", "Track E", "BBC Radio 2", 180, false);

  h.advance(91_000);
  h.machine.onNoTrackPlaying();
  assert.equal(h.submitted.length, 1);

  h.machine.onTrackStarted("Artist F", "Track F", "BBC Radio 2", 180, false);
  assert.equal(h.submitted.length, 1, "the previous track must not scrobble twice");
  assert.equal(h.machine.getActiveTrack()?.track, "Track F");
});

test("each track scrobbles at most once across repeated metadata and progress events", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist G", "Track G", "BBC Radio 1", 60, false);

  for (let i = 0; i < 40; i++) {
    h.advance(5_000);
    h.machine.onProgress(30 + i, 60);
    h.machine.onNoTrackPlaying();
    h.machine.onTrackStarted("Artist G", "Track G", "BBC Radio 1", 60, false);
  }

  assert.equal(h.submitted.length, 1);
});

test("pause accumulates listening and resume does not double count it", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist H", "Track H", "BBC Radio 1", 200, false);

  h.advance(40_000);
  h.machine.onPlaybackPaused();

  // Time spent paused must not count towards the threshold.
  h.advance(300_000);
  h.machine.onPlaybackResumed();
  h.advance(61_000);
  h.machine.onProgress(101, 200);

  assert.equal(h.submitted.length, 1);
  assert.deepEqual(h.broadcasts.map((b) => b.state), [
    SLS_STATE_START,
    SLS_STATE_PAUSE,
    SLS_STATE_RESUME
  ]);
});

test("stopping playback mid-track settles the clock and clears state", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist I", "Track I", "BBC Radio 1", 200, false);

  h.advance(40_000);
  h.machine.onPlaybackStopped();
  assert.equal(h.submitted.length, 0);
  assert.equal(h.machine.getActiveTrack(), null);
  assert.deepEqual(h.broadcasts.map((b) => b.state), [SLS_STATE_START, SLS_STATE_COMPLETE]);

  // A later resume must not resurrect the finished track.
  h.advance(500_000);
  h.machine.onPlaybackResumed();
  assert.equal(h.submitted.length, 0);
});

test("scrobbles are queued even when direct delivery is off", () => {
  const h = createHarness({ canScrobble: () => false });
  h.machine.onTrackStarted("Artist J", "Track J", "BBC Radio 1", 60, false);
  h.advance(31_000);
  h.machine.onProgress(31, 60);

  assert.equal(h.submitted.length, 1, "the outbox holds it until the session exists");
  assert.equal(h.history.length, 1);
  assert.deepEqual(h.nowPlaying, []);
});

test("podcasts are skipped unless enabled", () => {
  const h = createHarness({ podcastsEnabled: () => false });
  h.machine.onTrackStarted("Podcast Host", "Episode 12", "Some Podcast", 1800, true);
  h.advance(960_000);
  h.machine.onProgress(960, 1800);

  assert.equal(h.submitted.length, 0);
  assert.equal(h.machine.getActiveTrack(), null);
});

test("blank metadata is treated as no track rather than an unknown artist", () => {
  const h = createHarness();
  h.machine.onTrackStarted("   ", "   ", "BBC Radio 1", 0, false);
  assert.equal(h.machine.getActiveTrack(), null);
  assert.equal(h.submitted.length, 0);
});

test("broadcasts are suppressed when external scrobblers are disabled", () => {
  const h = createHarness({ broadcastEnabled: () => false });
  h.machine.onTrackStarted("Artist K", "Track K", "BBC Radio 1", 60, false);
  h.advance(31_000);
  h.machine.onProgress(31, 60);
  h.machine.onPlaybackStopped();

  assert.deepEqual(h.broadcasts, []);
  assert.equal(h.submitted.length, 1, "direct scrobbling is independent of broadcasts");
});

test("a fractional duration is rounded to whole seconds before it is submitted", () => {
  // Regression: the signing proxy validates `duration` as an integer and answers a
  // fractional value with a 400, which the outbox treats as permanent. Podcast feeds
  // report lengths in minutes, so `durationMins * 60` was routinely fractional.
  const h = createHarness();
  h.machine.onTrackStarted("Podcast Host", "Episode 3", "Some Podcast", 2599.9998, true);

  assert.equal(h.machine.getActiveTrack()?.durationSec, 2600);
  assert.equal(h.nowPlaying[0].artist, "Podcast Host");

  h.advance(1_300_000);
  h.machine.onProgress(1300, 2599.9998);
  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].durationSec, 2600);
  assert.equal(Number.isInteger(h.submitted[0].durationSec), true);
});

test("a fractional duration learned from the progress tick is rounded too", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 0, false);
  assert.equal(h.machine.getActiveTrack()?.durationSec, 0);

  h.advance(5_000);
  h.machine.onProgress(5, 180.5);
  assert.equal(h.machine.getActiveTrack()?.durationSec, 181);
});

test("a song is not credited twice when its metadata returns after a long gap", () => {
  // Regression: a gap longer than the tolerance retires the active track. When RMS then
  // recovered and reported the same song again, onTrackStarted found no active track and
  // began a brand new listen clock, so the track scrobbled a second time with a start time
  // taken from the recovery instead of from when the song actually began.
  const h = createHarness();
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);

  // Credit it.
  h.advance(61_000);
  h.machine.onProgress(61, 120);
  assert.equal(h.submitted.length, 1);
  const firstTimestamp = h.submitted[0].timestampSec;

  // Metadata goes quiet, and stays quiet past the gap tolerance.
  h.advance(5_000);
  h.machine.onNoTrackPlaying();
  h.advance(METADATA_GAP_TOLERANCE_MS + 5_000);
  h.machine.onNoTrackPlaying();
  assert.equal(h.machine.getActiveTrack(), null, "the stalled track was retired");

  // The same song is reported again by recovering metadata.
  h.advance(1_000);
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);
  assert.equal(h.machine.getActiveTrack(), null, "the echo is not armed as a new listen");

  h.advance(120_000);
  h.machine.onProgress(180, 120);

  assert.equal(h.submitted.length, 1, "the song is credited once");
  assert.equal(h.submitted[0].timestampSec, firstTimestamp, "at the time it actually began");
});

test("a stopped song is not re-armed inside the cooldown, but is afterwards", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);
  h.advance(61_000);
  h.machine.onProgress(61, 120);
  assert.equal(h.submitted.length, 1);

  // Playback stops, which clears the active slot.
  h.machine.onPlaybackStopped();
  assert.equal(h.machine.getActiveTrack(), null);

  // Restarting the same song straight away is a re-arm of what was just credited.
  h.advance(1_000);
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);
  assert.equal(h.machine.getActiveTrack(), null, "not armed again inside the cooldown");

  h.advance(61_000);
  h.machine.onProgress(61, 120);
  assert.equal(h.submitted.length, 1, "still credited once");

  // Once the cooldown has passed it is treated as a genuine new listen.
  h.advance(SCROBBLE_REARM_COOLDOWN_MS + 1_000);
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);
  assert.notEqual(h.machine.getActiveTrack(), null, "a genuine later play still counts");

  h.advance(61_000);
  h.machine.onProgress(61, 120);
  assert.equal(h.submitted.length, 2);
});

test("a different song during the cooldown is still credited", () => {
  const h = createHarness();
  h.machine.onTrackStarted("Artist A", "Track A", "BBC Radio 1", 120, false);
  h.advance(61_000);
  h.machine.onProgress(61, 120);
  assert.equal(h.submitted.length, 1);

  h.advance(30_000);
  h.machine.onTrackStarted("Artist B", "Track B", "BBC Radio 1", 120, false);
  h.advance(61_000);
  h.machine.onProgress(61, 120);

  assert.equal(h.submitted.length, 2);
  assert.equal(h.submitted[1].track, "Track B");
});
