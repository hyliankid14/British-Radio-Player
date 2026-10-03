import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SAVED_SEARCH_SORT,
  SAVED_SEARCH_SORT_OPTIONS,
  parseSavedSearchSort,
  sortSavedSearches
} from "../src/podcasts/savedSearchSort.ts";
import { applyManualOrder, moveItemToIndex } from "../src/utils/reorder.ts";

type Search = { id: string; name: string; latestResultDate?: string };

const SEARCHES: Search[] = [
  { id: "a", name: "Zebra news", latestResultDate: "2026-03-01T00:00:00.000Z" },
  { id: "b", name: "apple cast", latestResultDate: "2026-09-01T00:00:00.000Z" },
  { id: "c", name: "Mango weekly" }
];

const ids = (searches: Search[]) => searches.map((search) => search.id);
const names = (searches: Search[]) => searches.map((search) => search.name);

test("saved search sort options mirror the subscribed podcast ones minus tags", () => {
  assert.deepEqual(
    SAVED_SEARCH_SORT_OPTIONS.map(([label, value]) => [label, value]),
    [
      ["Most recently updated", "most_recently_updated"],
      ["Least recently updated", "least_recently_updated"],
      ["Alphabetical (A-Z)", "alphabetical"],
      ["Manual sort", "manual"]
    ]
  );
  assert.equal(SAVED_SEARCH_SORT_OPTIONS.some(([, value]) => value === "tags"), false);
});

test("parseSavedSearchSort accepts every option and falls back to the default", () => {
  for (const [, value] of SAVED_SEARCH_SORT_OPTIONS) {
    assert.equal(parseSavedSearchSort(value), value);
  }
  assert.equal(DEFAULT_SAVED_SEARCH_SORT, "most_recently_updated");
  for (const bad of [undefined, null, "", "tags", "nonsense", 7]) {
    assert.equal(parseSavedSearchSort(bad), "most_recently_updated", JSON.stringify(bad));
  }
});

test("most recently updated puts the newest match first and undated searches last", () => {
  assert.deepEqual(ids(sortSavedSearches(SEARCHES, "most_recently_updated", [])), ["b", "a", "c"]);
});

test("least recently updated is the exact reverse of the newest first ordering", () => {
  assert.deepEqual(ids(sortSavedSearches(SEARCHES, "least_recently_updated", [])), ["c", "a", "b"]);
});

test("an unparseable result date counts as no date rather than throwing", () => {
  const withBadDate: Search[] = [
    { id: "x", name: "Broken", latestResultDate: "not a date" },
    ...SEARCHES
  ];
  // Undated searches tie, so they keep their existing relative order at the end.
  assert.deepEqual(ids(sortSavedSearches(withBadDate, "most_recently_updated", [])), ["b", "a", "x", "c"]);
});

test("alphabetical sorts by name with localeCompare, not by query or date", () => {
  assert.deepEqual(names(sortSavedSearches(SEARCHES, "alphabetical", [])), [
    "apple cast",
    "Mango weekly",
    "Zebra news"
  ]);
});

test("manual sort honours the stored order and parks undragged rows at the end", () => {
  assert.deepEqual(ids(sortSavedSearches(SEARCHES, "manual", ["c", "b", "a"])), ["c", "b", "a"]);
  assert.deepEqual(ids(sortSavedSearches(SEARCHES, "manual", ["b", "a"])), ["b", "a", "c"]);
});

test("manual sort with nothing stored yet keeps the list as it was", () => {
  assert.deepEqual(ids(sortSavedSearches(SEARCHES, "manual", [])), ["a", "b", "c"]);
});

test("sorting never mutates the caller's list", () => {
  const input = [...SEARCHES];
  for (const [, sort] of SAVED_SEARCH_SORT_OPTIONS) {
    sortSavedSearches(input, sort, ["c", "a"]);
  }
  assert.deepEqual(ids(input), ["a", "b", "c"]);
});

test("applyManualOrder ranks ids that were never dragged last, in original order", () => {
  assert.deepEqual(applyManualOrder([{ id: "a" }, { id: "b" }, { id: "c" }], ["c"]), [
    { id: "c" },
    { id: "a" },
    { id: "b" }
  ]);
});

test("moveItemToIndex relocates one row and ignores out of range targets", () => {
  assert.deepEqual(moveItemToIndex(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItemToIndex(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItemToIndex(["a", "b"], 0, 9), ["a", "b"]);
  assert.deepEqual(moveItemToIndex(["a", "b"], -1, 0), ["a", "b"]);
});

test("a drag commit produces exactly the ids the manual order should store", () => {
  const committed = moveItemToIndex(ids(SEARCHES), 0, 2);
  assert.deepEqual(
    ids(sortSavedSearches(SEARCHES, "manual", committed)),
    ["b", "c", "a"]
  );
});
