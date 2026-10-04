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

test("Now Playing radio titles do not duplicate the station name when show or song details are available", async () => {
  const { resolveRadioNowPlayingTitles } = await import("../src/utils/nowPlayingTitles.ts");

  // Radio 4 with talk show and date episode (Image 1 case)
  const radio4 = resolveRadioNowPlayingTitles({
    stationTitle: "Radio 4",
    showTitle: "Woman's Hour",
    episodeTitle: "02/10/2026"
  });
  assert.equal(radio4.headerTitle, "Radio 4");
  assert.equal(radio4.primaryTitle, "Woman's Hour - 02/10/2026");
  assert.equal(radio4.secondaryTitle, undefined);

  // Radio 6 Music with song playing (Image 2 case)
  const radio6 = resolveRadioNowPlayingTitles({
    stationTitle: "Radio 6 Music",
    artist: "Beck",
    track: "Run Away"
  });
  assert.equal(radio6.headerTitle, "Radio 6 Music");
  assert.equal(radio6.primaryTitle, "Beck - Run Away");
  assert.equal(radio6.secondaryTitle, undefined);

  // Music station with both song and distinct programme name
  const radio2 = resolveRadioNowPlayingTitles({
    stationTitle: "Radio 2",
    showTitle: "The Zoe Ball Breakfast Show",
    artist: "Dua Lipa",
    track: "Training Season"
  });
  assert.equal(radio2.headerTitle, "Radio 2");
  assert.equal(radio2.primaryTitle, "Dua Lipa - Training Season");
  assert.equal(radio2.secondaryTitle, "The Zoe Ball Breakfast Show");

  // Show without episode title
  const radio3 = resolveRadioNowPlayingTitles({
    stationTitle: "Radio 3",
    showTitle: "Composer of the Week"
  });
  assert.equal(radio3.headerTitle, "Radio 3");
  assert.equal(radio3.primaryTitle, "Composer of the Week");
  assert.equal(radio3.secondaryTitle, undefined);

  // Fallback when no show/song data is available (e.g. offline/loading)
  const fallback = resolveRadioNowPlayingTitles({
    stationTitle: "Radio 1"
  });
  assert.equal(fallback.headerTitle, "Radio 1");
  assert.equal(fallback.primaryTitle, "Radio 1");
  assert.equal(fallback.secondaryTitle, undefined);
});

test("Up next line on Now Playing includes the start time of the next show", async () => {
  const { formatUpNextLabel } = await import("../src/utils/nowPlayingTitles.ts");

  // Local-time constructors keep the expected "HH:MM" independent of the test runner's zone.
  const at = (hour: number, minute: number) => new Date(2026, 0, 2, hour, minute).getTime();

  assert.equal(formatUpNextLabel("Newshipping", at(15, 5), at(14, 0)), "Newshipping at 15:05");
  assert.equal(formatUpNextLabel("Late Night Extra", at(0, 30), at(0, 0)), "Late Night Extra at 00:30");
  assert.equal(formatUpNextLabel("Woman's Hour", at(23, 45), at(23, 0)), "Woman's Hour at 23:45");

  // Falls back to the current show's end time when the schedule has no next start time.
  assert.equal(formatUpNextLabel("Money Box", undefined, at(10, 0)), "Money Box at 10:00");

  // No usable time: still show the programme name rather than an empty or broken line.
  assert.equal(formatUpNextLabel("News Briefing"), "News Briefing");
  assert.equal(formatUpNextLabel("News Briefing", 0, 0), "News Briefing");
  assert.equal(formatUpNextLabel("News Briefing", at(10, 0), 0), "News Briefing at 10:00");

  // Missing or whitespace-only title means no line at all.
  assert.equal(formatUpNextLabel(undefined, at(10, 0)), "");
  assert.equal(formatUpNextLabel("   ", at(10, 0)), "");
});


