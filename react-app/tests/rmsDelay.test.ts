import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDelayedRmsTrack,
  resetStationRmsDelay,
  RMS_DELAY_MS
} from "../src/api/showInfo.ts";

test("resolveDelayedRmsTrack delays song change by exactly 20 seconds", () => {
  resetStationRmsDelay();

  const stationId = "radio1";
  const t0 = 1000000;

  // 1. Initial tune-in: Song 1 is already playing on air
  const initial = resolveDelayedRmsTrack(stationId, "Artist 1", "Track 1", "https://img/1.jpg", t0);
  assert.equal(initial.artist, "Artist 1");
  assert.equal(initial.track, "Track 1");

  // 2. 5 seconds later, RMS reports Song 2 has started in the studio
  const t1 = t0 + 5000;
  const pending = resolveDelayedRmsTrack(stationId, "Artist 2", "Track 2", "https://img/2.jpg", t1);
  // Because of audio stream buffer latency, user is still hearing Song 1, so Song 1 must still be returned
  assert.equal(pending.artist, "Artist 1", "Should still show previous song during delay period");
  assert.equal(pending.track, "Track 1");

  // 3. 15 seconds after change (20s since t0, but only 15s after Song 2 started)
  const t2 = t1 + 15000;
  const stillPending = resolveDelayedRmsTrack(stationId, "Artist 2", "Track 2", "https://img/2.jpg", t2);
  assert.equal(stillPending.artist, "Artist 1", "Should still show previous song at 15s after change");

  // 4. Exactly 20 seconds after Song 2 started (t1 + 20_000)
  const t3 = t1 + RMS_DELAY_MS;
  const promoted = resolveDelayedRmsTrack(stationId, "Artist 2", "Track 2", "https://img/2.jpg", t3);
  assert.equal(promoted.artist, "Artist 2", "Should promote to Song 2 after 20 seconds");
  assert.equal(promoted.track, "Track 2");

  // 5. Song 2 ends and presenter talks (track is now undefined)
  const t4 = t3 + 60000;
  const presenterSpeech = resolveDelayedRmsTrack(stationId, undefined, undefined, undefined, t4);
  // Should still show Song 2 for 20 seconds while Song 2 finishes on the stream
  assert.equal(presenterSpeech.artist, "Artist 2");
  assert.equal(presenterSpeech.track, "Track 2");

  // 6. 20 seconds after Song 2 ended
  const t5 = t4 + RMS_DELAY_MS;
  const cleared = resolveDelayedRmsTrack(stationId, undefined, undefined, undefined, t5);
  assert.equal(cleared.artist, undefined);
  assert.equal(cleared.track, undefined);

  resetStationRmsDelay();
});
