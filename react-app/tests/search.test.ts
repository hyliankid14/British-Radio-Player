import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBooleanSearch,
  matchesBooleanSearch,
  isAdvancedBooleanQuery,
  extractPositiveQuery,
  episodeMatchesQuery,
  filterSuggestions,
  booleanSearchCandidateQueries,
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

test("parseBooleanSearch only treats UPPERCASE words as operators", () => {
  assert.deepEqual(parseBooleanSearch("andy AND burnham"), {
    type: "and",
    left: { type: "term", value: "andy" },
    right: { type: "term", value: "burnham" }
  });
  assert.equal(parseBooleanSearch("zelda OR link")?.type, "or");
  assert.equal(parseBooleanSearch("NOT news")?.type, "not");

  // Lowercase and/or/not are ordinary words. "More or Less" is a podcast title,
  // not the operator, so it must not parse as an OR expression.
  assert.equal(parseBooleanSearch("More or Less")?.type, "and");
  assert.equal(parseBooleanSearch("news not sport")?.type, "and");
  assert.equal(parseBooleanSearch("bread and butter")?.type, "and");
});

test("isAdvancedBooleanQuery ignores lowercase operator words", () => {
  assert.equal(isAdvancedBooleanQuery("andy burnham"), false);
  assert.equal(isAdvancedBooleanQuery("More or Less"), false);
  assert.equal(isAdvancedBooleanQuery("news not football"), false);
  assert.equal(isAdvancedBooleanQuery("bread AND butter"), true);
  assert.equal(isAdvancedBooleanQuery("zelda OR link"), true);
  assert.equal(isAdvancedBooleanQuery("news NOT football"), true);
  assert.equal(isAdvancedBooleanQuery('"public service broadcasting"'), true);
  assert.equal(isAdvancedBooleanQuery("(a OR b) AND c"), true);
  assert.equal(isAdvancedBooleanQuery("candy"), false);
});

test("More or Less matches the show rather than anything containing more or less", () => {
  const query = "More or Less";

  assert.equal(
    matchesBooleanSearch(query, "More or Less: The economics podcast from the BBC."),
    true
  );
  // "Lives Less Ordinary" contains "less" but not the phrase, and is not the show.
  assert.equal(
    matchesBooleanSearch(query, "Lives Less Ordinary: stories of remarkable lives."),
    false
  );
  // Episodes mentioning either word alone must not be treated as matches.
  assert.equal(episodeMatchesQuery("More than a feeling", "", "Some Show", query), false);
  assert.equal(episodeMatchesQuery("Nothing to declare", "", "Some Show", query), false);
});

test("a lowercase or is a word, so 'More or Less' needs no boolean handling", () => {
  const query = "More or Less";

  // The operators are uppercase-only, so the phrase is an ordinary AND of three
  // terms rather than `more OR less` — which would match nearly every podcast.
  assert.equal(isAdvancedBooleanQuery(query), false);
  assert.deepEqual(parseBooleanSearch(query), {
    type: "and",
    left: { type: "and", left: { type: "term", value: "more" }, right: { type: "term", value: "or" } },
    right: { type: "term", value: "less" }
  });

  // Not an advanced query, so the search screen spends a single request on it
  // and never fans out to per-alternative lookups.
  assert.equal(extractPositiveQuery(query), query);

  // All three words must be present for the show to match.
  assert.equal(
    episodeMatchesQuery("Is football a sport?", "Rhiannon on More or Less", "More or Less", query),
    true
  );
  assert.equal(
    episodeMatchesQuery("Less is more", "A philosophy show", "Some Show", query),
    false
  );
  // Uppercase is still the operator, and does widen the query.
  assert.equal(isAdvancedBooleanQuery("More OR Less"), true);
});

test("episodeMatchesQuery enforces quoted phrases instead of passing everything through", () => {
  const query = '"public service broadcasting"';

  // The regression: an advanced query used to enforce only its NOT terms and
  // return true for every candidate, so the list was never filtered.
  assert.equal(
    episodeMatchesQuery("Bloodsports", "An unrelated episode about football.", "Some Show", query),
    false
  );
  // Exact phrase in the description still matches, even when the title does not
  // carry it — a phrase must fit across both fields.
  assert.equal(
    episodeMatchesQuery("Bloodsports", "A show by Public Service Broadcasting.", "Some Show", query),
    true
  );
  // The words present but scattered is not a phrase match.
  assert.equal(
    episodeMatchesQuery(
      "Daily",
      "public transport and service industry broadcasting rules",
      "News",
      query
    ),
    false
  );
  // Quotes are narrower than the same query unquoted, which is the point.
  const unquoted = "public service broadcasting";
  const scattered = "Daily public transport and service industry broadcasting rules";
  assert.equal(episodeMatchesQuery("Daily", scattered, "News", unquoted), true);
  assert.equal(episodeMatchesQuery("Daily", scattered, "News", query), false);
});

test("episodeMatchesQuery enforces AND, OR, NOT and -term exclusions", () => {
  // OR: either alternative satisfies the query, neither does not.
  assert.equal(episodeMatchesQuery("Zelda", "", "S", "zelda OR link"), true);
  assert.equal(episodeMatchesQuery("Link", "", "S", "zelda OR link"), true);
  assert.equal(episodeMatchesQuery("Kirby", "", "S", "zelda OR link"), false);

  // NOT: the excluded word is seen in the title, the description or the podcast
  // name, whichever field it lands in.
  assert.equal(episodeMatchesQuery("Football", "Match report", "Sport", "NOT news"), true);
  assert.equal(episodeMatchesQuery("Football news", "Match report", "Sport", "NOT news"), false);
  assert.equal(episodeMatchesQuery("Daily", "Match report", "News", "NOT news"), false);

  // AND across a grouping: both alternatives and the trailing term are required.
  assert.equal(
    episodeMatchesQuery("Zelda and c", "", "S", "(zelda OR link) AND c"),
    true
  );
  assert.equal(
    episodeMatchesQuery("Zelda only", "", "S", "(zelda OR link) AND c"),
    false
  );

  // `-term` is an exclusion operator, not a word to match.
  assert.equal(isAdvancedBooleanQuery("football -nfl"), true);
  assert.deepEqual(parseBooleanSearch("football -nfl"), {
    type: "and",
    left: { type: "term", value: "football" },
    right: { type: "not", child: { type: "term", value: "nfl" } }
  });
  assert.equal(episodeMatchesQuery("Football transfer", "", "Sport", "football -nfl"), true);
  assert.equal(episodeMatchesQuery("NFL transfer", "", "Sport", "football -nfl"), false);

  // A dash with spaces around it is title punctuation, not an exclusion:
  // "Top 40 - The Countdown Show" has to stay searchable as typed.
  assert.equal(isAdvancedBooleanQuery("top 40 - countdown"), false);
  assert.equal(parseBooleanSearch("top 40 - countdown")?.type, "and");
  assert.equal(
    episodeMatchesQuery("Top 40 - The Countdown Show", "", "Top 40", "top 40 - countdown"),
    true
  );

  // An exclusion can still be attached to a quoted phrase.
  assert.deepEqual(parseBooleanSearch('-"public service broadcasting"'), {
    type: "not",
    child: { type: "term", value: "public service broadcasting" }
  });
});

test("booleanSearchCandidateQueries covers every alternative the index cannot express", () => {
  // A phrase is one leaf, plus each of its words: the index ranks tokens
  // individually and can rank the exact phrase out of a single page.
  assert.deepEqual(booleanSearchCandidateQueries('"public service broadcasting"'), [
    "public service broadcasting",
    "public",
    "service",
    "broadcasting"
  ]);

  // OR alternatives must each be asked for, or the index ANDs them together and
  // returns the intersection instead of the union.
  assert.deepEqual(booleanSearchCandidateQueries("Public OR Newscast"), [
    "public",
    "newscast"
  ]);
  assert.deepEqual(booleanSearchCandidateQueries("(a OR b) AND c"), ["a", "b", "c"]);

  // Excluded terms are never requested — they are subtracted on the client.
  assert.deepEqual(booleanSearchCandidateQueries("NOT news"), []);
  assert.deepEqual(booleanSearchCandidateQueries("news -sport"), ["news"]);

  // Fan-out stays bounded so one keystroke cannot issue a request per word.
  const many = booleanSearchCandidateQueries(
    "alpha OR bravo OR charlie OR delta OR echo OR foxtrot OR golf OR hotel",
    4
  );
  assert.equal(many.length, 4);
});

test("extractPositiveQuery strips uppercase NOT but keeps lowercase not", () => {
  assert.equal(extractPositiveQuery("andy burnham"), "andy burnham");
  assert.equal(extractPositiveQuery("andy -burnham"), "andy");
  assert.equal(extractPositiveQuery("news NOT football"), "news");
  assert.equal(extractPositiveQuery("Nestle -noodles"), "Nestle");
  assert.equal(extractPositiveQuery("-term1 hello -term2"), "hello");

  // "not" is a word, not an operator, so it stays in the query sent to the server.
  assert.equal(extractPositiveQuery("More or Less"), "More or Less");
  assert.equal(extractPositiveQuery("news not football"), "news not football");
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
  // NOT term enforcement: `-term` excludes rather than being matched literally.
  // It used to be read as a required word, so this query matched nothing at all.
  assert.equal(
    episodeMatchesQuery("football news", "Football daily", "Podcast", "football -nfl"),
    true
  );
  assert.equal(
    episodeMatchesQuery("Football and NFL preview", "", "Podcast", "football -nfl"),
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

test("filterSuggestions never echoes the typed query back as a suggestion", () => {
  const suggestions = [
    { podcastId: "p1", title: "Swingers" },
    { podcastId: "p2", title: "Swingers Club" },
    { podcastId: "p3", title: "The Swingers Show" }
  ];

  // Typing the full name must not render a suggestion box that looks like a
  // second copy of the search field.
  assert.deepEqual(filterSuggestions(suggestions, "Swingers").map((s) => s.title), [
    "Swingers Club",
    "The Swingers Show"
  ]);

  // Case and surrounding whitespace are not meaningful here.
  assert.deepEqual(filterSuggestions(suggestions, "  swingers  ").map((s) => s.title), [
    "Swingers Club",
    "The Swingers Show"
  ]);

  // A partial query keeps every suggestion.
  assert.equal(filterSuggestions(suggestions, "swing").length, 3);

  // No query, no suggestions.
  assert.deepEqual(filterSuggestions(suggestions, ""), []);
  assert.deepEqual(filterSuggestions(suggestions, "   "), []);
});
