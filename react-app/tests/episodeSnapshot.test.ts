import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_EPISODES_PER_SNAPSHOT,
  MAX_SNAPSHOT_DESCRIPTION_CHARS,
  readEpisodeSnapshot,
  shapeEpisodeSnapshot,
  type SnapshotEpisode
} from "../src/podcasts/episodeSnapshot.ts";

function episode(overrides: Partial<SnapshotEpisode> = {}): SnapshotEpisode {
  return {
    id: "ep-1",
    title: "An Episode",
    description: "A description",
    audioUrl: "https://example.com/ep-1.mp3",
    imageUrl: "https://example.com/art.jpg",
    pubDate: "Wed, 15 Oct 2025 08:00:00 GMT",
    durationMins: 30,
    podcastId: "p0000001",
    ...overrides
  };
}

// ─── Shaping ────────────────────────────────────────────────────────────────

test("a snapshot is stored newest first", () => {
  const older = episode({ id: "old", pubDate: "Mon, 13 Oct 2025 08:00:00 GMT" });
  const newer = episode({ id: "new", pubDate: "Wed, 15 Oct 2025 08:00:00 GMT" });
  const shaped = shapeEpisodeSnapshot("p1", [older, newer]);
  assert.deepEqual(shaped.map((ep) => ep.id), ["new", "old"]);
});

test("the cap keeps the newest episodes, not the first ones in the feed", () => {
  // Feeds are not reliably ordered, so truncating before sorting would keep a random slice.
  const total = MAX_EPISODES_PER_SNAPSHOT + 10;
  const episodes = Array.from({ length: total }, (_, index) =>
    episode({
      id: `ep-${index}`,
      pubDate: new Date(Date.UTC(2025, 9, 1 + index)).toUTCString()
    })
  );
  const shaped = shapeEpisodeSnapshot("p1", episodes);
  assert.equal(shaped.length, MAX_EPISODES_PER_SNAPSHOT);
  // The 10 oldest (ep-0 … ep-9) are the ones dropped.
  assert.equal(shaped[0].id, `ep-${total - 1}`);
  assert.equal(shaped[shaped.length - 1].id, "ep-10");
  assert.equal(shaped.some((ep) => ep.id === "ep-9"), false);
});

test("an undated episode sorts last rather than first", () => {
  const undated = episode({ id: "undated", pubDate: "" });
  const dated = episode({ id: "dated", pubDate: "Wed, 15 Oct 2025 08:00:00 GMT" });
  assert.deepEqual(shapeEpisodeSnapshot("p1", [undated, dated]).map((ep) => ep.id), ["dated", "undated"]);
});

test("descriptions are truncated, because they are the bulk of a feed", () => {
  const shaped = shapeEpisodeSnapshot("p1", [episode({ description: "x".repeat(5000) })]);
  assert.equal(shaped[0].description.length, MAX_SNAPSHOT_DESCRIPTION_CHARS);
});

test("a missing description becomes empty rather than undefined", () => {
  const shaped = shapeEpisodeSnapshot("p1", [episode({ description: undefined as unknown as string })]);
  assert.equal(shaped[0].description, "");
});

test("rows inherit the podcast id when the feed omits it", () => {
  const shaped = shapeEpisodeSnapshot("p1", [episode({ podcastId: "" })]);
  assert.equal(shaped[0].podcastId, "p1");
});

test("a row with no id is dropped", () => {
  const shaped = shapeEpisodeSnapshot("p1", [episode({ id: "" }), episode({ id: "keep" })]);
  assert.deepEqual(shaped.map((ep) => ep.id), ["keep"]);
});

test("a null row does not sink the snapshot", () => {
  const shaped = shapeEpisodeSnapshot("p1", [null as unknown as SnapshotEpisode, episode()]);
  assert.equal(shaped.length, 1);
});

test("an empty or absent list shapes to nothing", () => {
  assert.deepEqual(shapeEpisodeSnapshot("p1", []), []);
  assert.deepEqual(shapeEpisodeSnapshot("p1", undefined as unknown as SnapshotEpisode[]), []);
});

// ─── Reading back ───────────────────────────────────────────────────────────

test("a stored snapshot round-trips", () => {
  const stored = { fetchedAtMs: 1_700_000_000_000, episodes: [episode()] };
  const read = readEpisodeSnapshot(stored);
  assert.ok(read);
  assert.equal(read.fetchedAtMs, stored.fetchedAtMs);
  assert.equal(read.episodes.length, 1);
});

test("a snapshot with no fetch time reads as 0 so staleness treats it as unknown", () => {
  const read = readEpisodeSnapshot({ episodes: [episode()] });
  assert.equal(read?.fetchedAtMs, 0);
});

test("a snapshot with no usable episodes reads as null", () => {
  assert.equal(readEpisodeSnapshot({ fetchedAtMs: 1, episodes: [] }), null);
  assert.equal(readEpisodeSnapshot({ fetchedAtMs: 1 }), null);
  assert.equal(readEpisodeSnapshot(null), null);
  assert.equal(readEpisodeSnapshot(undefined), null);
  assert.equal(readEpisodeSnapshot("nope"), null);
  assert.equal(readEpisodeSnapshot([{ id: "ep-1" }]), null);
});

test("a stored row with no id is filtered out on read", () => {
  const read = readEpisodeSnapshot({
    fetchedAtMs: 1,
    episodes: [{ id: "" }, episode({ id: "keep" })]
  });
  assert.deepEqual(read?.episodes.map((ep) => ep.id), ["keep"]);
});
