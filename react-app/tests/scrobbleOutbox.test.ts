import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueScrobble,
  isStaleScrobble,
  sanitizeScrobbleQueue,
  scrobbleKey,
  SCROBBLE_DEDUP_WINDOW_MS,
  SCROBBLE_QUEUE_LIMIT
} from "../src/audio/scrobbleQueue.ts";
import type { QueuedScrobble } from "../src/audio/scrobbleQueue.ts";

const NOW_SEC = 1_700_000_000;
const entry = (
  artist: string,
  track: string,
  timestampSec = NOW_SEC,
  extra: Partial<QueuedScrobble> = {}
): QueuedScrobble => ({
  artist,
  track,
  album: "BBC Radio 1",
  durationSec: 207,
  timestampSec,
  ...extra
});

test("a scrobble is prepended so the newest is delivered first", () => {
  let queue: QueuedScrobble[] = [];
  queue = enqueueScrobble(queue, entry("Artist A", "Track A"));
  queue = enqueueScrobble(queue, entry("Artist B", "Track B"));

  assert.deepEqual(queue.map((q) => q.track), ["Track B", "Track A"]);
});

test("the queue is a no-op when the entry is a replay within the dedup window", () => {
  const original = [entry("Artist A", "Track A")];
  const result = enqueueScrobble(original, entry("Artist A", "Track A", NOW_SEC + 30));

  assert.equal(result, original, "the same array is returned when nothing changed");
  assert.equal(result.length, 1);
});

test("dedup is case and whitespace insensitive on artist and track", () => {
  const original = [entry("Sun-El Musician", "Bring Me More Bass")];
  assert.equal(
    enqueueScrobble(original, entry("  sun-el musician ", "BRING ME MORE BASS", NOW_SEC + 5)),
    original
  );
});

test("the same song at a later listen is queued rather than collapsed", () => {
  const original = [entry("Artist A", "Track A")];
  // 5 minutes later is a genuine repeat, well outside the dedup window.
  assert.notEqual(enqueueScrobble(original, entry("Artist A", "Track A", NOW_SEC + 300)), original);
});

test("a different song is never treated as a duplicate", () => {
  const original = [entry("Artist A", "Track A")];
  assert.notEqual(enqueueScrobble(original, entry("Artist A", "Track B")), original);
  assert.notEqual(enqueueScrobble(original, entry("Artist B", "Track A")), original);
});

test("the queue is bounded so an offline stretch cannot grow without limit", () => {
  let queue: QueuedScrobble[] = [];
  for (let i = 0; i < SCROBBLE_QUEUE_LIMIT + 25; i++) {
    queue = enqueueScrobble(queue, entry(`Artist ${i}`, `Track ${i}`, NOW_SEC + i * 600));
  }

  assert.equal(queue.length, SCROBBLE_QUEUE_LIMIT);
  // Newest kept, oldest evicted.
  assert.equal(queue[0].track, `Track ${SCROBBLE_QUEUE_LIMIT + 24}`);
  assert.equal(queue[queue.length - 1].track, `Track ${25}`);
});

test("dedup window is one minute of wall clock, not seconds of track time", () => {
  const justInside = SCROBBLE_DEDUP_WINDOW_MS / 1000 - 1;
  const justOutside = SCROBBLE_DEDUP_WINDOW_MS / 1000 + 1;
  const original = [entry("Artist A", "Track A")];

  assert.equal(enqueueScrobble(original, entry("Artist A", "Track A", NOW_SEC + justInside)), original);
  assert.notEqual(
    enqueueScrobble(original, entry("Artist A", "Track A", NOW_SEC + justOutside)),
    original
  );
});

test("scrobbles older than the retention window are reported as stale", () => {
  const maxAgeMs = 14 * 24 * 60 * 60_000;
  const nowMs = NOW_SEC * 1000;

  assert.equal(isStaleScrobble(entry("Artist A", "Track A"), nowMs, maxAgeMs), false);
  assert.equal(
    isStaleScrobble(entry("Artist A", "Track A", NOW_SEC - 60 * 60 * 24 * 15), nowMs, maxAgeMs),
    true
  );
});

test("a clock skew that puts the timestamp in the future is not treated as stale", () => {
  assert.equal(isStaleScrobble(entry("Artist A", "Track A", NOW_SEC + 3600), NOW_SEC * 1000, 1000), false);
});

test("scrobbleKey folds case and padding but keeps artist and track distinct", () => {
  assert.equal(scrobbleKey(entry("AB", "C")), scrobbleKey(entry("ab", "c", NOW_SEC + 999)));
  assert.equal(scrobbleKey(entry(" AB ", " C ")), scrobbleKey(entry("ab", "c")));
  // "AB" + "C" must not collide with "A" + "BC".
  assert.notEqual(scrobbleKey(entry("AB", "C")), scrobbleKey(entry("A", "BC")));
});

test("sanitizeScrobbleQueue discards anything that is not a usable scrobble", () => {
  assert.deepEqual(sanitizeScrobbleQueue(null), []);
  assert.deepEqual(sanitizeScrobbleQueue({}), []);
  assert.deepEqual(sanitizeScrobbleQueue("[]"), []);
  assert.deepEqual(
    sanitizeScrobbleQueue([null, 7, "x", { artist: "A" }, { artist: "A", track: "B" }]),
    []
  );

  const valid = entry("Artist A", "Track A");
  assert.deepEqual(sanitizeScrobbleQueue([valid]), [valid]);
});

test("sanitizeScrobbleQueue drops entries with an unusable timestamp", () => {
  const queue = sanitizeScrobbleQueue([
    { artist: "A", track: "B", timestampSec: Number.NaN },
    { artist: "A", track: "B", timestampSec: Number.POSITIVE_INFINITY },
    { artist: "A", track: "B" },
    { artist: "A", track: "B", timestampSec: NOW_SEC }
  ]);

  assert.equal(queue.length, 1);
  assert.equal(queue[0].timestampSec, NOW_SEC);
});
