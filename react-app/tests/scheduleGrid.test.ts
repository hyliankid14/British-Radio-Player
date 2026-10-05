import test from "node:test";
import assert from "node:assert/strict";
import {
  generateTimeSlots,
  calculateScheduleBlockLayout,
  normalizeTitle,
  matchShowToPodcast,
  PIXELS_PER_MINUTE,
  MINUTES_IN_DAY,
  type PodcastLike
} from "../src/utils/scheduleGridUtils.ts";
import { fillScheduleGaps, parseEssSchedule, type ScheduleEntry } from "../src/api/showInfo.ts";

test("generateTimeSlots generates 48 half-hour slots for a 24h day", () => {
  const slots = generateTimeSlots();
  assert.equal(slots.length, 48);
  assert.equal(slots[0].label, "12:00am");
  assert.equal(slots[0].minuteOffset, 0);

  // 10:00am is minute 600
  const tenAm = slots.find((s) => s.minuteOffset === 600);
  assert.ok(tenAm);
  assert.equal(tenAm.label, "10:00am");

  // 10:30am is minute 630
  const tenThirtyAm = slots.find((s) => s.minuteOffset === 630);
  assert.ok(tenThirtyAm);
  assert.equal(tenThirtyAm.label, "10:30am");

  // 11:30pm is minute 1410
  const elevenThirtyPm = slots.find((s) => s.minuteOffset === 1410);
  assert.ok(elevenThirtyPm);
  assert.equal(elevenThirtyPm.label, "11:30pm");
});

test("calculateScheduleBlockLayout correctly calculates left and width", () => {
  const dayStartMs = new Date("2026-10-01T00:00:00.000Z").getTime();
  
  // Show from 10:00am to 10:45am (45 minutes, starting at minute 600)
  const startMs = dayStartMs + 600 * 60 * 1000;
  const endMs = startMs + 45 * 60 * 1000;

  const layout = calculateScheduleBlockLayout(startMs, endMs, dayStartMs, PIXELS_PER_MINUTE);
  assert.equal(layout.left, Math.round(600 * PIXELS_PER_MINUTE));
  assert.equal(layout.width, Math.round(45 * PIXELS_PER_MINUTE));
});

test("calculateScheduleBlockLayout clamps shows crossing midnight boundaries", () => {
  const dayStartMs = new Date("2026-10-01T00:00:00.000Z").getTime();
  const dayEndMs = dayStartMs + MINUTES_IN_DAY * 60 * 1000;

  // Show starting day before (23:00) and ending today at 01:00 (clamped start = 00:00, 60 mins)
  const priorStartMs = dayStartMs - 60 * 60 * 1000;
  const morningEndMs = dayStartMs + 60 * 60 * 1000;

  const layout = calculateScheduleBlockLayout(priorStartMs, morningEndMs, dayStartMs, PIXELS_PER_MINUTE);
  assert.equal(layout.left, 0);
  assert.equal(layout.width, 60 * PIXELS_PER_MINUTE);

  // Show starting today at 23:30 and ending tomorrow at 01:00 (clamped duration = 30 mins)
  const lateStartMs = dayEndMs - 30 * 60 * 1000;
  const tomorrowEndMs = dayEndMs + 60 * 60 * 1000;

  const lateLayout = calculateScheduleBlockLayout(lateStartMs, tomorrowEndMs, dayStartMs, PIXELS_PER_MINUTE);
  assert.equal(lateLayout.left, (MINUTES_IN_DAY - 30) * PIXELS_PER_MINUTE);
  assert.equal(lateLayout.width, 30 * PIXELS_PER_MINUTE);
});

test("normalizeTitle strips punctuation, lowercase, extra spaces", () => {
  assert.equal(normalizeTitle("Today - BBC Radio 4!"), "today bbc radio 4");
  assert.equal(normalizeTitle("  In  Our   Time  "), "in our time");
  assert.equal(normalizeTitle(""), "");
});

/** Mirrors how the guide builds its catalogue map: keyed by the normalised podcast title. */
function buildPodcastMap(titles: string[]): Map<string, PodcastLike> {
  const map = new Map<string, PodcastLike>();
  for (const title of titles) {
    map.set(normalizeTitle(title), { id: title, title });
  }
  return map;
}

test("matchShowToPodcast matches exact or fuzzy show titles", () => {
  const mockPodcast: PodcastLike = {
    id: "p002vsnb",
    title: "In Our Time",
    description: "Melvyn Bragg and guests discuss history and ideas",
    rssUrl: "https://podcasts.files.bbci.co.uk/p002vsnb.rss",
    htmlUrl: "https://www.bbc.co.uk/programmes/p002vsnb",
    imageUrl: "https://example.com/art.jpg",
    genres: ["History"],
    typicalDurationMins: 45
  };

  const podcastMap = new Map<string, PodcastLike>();
  podcastMap.set(normalizeTitle(mockPodcast.title), mockPodcast);

  // Exact match
  const match1 = matchShowToPodcast("In Our Time", undefined, podcastMap);
  assert.equal(match1?.id, "p002vsnb");

  // Case/punctuation insensitive match
  const match2 = matchShowToPodcast("In Our Time:", "Episode about Philosophy", podcastMap);
  assert.equal(match2?.id, "p002vsnb");

  // Show title prefix match
  const match3 = matchShowToPodcast("BBC Radio 4 - In Our Time", undefined, podcastMap);
  assert.equal(match3?.id, "p002vsnb");

  // Unrelated show
  const matchNone = matchShowToPodcast("Weather Forecast", undefined, podcastMap);
  assert.equal(matchNone, undefined);
});

test("matchShowToPodcast absorbs station prefixes and trailing format words", () => {
  const podcastMap = buildPodcastMap(["The Documentary Podcast", "Off the Ball Podcast"]);

  assert.equal(matchShowToPodcast("The Documentary", undefined, podcastMap)?.title, "The Documentary Podcast");
  assert.equal(matchShowToPodcast("Off the Ball", undefined, podcastMap)?.title, "Off the Ball Podcast");
});

test("matchShowToPodcast does not match a single shared word", () => {
  const podcastMap = buildPodcastMap(["Tracks", "BBC Radio", "Limelight", "Screenshot"]);

  // A one-word podcast only ever matches a show with the same single identifying word.
  for (const show of [
    "Night Tracks",
    "Cinematic Soundtracks",
    "City Soundtracks",
    "Sleep Tracks",
    "The Soundtrack Show"
  ]) {
    assert.equal(matchShowToPodcast(show, undefined, podcastMap), undefined, show);
  }

  // "BBC Radio" is nothing but station noise, so it identifies no programme at all.
  assert.equal(matchShowToPodcast("Adam Dowling on BBC Radio Kent", undefined, podcastMap), undefined);

  // ...but the same single word as a whole title is still an exact match.
  assert.equal(matchShowToPodcast("Tracks", undefined, podcastMap)?.title, "Tracks");
  assert.equal(matchShowToPodcast("Limelight", undefined, podcastMap)?.title, "Limelight");
  assert.equal(matchShowToPodcast("Screenshot", undefined, podcastMap)?.title, "Screenshot");
});

test("matchShowToPodcast requires a majority of the longer title", () => {
  const podcastMap = buildPodcastMap(["BBC Essex", "The Bears Podblast", "Beyond Today"]);

  assert.equal(matchShowToPodcast("BBC Essex Sport", undefined, podcastMap), undefined);
  assert.equal(matchShowToPodcast("Blas", undefined, podcastMap), undefined);
  assert.equal(matchShowToPodcast("Today", undefined, podcastMap), undefined);
});

test("matchShowToPodcast does not match a station label to a programme podcast", () => {
  // "live" is part of the 5 Live network name, so on its own it identifies no programme. The
  // remaining word is shared with the show name too, which is what used to reach the podcast.
  const programmes = buildPodcastMap(["5 Live Science Podcast"]);
  assert.equal(matchShowToPodcast("Radio 5 Live", undefined, programmes), undefined);

  // The network's own feed podcast is still the right match for the label.
  const network = buildPodcastMap(["BBC Radio 5 Live", "5 Live Science Podcast"]);
  assert.equal(matchShowToPodcast("Radio 5 Live", undefined, network)?.title, "BBC Radio 5 Live");

  // Words that do identify a programme match on both sides.
  const named = buildPodcastMap(["Saturday Live", "Songs To Live By"]);
  assert.equal(matchShowToPodcast("Saturday Live", undefined, named)?.title, "Saturday Live");
  assert.equal(matchShowToPodcast("Songs To Live By", undefined, named)?.title, "Songs To Live By");
});

test("matchShowToPodcast falls back to an exact episode title", () => {
  const podcastMap = buildPodcastMap(["Newshour"]);

  assert.equal(matchShowToPodcast("Around the World", "Newshour", podcastMap)?.title, "Newshour");
});

test("fillScheduleGaps fills 1.5 - 6.5 minute gaps with BBC News bulletin", () => {
  const baseTime = 1700000000000;
  const entries: ScheduleEntry[] = [
    {
      title: "Trevor Nelson",
      startTimeMs: baseTime,
      endTimeMs: baseTime + 116 * 60 * 1000 // 1h56m (ends at :56, leaving 4m gap)
    },
    {
      title: "Radio 2 Drivetime",
      startTimeMs: baseTime + 120 * 60 * 1000, // starts at :00 (4 min gap)
      endTimeMs: baseTime + 300 * 60 * 1000
    }
  ];

  const result = fillScheduleGaps(entries);
  assert.equal(result.length, 3);
  assert.equal(result[0].title, "Trevor Nelson");
  assert.equal(result[1].title, "BBC News");
  assert.equal(result[1].episodeTitle, "News Summary");
  assert.equal(result[1].startTimeMs, baseTime + 116 * 60 * 1000);
  assert.equal(result[1].endTimeMs, baseTime + 120 * 60 * 1000);
  assert.equal(result[2].title, "Radio 2 Drivetime");
});

test("fillScheduleGaps snaps micro-gaps under 1.5 minutes without creating extra block", () => {
  const baseTime = 1700000000000;
  const entries: ScheduleEntry[] = [
    {
      title: "Show A",
      startTimeMs: baseTime,
      endTimeMs: baseTime + 59 * 60 * 1000 // 59m (1 min gap)
    },
    {
      title: "Show B",
      startTimeMs: baseTime + 60 * 60 * 1000,
      endTimeMs: baseTime + 120 * 60 * 1000
    }
  ];

  const result = fillScheduleGaps(entries);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, "Show A");
  assert.equal(result[0].endTimeMs, baseTime + 60 * 60 * 1000); // Snapped to Show B start
  assert.equal(result[1].title, "Show B");
});

test("fillScheduleGaps leaves large gaps (> 6.5 minutes) untouched", () => {
  const baseTime = 1700000000000;
  const entries: ScheduleEntry[] = [
    {
      title: "Show A",
      startTimeMs: baseTime,
      endTimeMs: baseTime + 30 * 60 * 1000
    },
    {
      title: "Show B",
      startTimeMs: baseTime + 60 * 60 * 1000, // 30 min gap
      endTimeMs: baseTime + 90 * 60 * 1000
    }
  ];

  const result = fillScheduleGaps(entries);
  assert.equal(result.length, 2);
  assert.equal(result[0].endTimeMs, baseTime + 30 * 60 * 1000);
});

test("parseEssSchedule replaces the no_brand_title placeholder", () => {
  const published = { start: "2026-10-05T01:00:00Z", end: "2026-10-05T05:00:00Z" };

  // 5 Live's overnight speech slots come back from ESS with this literal brand title and
  // nothing else but the broadcast date. A date names no programme, so the station stands in.
  const placeholder = parseEssSchedule(
    [{ brand: { title: "no_brand_title" }, episode: { title: "05/10/2026" }, published_time: published }],
    "BBC Radio 5 Live"
  );
  assert.equal(placeholder[0].title, "BBC Radio 5 Live");
  assert.equal(placeholder[0].episodeTitle, undefined);
  // Flagged so the guide does not match a station label to an unrelated podcast.
  assert.equal(placeholder[0].isUnnamed, true);

  // With no usable brand or episode title either, the station name still stands in.
  const bare = parseEssSchedule([{ brand: {}, episode: {}, published_time: published }], "BBC Radio 5 Live");
  assert.equal(bare[0].title, "BBC Radio 5 Live");

  // A brandless slot that does name its episode keeps that name.
  const special = parseEssSchedule(
    [{ brand: {}, episode: { title: "The Reith Lectures" }, published_time: published }],
    "BBC Radio 4"
  );
  assert.equal(special[0].title, "The Reith Lectures");

  // A real brand still wins, and the date stays as the subtitle where it dates the edition.
  const real = parseEssSchedule(
    [{ brand: { title: "Shipping Forecast" }, episode: { title: "05/10/2026" }, published_time: published }],
    "BBC Radio 4"
  );
  assert.equal(real[0].title, "Shipping Forecast");
  assert.equal(real[0].episodeTitle, "05/10/2026");
  // A named slot stays matchable, even when the programme and the station share a name.
  assert.equal(real[0].isUnnamed, false);

  const sameName = parseEssSchedule(
    [{ brand: { title: "Radio 1 Anthems" }, episode: { title: "Swedish House Mafia" }, published_time: published }],
    "Radio 1 Anthems"
  );
  assert.equal(sameName[0].title, "Radio 1 Anthems");
  assert.equal(sameName[0].isUnnamed, false);
});

