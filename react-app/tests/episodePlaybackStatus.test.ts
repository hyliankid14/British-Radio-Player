import test from "node:test";
import assert from "node:assert/strict";
import {
  computeEpisodePlaybackStatus,
  shouldMarkEpisodePlayed,
  resolveEffectiveDuration,
  EPISODE_CHECK_GREEN,
  EPISODE_TILDE_AMBER
} from "../src/podcasts/episodePlaybackStatus.ts";

test("episode check and tilde colors match archived Kotlin app colors", () => {
  assert.equal(EPISODE_CHECK_GREEN, "#4CAF50");
  assert.equal(EPISODE_TILDE_AMBER, "#FF5252");
});

test("unplayed episode with no progress shows no indicator and no progress bar", () => {
  const status = computeEpisodePlaybackStatus(false, 45, 0);
  assert.equal(status.isPlayed, false);
  assert.equal(status.isInProgress, false);
  assert.equal(status.progressPercent, 0);
});

test("played episode shows played indicator and hides progress bar", () => {
  const status = computeEpisodePlaybackStatus(true, 45, 1200);
  assert.equal(status.isPlayed, true);
  assert.equal(status.isInProgress, false);
  assert.equal(status.progressPercent, 0);
});

test("played episode without progress still shows played indicator", () => {
  const status = computeEpisodePlaybackStatus(true, 45, 0);
  assert.equal(status.isPlayed, true);
  assert.equal(status.isInProgress, false);
  assert.equal(status.progressPercent, 0);
});

test("episode in progress below 95% shows in-progress indicator and progress bar", () => {
  // 15 mins into 60 mins = 25%
  const status = computeEpisodePlaybackStatus(false, 60, 15 * 60);
  assert.equal(status.isPlayed, false);
  assert.equal(status.isInProgress, true);
  assert.equal(status.progressPercent, 25);
});

test("episode in progress just under 95% threshold shows in-progress indicator", () => {
  // 94% of 100 mins (6000s) = 5640s
  const status = computeEpisodePlaybackStatus(false, 100, 5640);
  assert.equal(status.isPlayed, false);
  assert.equal(status.isInProgress, true);
  assert.equal(status.progressPercent, 94);
});

test("episode at or above 95% threshold hides in-progress indicator but retains progress bar", () => {
  // Exactly 95% of 100 mins (6000s) = 5700s
  const statusAt95 = computeEpisodePlaybackStatus(false, 100, 5700);
  assert.equal(statusAt95.isPlayed, false);
  assert.equal(statusAt95.isInProgress, false);
  assert.equal(statusAt95.progressPercent, 95);

  // 98% of 100 mins
  const statusAt98 = computeEpisodePlaybackStatus(false, 100, 5880);
  assert.equal(statusAt98.isPlayed, false);
  assert.equal(statusAt98.isInProgress, false);
  assert.equal(statusAt98.progressPercent, 98);
});

test("episode progress exceeding duration clamps progress bar to 100% and hides in-progress", () => {
  const status = computeEpisodePlaybackStatus(false, 30, 40 * 60);
  assert.equal(status.isPlayed, false);
  assert.equal(status.isInProgress, false);
  assert.equal(status.progressPercent, 100);
});

test("invalid or zero duration shows nothing even if progress is positive", () => {
  const statusZero = computeEpisodePlaybackStatus(false, 0, 300);
  assert.equal(statusZero.isPlayed, false);
  assert.equal(statusZero.isInProgress, false);
  assert.equal(statusZero.progressPercent, 0);

  const statusNeg = computeEpisodePlaybackStatus(false, -10, 300);
  assert.equal(statusNeg.isPlayed, false);
  assert.equal(statusNeg.isInProgress, false);
  assert.equal(statusNeg.progressPercent, 0);
});

test("negative progress is ignored", () => {
  const status = computeEpisodePlaybackStatus(false, 30, -50);
  assert.equal(status.isPlayed, false);
  assert.equal(status.isInProgress, false);
  assert.equal(status.progressPercent, 0);
});

test("shouldMarkEpisodePlayed returns false when position or duration is invalid", () => {
  assert.equal(shouldMarkEpisodePlayed(0, 1000), false);
  assert.equal(shouldMarkEpisodePlayed(-10, 1000), false);
  assert.equal(shouldMarkEpisodePlayed(500, 0), false);
  assert.equal(shouldMarkEpisodePlayed(500, -100), false);
  assert.equal(shouldMarkEpisodePlayed(Number.NaN, 1000), false);
  assert.equal(shouldMarkEpisodePlayed(500, Number.NaN), false);
  assert.equal(shouldMarkEpisodePlayed(Infinity, 1000), false);
  assert.equal(shouldMarkEpisodePlayed(500, Infinity), false);
});

test("shouldMarkEpisodePlayed marks played when position reaches 95% (matching Kotlin app)", () => {
  const duration = 1800; // 30 minutes
  // 94.9% -> false
  assert.equal(shouldMarkEpisodePlayed(duration * 0.949, duration), false);
  // Exactly 95% -> true
  assert.equal(shouldMarkEpisodePlayed(duration * 0.95, duration), true);
  // 98% -> true
  assert.equal(shouldMarkEpisodePlayed(duration * 0.98, duration), true);
  // 100% -> true
  assert.equal(shouldMarkEpisodePlayed(duration, duration), true);
});

test("shouldMarkEpisodePlayed marks played when within 1 second of end (matching Kotlin seek/end buffer)", () => {
  const duration = 1800;
  // duration - 1 second -> true
  assert.equal(shouldMarkEpisodePlayed(duration - 1, duration), true);
  // duration - 0.5 seconds -> true
  assert.equal(shouldMarkEpisodePlayed(duration - 0.5, duration), true);
  // Past duration -> true
  assert.equal(shouldMarkEpisodePlayed(duration + 10, duration), true);
});

test("resolveEffectiveDuration prioritizes stream metadata over store and catalog duration", () => {
  assert.equal(resolveEffectiveDuration(1805, 1800, 30), 1805);
  assert.equal(resolveEffectiveDuration(1805, 0, 0), 1805);
});

test("resolveEffectiveDuration falls back to store duration when stream duration is unavailable", () => {
  assert.equal(resolveEffectiveDuration(0, 1800, 30), 1800);
  assert.equal(resolveEffectiveDuration(null, 1800, 30), 1800);
  assert.equal(resolveEffectiveDuration(Number.NaN, 1800, 30), 1800);
});

test("resolveEffectiveDuration falls back to catalog duration in minutes when stream and store are 0", () => {
  assert.equal(resolveEffectiveDuration(0, 0, 45), 45 * 60);
  assert.equal(resolveEffectiveDuration(null, null, 45), 2700);
});

test("resolveEffectiveDuration returns 0 when no valid duration exists", () => {
  assert.equal(resolveEffectiveDuration(0, 0, 0), 0);
  assert.equal(resolveEffectiveDuration(null, undefined, 0), 0);
  assert.equal(resolveEffectiveDuration(-10, -5, -1), 0);
});

