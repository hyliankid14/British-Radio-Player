import test from "node:test";
import assert from "node:assert/strict";
import {
  appendEpisodePage,
  emptyEpisodePageState
} from "../src/podcasts/episodeSearchPaging.ts";

const PAGE_SIZE = 50;
const MAX_EPISODES = 200;

function makeBatch(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    episodeId: `ep-${start + i}`,
    podcastId: "p1",
    title: `Episode ${start + i}`,
    description: "",
    pubDate: "Wed, 23 Sep 2026 23:01:00 +0000"
  }));
}

test("a full page advances the offset and leaves more to fetch", () => {
  const state = appendEpisodePage(
    emptyEpisodePageState(),
    makeBatch(0, PAGE_SIZE),
    PAGE_SIZE,
    MAX_EPISODES
  );

  assert.equal(state.episodes.length, PAGE_SIZE);
  assert.equal(state.nextOffset, PAGE_SIZE);
  assert.equal(state.exhausted, false);
});

test("a short page marks the results exhausted", () => {
  const first = appendEpisodePage(
    emptyEpisodePageState(),
    makeBatch(0, PAGE_SIZE),
    PAGE_SIZE,
    MAX_EPISODES
  );
  const second = appendEpisodePage(first, makeBatch(50, 7), PAGE_SIZE, MAX_EPISODES);

  assert.equal(second.episodes.length, PAGE_SIZE + 7);
  assert.equal(second.exhausted, true);
});

test("re-fetched episodes are deduplicated by id", () => {
  const first = appendEpisodePage(
    emptyEpisodePageState(),
    makeBatch(0, PAGE_SIZE),
    PAGE_SIZE,
    MAX_EPISODES
  );
  // Phrase widening can replay rows the previous page already returned:
  // ep-25..ep-74 overlaps the first page's ep-25..ep-49, leaving 25 new.
  const second = appendEpisodePage(first, makeBatch(25, PAGE_SIZE), PAGE_SIZE, MAX_EPISODES);

  assert.equal(second.episodes.length, PAGE_SIZE + 25);
  assert.deepEqual(
    new Set(second.episodes.map((e) => e.episodeId)).size,
    second.episodes.length
  );
});

test("the offset advances by the page size, not the row count", () => {
  // A phrase search widens the page with per-term results, so more rows than
  // the page size come back. Advancing by that inflated count would skip hits
  // in the main query.
  const widened = appendEpisodePage(
    emptyEpisodePageState(),
    makeBatch(0, PAGE_SIZE + 40),
    PAGE_SIZE,
    MAX_EPISODES
  );

  assert.equal(widened.nextOffset, PAGE_SIZE);
  assert.equal(widened.exhausted, false);
});

test("reaching the cap stops further paging", () => {
  let state = emptyEpisodePageState();
  for (let page = 0; page * PAGE_SIZE < MAX_EPISODES; page++) {
    state = appendEpisodePage(state, makeBatch(page * PAGE_SIZE, PAGE_SIZE), PAGE_SIZE, MAX_EPISODES);
  }

  assert.equal(state.episodes.length, MAX_EPISODES);
  assert.equal(state.exhausted, true);
});

test("an empty first page yields no episodes and no more to fetch", () => {
  const state = appendEpisodePage(emptyEpisodePageState(), [], PAGE_SIZE, MAX_EPISODES);

  assert.deepEqual(state.episodes, []);
  assert.equal(state.exhausted, true);
});
