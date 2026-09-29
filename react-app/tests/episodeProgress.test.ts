import test from "node:test";
import assert from "node:assert/strict";
import { mergeEpisodeProgress } from "../src/storage/episodeProgress.ts";

test("mergeEpisodeProgress keeps modern progress when both maps have an entry", () => {
  const merged = mergeEpisodeProgress({ ep1: 120 }, { ep1: 45, ep2: 30 });
  assert.deepEqual(merged, { ep1: 120, ep2: 30 });
});

test("mergeEpisodeProgress falls back to legacy positions for missing episodes", () => {
  const merged = mergeEpisodeProgress({}, { ep2: 30 });
  assert.deepEqual(merged, { ep2: 30 });
});

test("mergeEpisodeProgress falls back to legacy positions when modern progress is 0", () => {
  const merged = mergeEpisodeProgress({ ep1: 0 }, { ep1: 45 });
  assert.deepEqual(merged, { ep1: 45 });
});

test("mergeEpisodeProgress handles empty maps", () => {
  assert.deepEqual(mergeEpisodeProgress({}, {}), {});
});

test("mergeEpisodeProgress does not mutate its inputs", () => {
  const progress = { ep1: 10 };
  const positions = { ep2: 20 };
  mergeEpisodeProgress(progress, positions);
  assert.deepEqual(progress, { ep1: 10 });
  assert.deepEqual(positions, { ep2: 20 });
});
