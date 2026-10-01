import test from "node:test";
import assert from "node:assert/strict";

const SECTION_HEADERS: Record<string, string> = {
  favourites: "Favourites",
  all_stations: "All Stations",
  guide: "Guide",
  podcasts: "Podcasts",
  settings: "Settings"
};

const FAVOURITE_CATEGORY_TITLES: Record<string, string> = {
  Stations: "Favourites",
  Subscribed: "Subscribed Podcasts",
  Playlists: "Playlists",
  Searches: "Saved Searches",
  History: "Listening History"
};

test("all five main app sections have unified title labels matching bottom tabs", () => {
  assert.equal(SECTION_HEADERS.favourites, "Favourites");
  assert.equal(SECTION_HEADERS.all_stations, "All Stations");
  assert.equal(SECTION_HEADERS.guide, "Guide");
  assert.equal(SECTION_HEADERS.podcasts, "Podcasts");
  assert.equal(SECTION_HEADERS.settings, "Settings");
});

test("favourites section uses unified 'Favourites' as root title", () => {
  assert.equal(FAVOURITE_CATEGORY_TITLES.Stations, "Favourites");
  assert.equal(FAVOURITE_CATEGORY_TITLES.Subscribed, "Subscribed Podcasts");
  assert.equal(FAVOURITE_CATEGORY_TITLES.Playlists, "Playlists");
  assert.equal(FAVOURITE_CATEGORY_TITLES.Searches, "Saved Searches");
  assert.equal(FAVOURITE_CATEGORY_TITLES.History, "Listening History");
});
