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
import { fillScheduleGaps, type ScheduleEntry } from "../src/api/showInfo.ts";

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

