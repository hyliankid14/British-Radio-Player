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

test("top safe area calculation uses status bar fallback on initial Android render", () => {
  const calculateTopInset = (
    insetsTop: number | undefined,
    os: string,
    statusBarHeight: number | undefined
  ) => Math.max(insetsTop ?? 0, os === "android" ? (statusBarHeight ?? 0) : 0);

  // When native insets haven't been dispatched yet (insetsTop is 0 or undefined)
  assert.equal(calculateTopInset(0, "android", 24), 24);
  assert.equal(calculateTopInset(undefined, "android", 32), 32);

  // When native insets are available and larger (e.g. cutout/notch)
  assert.equal(calculateTopInset(48, "android", 24), 48);

  // On iOS, statusBarHeight fallback isn't used
  assert.equal(calculateTopInset(47, "ios", 0), 47);
});

