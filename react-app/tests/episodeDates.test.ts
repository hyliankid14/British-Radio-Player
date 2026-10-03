import test from "node:test";
import assert from "node:assert/strict";

import {
  parseEpisodeDateEpoch,
  latestEpisodeEpoch,
  byNewestFirst,
  byEpisodePubDate,
  byEpisodePubDateOldest,
  mergeLatestEpisodeDates
} from "../src/podcasts/episodeDates.ts";

test("parseEpisodeDateEpoch reads RFC 2822 feed dates", () => {
  assert.equal(
    parseEpisodeDateEpoch("Fri, 02 Oct 2026 14:19:00 +0000"),
    Date.parse("Fri, 02 Oct 2026 14:19:00 +0000")
  );
  assert.equal(parseEpisodeDateEpoch("Wed, 13 Feb 2019 12:00:00 +0000") < Date.now(), true);
});

test("parseEpisodeDateEpoch collapses unusable dates to 0", () => {
  for (const bad of [undefined, "", "not a date", "   "]) {
    assert.equal(parseEpisodeDateEpoch(bad), 0, JSON.stringify(bad));
  }
});

test("latestEpisodeEpoch takes the max, not the first entry", () => {
  const dates = [
    "Wed, 13 Feb 2019 12:00:00 +0000",
    "Fri, 02 Oct 2026 14:19:00 +0000",
    "Tue, 04 Mar 2025 09:00:00 +0000"
  ];
  assert.equal(
    latestEpisodeEpoch(dates),
    Date.parse("Fri, 02 Oct 2026 14:19:00 +0000")
  );
});

test("latestEpisodeEpoch returns 0 when nothing carries a usable date", () => {
  assert.equal(latestEpisodeEpoch([]), 0);
  assert.equal(latestEpisodeEpoch(["", "nonsense", undefined]), 0);
});

test("byNewestFirst orders newest first and pushes undated entries last", () => {
  const entries = [
    { id: "old", ms: Date.parse("Wed, 13 Feb 2019 12:00:00 +0000") },
    { id: "undated", ms: 0 },
    { id: "new", ms: Date.parse("Fri, 02 Oct 2026 14:19:00 +0000") },
    { id: "mid", ms: Date.parse("Tue, 04 Mar 2025 09:00:00 +0000") }
  ];
  const sorted = [...entries].sort(byNewestFirst((e) => e.ms)).map((e) => e.id);
  assert.deepEqual(sorted, ["new", "mid", "old", "undated"]);
});

test("byNewestFirst keeps undated entries in a stable relative order", () => {
  const sorted = [
    { id: "a", ms: 0 },
    { id: "b", ms: 0 },
    { id: "c", ms: 5 }
  ]
    .sort(byNewestFirst((e) => e.ms))
    .map((e) => e.id);
  assert.deepEqual(sorted, ["c", "a", "b"]);
});

test("byEpisodePubDate sorts undated episodes last rather than first", () => {
  // The regression the shared helper exists to prevent: a bare descending compare puts
  // 0 (no usable date) at the top, so an undated episode led a "latest" list.
  const episodes = [
    { id: "undated" },
    { id: "stale", pubDate: "Wed, 13 Feb 2019 12:00:00 +0000" },
    { id: "fresh", pubDate: "Fri, 02 Oct 2026 14:19:00 +0000" }
  ];
  const sorted = [...episodes].sort(byEpisodePubDate).map((e) => e.id);
  assert.deepEqual(sorted, ["fresh", "stale", "undated"]);
});

test("byEpisodePubDate does not mutate its input", () => {
  const episodes = [
    { id: "b", pubDate: "Wed, 13 Feb 2019 12:00:00 +0000" },
    { id: "a", pubDate: "Fri, 02 Oct 2026 14:19:00 +0000" }
  ];
  const before = episodes.map((e) => e.id);
  [...episodes].sort(byEpisodePubDate);
  assert.deepEqual(episodes.map((e) => e.id), before);
});

test("byEpisodePubDateOldest keeps undated entries last, not first", () => {
  // The trap: expressing oldest-first as byEpisodePubDate(b, a) reverses the undated
  // handling too, hoisting undated entries to the top of an oldest-first list.
  const episodes = [
    { id: "undated" },
    { id: "fresh", pubDate: "Fri, 02 Oct 2026 14:19:00 +0000" },
    { id: "stale", pubDate: "Wed, 13 Feb 2019 12:00:00 +0000" }
  ];
  const sorted = [...episodes].sort(byEpisodePubDateOldest).map((e) => e.id);
  assert.deepEqual(sorted, ["stale", "fresh", "undated"]);
});

test("byEpisodePubDateOldest does not mutate its input", () => {
  const episodes = [
    { id: "b", pubDate: "Wed, 13 Feb 2019 12:00:00 +0000" },
    { id: "a", pubDate: "Fri, 02 Oct 2026 14:19:00 +0000" }
  ];
  [...episodes].sort(byEpisodePubDateOldest);
  assert.deepEqual(episodes.map((e) => e.id), ["b", "a"]);
});

test("mergeLatestEpisodeDates only ever raises a stored date", () => {
  const current: Record<string, number> = { p002vsnk: 2000, p055260j: 1000 };
  mergeLatestEpisodeDates(current, { p002vsnk: 1500, p055260j: 5000, p05527ds: 3000 });
  // A stale re-read cannot demote; a fresher read wins; a new podcast is added.
  assert.deepEqual(current, { p002vsnk: 2000, p055260j: 5000, p05527ds: 3000 });
});

test("mergeLatestEpisodeDates ignores unusable timestamps", () => {
  const current: Record<string, number> = { p002vsnk: 2000 };
  mergeLatestEpisodeDates(current, {
    bad: 0,
    negative: -5,
    notFinite: Number.NaN,
    infinite: Number.POSITIVE_INFINITY,
    p002vsnk: 900
  });
  assert.deepEqual(current, { p002vsnk: 2000 });
});

test("mergeLatestEpisodeDates returns the same map it was given", () => {
  const current: Record<string, number> = {};
  assert.equal(mergeLatestEpisodeDates(current, { p1: 10 }), current);
});

test("the dormant Hindi shows rank below a current feed", () => {
  // Real pubDates read from the live feeds behind the "Last Updated" regression.
  const shows = [
    { id: "p0fmrg25", pubDate: "Wed, 05 Jul 2023 04:00:00 +0000" },
    { id: "p055260j", pubDate: "Wed, 28 Sep 2022 12:30:00 +0000" },
    { id: "p05527ds", pubDate: "Wed, 13 Feb 2019 12:00:00 +0000" },
    { id: "p002vsnk", pubDate: "Fri, 02 Oct 2026 14:19:00 +0000" }
  ];
  const sorted = [...shows].sort(byEpisodePubDate).map((s) => s.id);
  assert.equal(sorted[0], "p002vsnk", "Newshour is the freshest and must lead");
  assert.deepEqual(sorted.slice(1), ["p0fmrg25", "p055260j", "p05527ds"]);
});