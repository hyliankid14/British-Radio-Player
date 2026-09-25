import test from "node:test";
import assert from "node:assert/strict";
import { formatSongPlayedAt } from "../src/utils/dateUtils.ts";

test("formatSongPlayedAt formats empty or invalid timestamps gracefully", () => {
  assert.equal(formatSongPlayedAt(undefined), "");
  assert.equal(formatSongPlayedAt(0), "");
  assert.equal(formatSongPlayedAt(-100), "");
  assert.equal(formatSongPlayedAt(NaN), "");
});

test("formatSongPlayedAt formats Today correctly", () => {
  // 2026-09-25 14:32:00
  const baseDate = new Date(2026, 8, 25, 14, 32, 0);
  const now = new Date(2026, 8, 25, 18, 0, 0).getTime();

  assert.equal(formatSongPlayedAt(baseDate.getTime(), now), "Today at 14:32");
});

test("formatSongPlayedAt formats Yesterday correctly", () => {
  // 2026-09-24 23:15:00
  const yesterdayDate = new Date(2026, 8, 24, 23, 15, 0);
  const now = new Date(2026, 8, 25, 18, 0, 0).getTime();

  assert.equal(formatSongPlayedAt(yesterdayDate.getTime(), now), "Yesterday at 23:15");
});

test("formatSongPlayedAt formats earlier dates in current year", () => {
  // 2026-09-22 09:05:00 (Tuesday)
  const pastDate = new Date(2026, 8, 22, 9, 5, 0);
  const now = new Date(2026, 8, 25, 18, 0, 0).getTime();

  assert.equal(formatSongPlayedAt(pastDate.getTime(), now), "Tue 22 Sep at 09:05");
});

test("formatSongPlayedAt includes year for dates from previous years", () => {
  // 2025-11-15 11:20:00 (Saturday)
  const pastYearDate = new Date(2025, 10, 15, 11, 20, 0);
  const now = new Date(2026, 8, 25, 18, 0, 0).getTime();

  assert.equal(formatSongPlayedAt(pastYearDate.getTime(), now), "Sat 15 Nov 2025 at 11:20");
});
