import test from "node:test";
import assert from "node:assert/strict";

import { createPlayedIdLookup, isPlayedId } from "../src/storage/playedIdLookup.ts";
import { normalizeEpisodeId } from "../src/downloads/downloadLimits.ts";
import { BoundedCache } from "../src/utils/boundedCache.ts";

/**
 * The implementation this replaced: parse the whole list, then match the raw id, then the
 * query's normalised form, then compare each stored id's normalised form against the query's
 * normalised form (or its raw id when that has no normalised form). Kept verbatim as the
 * oracle the set-based lookup is checked against.
 */
function isEpisodePlayedByScanning(played: string[], episodeId: string): boolean {
  if (!episodeId) return false;
  if (played.includes(episodeId)) return true;
  const norm = normalizeEpisodeId(episodeId);
  if (norm && played.includes(norm)) return true;
  for (const id of played) {
    if (normalizeEpisodeId(id) === (norm || episodeId)) return true;
  }
  return false;
}

/** Ids in every shape the app sees: canonical PIDs, URNs, programme URLs and encoded forms. */
const ID_SHAPES = [
  "w3ct998z",
  "urn:bbc:podcast:w3ct998z",
  "https://www.bbc.co.uk/programmes/w3ct998z",
  "p01abcde",
  "urn:bbc:podcast:p01abcde",
  "abc%3Adef",
  "abc:def",
  "b-c_d",
  "  spaced  ",
  "some path:leaf",
  "a/b:c",
  "plain-text id",
  "",
  "already/a/slash",
  "trailing/"
];

const STORED_SETS = [
  [],
  ["w3ct998z"],
  ["urn:bbc:podcast:w3ct998z"],
  ["w3ct998z", "urn:bbc:podcast:p01abcde", "https://www.bbc.co.uk/programmes/p02abcd"],
  ["abc%3Adef", "some path:leaf", "plain-text id"],
  ["b-c_d", "  spaced  ", "trailing/"],
  ID_SHAPES.filter(Boolean)
];

test("set-based played lookup matches the original scanning implementation", () => {
  for (const stored of STORED_SETS) {
    const lookup = createPlayedIdLookup(stored);
    for (const query of ID_SHAPES) {
      assert.equal(
        isPlayedId(lookup, query),
        isEpisodePlayedByScanning(stored, query),
        `mismatch for stored=${JSON.stringify(stored)} query=${JSON.stringify(query)}`
      );
    }
  }
});

test("an empty played list never reports an episode as played", () => {
  const lookup = createPlayedIdLookup([]);
  for (const query of ID_SHAPES) {
    assert.equal(isPlayedId(lookup, query), false);
  }
});

test("the played lookup is rebuilt from the list, not shared between lists", () => {
  const first = createPlayedIdLookup(["w3ct998z"]);
  const second = createPlayedIdLookup([]);
  assert.equal(isPlayedId(first, "w3ct998z"), true);
  assert.equal(isPlayedId(second, "w3ct998z"), false);
});

test("BoundedCache keeps the most recently written entries", () => {
  const cache = new BoundedCache<string, number>(3);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.size, 3);
  cache.set("d", 4);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("a"), undefined, "oldest entry should be evicted");
  assert.equal(cache.get("d"), 4);
});

test("BoundedCache treats a rewrite as the most recent entry", () => {
  const cache = new BoundedCache<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 10);
  cache.set("c", 3);
  assert.equal(cache.get("a"), 10, "a rewritten entry must survive one more insertion");
  assert.equal(cache.get("b"), undefined, "b is now the oldest entry");
});

test("BoundedCache reports membership and supports deletion", () => {
  const cache = new BoundedCache<string, string>(4);
  cache.set("a", "x");
  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("missing"), false);
  assert.equal(cache.delete("a"), true);
  assert.equal(cache.has("a"), false);
});
