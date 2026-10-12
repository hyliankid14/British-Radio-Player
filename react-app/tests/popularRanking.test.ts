import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePodcastTitle,
  buildPopularRankings,
  getPopularRank,
  hasPopularRank
} from "../src/podcasts/popularRanking.ts";
import type { PopularEntry } from "../src/api/podcasts.ts";

test("normalizePodcastTitle: normalizes case, whitespace, and smart quotes", () => {
  assert.equal(normalizePodcastTitle("  Americast  "), "americast");
  assert.equal(normalizePodcastTitle("500 Words’ Bedtime Stories"), "500 words' bedtime stories");
  assert.equal(normalizePodcastTitle("500 Words' Bedtime Stories"), "500 words' bedtime stories");
  assert.equal(normalizePodcastTitle('“The”   Daily'), '"the" daily');
  assert.equal(normalizePodcastTitle(undefined), "");
  assert.equal(normalizePodcastTitle(""), "");
});

test("buildPopularRankings: indexes entries with 1-based rank by ID and title", () => {
  const entries: PopularEntry[] = [
    { id: "p07h19zz", name: "Americast", plays: 21 },
    { id: "p04d42rc", name: "CrowdScience", plays: 14 }
  ];

  const rankings = buildPopularRankings(entries);
  assert.equal(rankings.idRanks.get("p07h19zz"), 1);
  assert.equal(rankings.idRanks.get("p04d42rc"), 2);
  assert.equal(rankings.titleRanks.get("americast"), 1);
  assert.equal(rankings.titleRanks.get("crowdscience"), 2);
});

test("getPopularRank & hasPopularRank: prefers exact ID match", () => {
  const entries: PopularEntry[] = [
    { id: "p07h19zz", name: "Americast", plays: 21 },
    { id: "p04d42rc", name: "CrowdScience", plays: 14 }
  ];
  const rankings = buildPopularRankings(entries);

  const podcast = { id: "p07h19zz", title: "Americast" };
  assert.equal(hasPopularRank(rankings, podcast), true);
  assert.equal(getPopularRank(rankings, podcast), 1);
});

test("getPopularRank & hasPopularRank: falls back to normalized title when ID differs", () => {
  // Simulates Desert Island Discs where analytics server has ID "74769686"
  // but BBC OPML catalog has ID "b006qnmr"
  const entries: PopularEntry[] = [
    { id: "p07h19zz", name: "Americast", plays: 21 },
    { id: "74769686", name: "Desert Island Discs", plays: 12 },
    { id: "p02nrss1", name: "More or Less", plays: 8 }
  ];
  const rankings = buildPopularRankings(entries);

  // Catalog podcast for Desert Island Discs
  const desertIsland = { id: "b006qnmr", title: "Desert Island Discs" };
  assert.equal(hasPopularRank(rankings, desertIsland), true);
  assert.equal(getPopularRank(rankings, desertIsland), 2);

  // Catalog podcast for More or Less
  const moreOrLess = { id: "b006qshd", title: "More or Less" };
  assert.equal(hasPopularRank(rankings, moreOrLess), true);
  assert.equal(getPopularRank(rankings, moreOrLess), 3);

  // Unranked podcast
  const unranked = { id: "p0999999", title: "Unknown Show" };
  assert.equal(hasPopularRank(rankings, unranked), false);
  assert.equal(getPopularRank(rankings, unranked), null);
});

test("sorting catalog podcasts by popularity rank places matched shows in order", () => {
  const entries: PopularEntry[] = [
    { id: "p07h19zz", name: "Americast", plays: 21 },
    { id: "74769686", name: "Desert Island Discs", plays: 12 },
    { id: "p04d42rc", name: "CrowdScience", plays: 10 }
  ];
  const rankings = buildPopularRankings(entries);

  const catalog = [
    { id: "random1", title: "Random Show 1" },
    { id: "p04d42rc", title: "CrowdScience" },
    { id: "b006qnmr", title: "Desert Island Discs" },
    { id: "random2", title: "Random Show 2" },
    { id: "p07h19zz", title: "Americast" }
  ];

  const popularShows = catalog
    .filter((p) => hasPopularRank(rankings, p))
    .sort((a, b) => (getPopularRank(rankings, a) ?? 999) - (getPopularRank(rankings, b) ?? 999));

  assert.deepEqual(
    popularShows.map((p) => p.title),
    ["Americast", "Desert Island Discs", "CrowdScience"]
  );
});
