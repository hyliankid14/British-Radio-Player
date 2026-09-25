import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBooleanSearch,
  matchesBooleanSearch,
  isAdvancedBooleanQuery,
  extractPositiveQuery,
  episodeMatchesQuery,
  type BooleanSearchNode
} from "../src/utils/searchUtils.ts";

test("parseBooleanSearch parses single term and phrases", () => {
  const termNode = parseBooleanSearch("barbershop");
  assert.deepEqual(termNode, { type: "term", value: "barbershop" });

  const phraseNode = parseBooleanSearch('"public service broadcasting"');
  assert.deepEqual(phraseNode, { type: "term", value: "public service broadcasting" });
});

test("parseBooleanSearch parses AND, OR, NOT operations", () => {
  const andNode = parseBooleanSearch("andy AND burnham");
  assert.equal(andNode?.type, "and");

  const notNode = parseBooleanSearch("NOT news");
  assert.deepEqual(notNode, { type: "not", child: { type: "term", value: "news" } });

  const orNode = parseBooleanSearch("zelda OR link");
  assert.equal(orNode?.type, "or");
});

test("matchesBooleanSearch accurately matches exact phrases", () => {
  const query = '"public service broadcasting"';

  // Should match exact phrase
  assert.equal(
    matchesBooleanSearch(
      query,
      "Rage to Riches: The story of Public Service Broadcasting and their musical journey."
    ),
    true
  );

  // Should NOT match if individual words are scattered or unrelated
  assert.equal(
    matchesBooleanSearch(
      query,
      "US envoys head to Kyiv after Moscow talks on public transport and service industry broadcasting rules."
    ),
    false
  );

  assert.equal(
    matchesBooleanSearch(
      query,
      "The Media Show: broadcasting regulations and the public interest."
    ),
    false
  );
});

test("matchesBooleanSearch handles single terms and HTML descriptions", () => {
  const query = "barbershop";

  assert.equal(
    matchesBooleanSearch(
      query,
      "<p>Economic Abuse, Michal Oshman, Roisin Gallagher, <b>Barbershop</b> Quartet, Mum shaming</p>"
    ),
    true
  );

  assert.equal(
    matchesBooleanSearch(
      query,
      "Discussion on hair salons and grooming."
    ),
    false
  );
});

test("isAdvancedBooleanQuery distinguishes plain from Boolean queries", () => {
  assert.equal(isAdvancedBooleanQuery("andy burnham"), false);
  assert.equal(isAdvancedBooleanQuery("AC/DC"), false);
  assert.equal(isAdvancedBooleanQuery("café"), false);
  assert.equal(isAdvancedBooleanQuery('"public service broadcasting"'), true);
  assert.equal(isAdvancedBooleanQuery("zelda OR link"), true);
  assert.equal(isAdvancedBooleanQuery("news NOT football"), true);
  assert.equal(isAdvancedBooleanQuery("(a OR b) AND c"), true);
  assert.equal(isAdvancedBooleanQuery("candy"), false);
});

test("extractPositiveQuery strips NOT terms", () => {
  assert.equal(extractPositiveQuery("andy burnham"), "andy burnham");
  assert.equal(extractPositiveQuery("andy -burnham"), "andy");
  assert.equal(extractPositiveQuery("news NOT football"), "news");
  assert.equal(extractPositiveQuery("Nestle -noodles"), "Nestle");
  assert.equal(extractPositiveQuery("-term1 hello -term2"), "hello");
});

test("episodeMatchesQuery uses normalised word-boundary matching like Kotlin", () => {
  // Simple query: title OR description match with normalised word-boundary
  assert.equal(
    episodeMatchesQuery("Andy Burnham meets Trump", "Political discussion", "Podcast", "andy burnham"),
    true
  );
  // Description match
  assert.equal(
    episodeMatchesQuery("Daily News", "Andy Burnham holds meeting", "Podcast", "andy burnham"),
    true
  );
  // No match
  assert.equal(
    episodeMatchesQuery("Daily News", "Weather forecast", "Podcast", "andy burnham"),
    false
  );
  // Partial word should NOT match (word-boundary)
  assert.equal(
    episodeMatchesQuery("Miranda", "Daily updates", "Podcast", "iran"),
    false
  );
  // NOT term enforcement
  assert.equal(
    episodeMatchesQuery("football news", "Football daily", "Podcast", "football -nfl"),
    false
  );
});

test("resolves latest publication date among matching episodes only", () => {
  const query = '"public service broadcasting"';

  const mockEpisodes = [
    {
      episodeId: "ep-1",
      title: "Daily News Update",
      description: "A public update on the train service broadcasting guidelines.",
      pubDate: "Wed, 23 Sep 2026 23:01:00 +0000" // Newest date, but DOES NOT match exact phrase
    },
    {
      episodeId: "ep-2",
      title: "Rage to Riches",
      description: "Documentary featuring Public Service Broadcasting in studio.",
      pubDate: "Fri, 13 Feb 2026 18:28:00 +0000" // Genuinely matches phrase
    },
    {
      episodeId: "ep-3",
      title: "Proms Archive",
      description: "Live concert of Public Service Broadcasting.",
      pubDate: "Tue, 16 Aug 2022 19:10:00 +0000" // Genuinely matches phrase, older
    }
  ];

  // Raw sort without matchingBooleanSearch would pick ep-1 (23 Sep 2026 / 24 Sep 2026)
  const rawLatest = mockEpisodes
    .map((e) => e.pubDate)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  assert.equal(rawLatest, "Wed, 23 Sep 2026 23:01:00 +0000");

  // Filtered with matchesBooleanSearch picks ep-2 (13 Feb 2026)
  const matching = mockEpisodes.filter((e) =>
    matchesBooleanSearch(query, `${e.title} ${e.description}`)
  );
  const correctLatest = matching
    .map((e) => e.pubDate)
    .filter((d) => typeof d === "string" && Number.isFinite(Date.parse(d)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  assert.equal(correctLatest, "Fri, 13 Feb 2026 18:28:00 +0000");
});
