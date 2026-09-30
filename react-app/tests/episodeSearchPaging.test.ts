import test from "node:test";
import assert from "node:assert/strict";
import {
  appendEpisodePage,
  emptyEpisodePageState,
  rankEpisodes
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

test("episodes from a podcast that matches the query rank above the rest", () => {
  const eps = [
    { episodeId: "a", podcastId: "other", title: "Loose match", description: "", pubDate: "Fri, 13 Feb 2026 18:28:00 +0000" },
    { episodeId: "b", podcastId: "show", title: "Older episode", description: "", pubDate: "Tue, 16 Aug 2022 19:10:00 +0000" },
    { episodeId: "c", podcastId: "other", title: "Newer loose", description: "", pubDate: "Wed, 23 Sep 2026 23:01:00 +0000" }
  ];

  const ranked = rankEpisodes(eps, new Set(["show"]));

  // The matching show leads even though its episode is the oldest of the three.
  assert.deepEqual(ranked.map((e) => e.episodeId), ["b", "c", "a"]);
});

test("episodes are ordered newest first within each group", () => {
  const eps = [
    { episodeId: "old", podcastId: "x", title: "", description: "", pubDate: "Tue, 16 Aug 2022 19:10:00 +0000" },
    { episodeId: "new", podcastId: "x", title: "", description: "", pubDate: "Wed, 23 Sep 2026 23:01:00 +0000" },
    { episodeId: "mid", podcastId: "x", title: "", description: "", pubDate: "Fri, 13 Feb 2026 18:28:00 +0000" }
  ];

  assert.deepEqual(rankEpisodes(eps, new Set()).map((e) => e.episodeId), ["new", "mid", "old"]);
});

test("episodes with no usable pubDate do not break ordering", () => {
  const eps = [
    { episodeId: "no-date", podcastId: "x", title: "", description: "", pubDate: "" },
    { episodeId: "dated", podcastId: "x", title: "", description: "", pubDate: "Fri, 13 Feb 2026 18:28:00 +0000" }
  ];

  assert.deepEqual(rankEpisodes(eps, new Set()).map((e) => e.episodeId), ["dated", "no-date"]);
});

test("rankEpisodes does not mutate its input", () => {
  const eps = [
    { episodeId: "a", podcastId: "x", title: "", description: "", pubDate: "Fri, 13 Feb 2026 18:28:00 +0000" },
    { episodeId: "b", podcastId: "x", title: "", description: "", pubDate: "Wed, 23 Sep 2026 23:01:00 +0000" }
  ];
  const order = eps.map((e) => e.episodeId);

  rankEpisodes(eps, new Set(["x"]));

  assert.deepEqual(eps.map((e) => e.episodeId), order);
});
