import test from "node:test";
import assert from "node:assert/strict";
import { calculateUpdatedRating, formatRatingValue } from "../src/podcasts/ratingUtils.ts";

test("calculateUpdatedRating: initializes rating for podcast with no prior ratings", () => {
  const result = calculateUpdatedRating(undefined, 5);
  assert.deepEqual(result, {
    average: 5,
    count: 1,
    mine: 5
  });

  const resultWithZero = calculateUpdatedRating({ average: 0, count: 0 }, 4);
  assert.deepEqual(resultWithZero, {
    average: 4,
    count: 1,
    mine: 4
  });
});

test("calculateUpdatedRating: increments count and calculates weighted average for new rating", () => {
  // Existing: 4 ratings averaging 4.0 (total = 16)
  // New rating: 5 (new total = 21, count = 5, avg = 4.2)
  const current = { average: 4.0, count: 4 };
  const result = calculateUpdatedRating(current, 5);
  assert.deepEqual(result, {
    average: 4.2,
    count: 5,
    mine: 5
  });
});

test("calculateUpdatedRating: replaces user's previous rating without incrementing count", () => {
  // Existing: 4 ratings averaging 4.25, user previously gave 3 (total = 17)
  // User changes rating to 5 (new total = 17 - 3 + 5 = 19, count remains 4, avg = 4.75 -> 4.8)
  const current = { average: 4.25, count: 4, mine: 3 };
  const result = calculateUpdatedRating(current, 5);
  assert.deepEqual(result, {
    average: 4.8,
    count: 4,
    mine: 5
  });
});

test("calculateUpdatedRating: handles single rating update by sole rater", () => {
  // Existing: 1 rating of 2 by the user
  // User changes rating to 5 (new total = 5, count = 1, avg = 5.0)
  const current = { average: 2.0, count: 1, mine: 2 };
  const result = calculateUpdatedRating(current, 5);
  assert.deepEqual(result, {
    average: 5,
    count: 1,
    mine: 5
  });
});

test("calculateUpdatedRating: clamps ratings to [1, 5] range", () => {
  const lowResult = calculateUpdatedRating({ average: 3.0, count: 2 }, 0);
  assert.equal(lowResult.mine, 1);
  assert.equal(lowResult.average, 2.3); // (6 + 1) / 3 = 2.333... -> 2.3

  const highResult = calculateUpdatedRating({ average: 3.0, count: 2 }, 10);
  assert.equal(highResult.mine, 5);
  assert.equal(highResult.average, 3.7); // (6 + 5) / 3 = 3.666... -> 3.7
});

test("calculateUpdatedRating: rounds average to 1 decimal place", () => {
  // 3 ratings averaging 3.0 (total 9). User adds 4 -> total 13, count 4 -> 3.25 -> 3.3
  const result = calculateUpdatedRating({ average: 3.0, count: 3 }, 4);
  assert.equal(result.average, 3.3);
  assert.equal(result.count, 4);
  assert.equal(result.mine, 4);
});

test("calculateUpdatedRating: handles corrupted or missing count gracefully", () => {
  // Count is 0 or negative
  const result = calculateUpdatedRating({ average: 4.0, count: 0 }, 5);
  assert.deepEqual(result, {
    average: 5,
    count: 1,
    mine: 5
  });
});

test("mock preferences store: updates cached ratings and notifies listeners immediately", () => {
  const memoryStore = new Map<string, string>();
  const listeners = new Set<(key: string) => void>();

  const PODCAST_RATINGS_CACHE = "cache_podcast_ratings_data";

  function getCachedPodcastRatings(): Record<string, { average: number; count: number; mine?: number }> {
    const raw = memoryStore.get(PODCAST_RATINGS_CACHE);
    return raw ? JSON.parse(raw) : {};
  }

  function updateCachedPodcastRating(podcastId: string, rating: { average: number; count: number; mine?: number }): void {
    const all = getCachedPodcastRatings();
    all[podcastId] = rating;
    memoryStore.set(PODCAST_RATINGS_CACHE, JSON.stringify(all));
    listeners.forEach((l) => l(PODCAST_RATINGS_CACHE));
  }

  let notifiedKey: string | null = null;
  const listener = (key: string) => {
    notifiedKey = key;
  };
  listeners.add(listener);

  const testPodcastId = "p00testpodcast";
  const updated = calculateUpdatedRating(undefined, 5);
  updateCachedPodcastRating(testPodcastId, updated);

  assert.equal(notifiedKey, PODCAST_RATINGS_CACHE);
  const cached = getCachedPodcastRatings();
  assert.deepEqual(cached[testPodcastId], { average: 5, count: 1, mine: 5 });
});

test("formatRatingValue: formats whole numbers without decimal places", () => {
  assert.equal(formatRatingValue(5), "5");
  assert.equal(formatRatingValue(5.0), "5");
  assert.equal(formatRatingValue(4), "4");
  assert.equal(formatRatingValue(4.0), "4");
  assert.equal(formatRatingValue(1.0), "1");
  assert.equal(formatRatingValue(0), "0");
  assert.equal(formatRatingValue(4.99), "5");
  assert.equal(formatRatingValue(4.01), "4");
});

test("formatRatingValue: formats fractional numbers with one decimal place", () => {
  assert.equal(formatRatingValue(4.5), "4.5");
  assert.equal(formatRatingValue(3.2), "3.2");
  assert.equal(formatRatingValue(4.8), "4.8");
  assert.equal(formatRatingValue(4.25), "4.3");
  assert.equal(formatRatingValue(3.14), "3.1");
});
