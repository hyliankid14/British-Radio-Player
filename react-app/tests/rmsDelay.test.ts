import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDelayedRmsTrack,
  resetStationRmsDelay,
  resolveRecentSong,
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

test("resolveDelayedRmsTrack with skipDelay=true applies fresh RMS song immediately on tune-in", () => {
  resetStationRmsDelay();

  const stationId = "radio1";
  const t0 = 1000000;

  // 1. Initial state had Song 1
  resolveDelayedRmsTrack(stationId, "Artist 1", "Track 1", "https://img/1.jpg", t0);

  // 2. Station is loaded/tuned: skipDelay=true applies Song 2 immediately with 0s delay
  const immediate = resolveDelayedRmsTrack(
    stationId,
    "Artist 2",
    "Track 2",
    "https://img/2.jpg",
    undefined,
    t0 + 1000,
    true
  );
  assert.equal(immediate.artist, "Artist 2", "Fresh check on station load must update song immediately");
  assert.equal(immediate.track, "Track 2");

  resetStationRmsDelay();
});

test("resolveRecentSong names a song using the same snapshot as its artwork", () => {
  // Regression: recent songs took the artist and track from the undelayed `raw*` fields
  // but the artwork from the delayed ones. For the ~20s after a handover that paired the
  // incoming track with the artwork of the track that was playing before it, and
  // addRecentSong never corrected the cover once the real artwork arrived.
  const song = resolveRecentSong({
    title: "BBC Radio 1",
    artist: "Artist A",
    track: "Track A",
    songImageUrl: "https://img/track-a.jpg",
    rawArtist: "Artist B",
    rawTrack: "Track B",
    rawImageUrl: "https://img/track-b.jpg"
  });

  assert.deepEqual(song, {
    artist: "Artist A",
    track: "Track A",
    imageUrl: "https://img/track-a.jpg"
  });
});

test("resolveRecentSong reports no song when metadata has none", () => {
  assert.equal(resolveRecentSong({ title: "BBC Radio 1" }), undefined);
  assert.equal(resolveRecentSong({ title: "BBC Radio 1", artist: "  ", track: "  " }), undefined);
});

test("resolveRecentSong drops placeholder artwork but keeps the song", () => {
  const song = resolveRecentSong({
    title: "BBC Radio 1",
    artist: "Artist A",
    track: "Track A",
    songImageUrl: "https://ichef.images.bbci.co.uk/p0bqcdzf/320x320.jpg"
  });

  assert.deepEqual(song, { artist: "Artist A", track: "Track A", imageUrl: "" });
});

test("resolveRecentSong drops artwork that is just the station logo", () => {
  const song = resolveRecentSong(
    {
      title: "BBC Radio 1",
      artist: "Artist A",
      track: "Track A",
      songImageUrl: "https://bbc.co.uk/services/radio1.png"
    },
    "https://bbc.co.uk/services/radio1.png"
  );

  assert.equal(song?.imageUrl, "");
});
