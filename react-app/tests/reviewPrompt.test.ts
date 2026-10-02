import test from "node:test";
import assert from "node:assert/strict";

import {
  isStoreReviewSupported,
  checkReviewEligibility,
  computeSessionUpdate,
  MIN_ACTIVE_DAYS,
  MIN_SESSIONS,
  MIN_LISTENING_SECONDS,
  MIN_COMPLETED_EPISODES,
  MIN_LISTENING_WITH_FAVOURITES_SECONDS,
  MIN_SESSION_DURATION_SECONDS,
  REVIEW_COOLDOWN_MS,
  MAX_LIFETIME_PROMPT_COUNT,
  type ReviewPromptState,
  DEFAULT_REVIEW_PROMPT_STATE
} from "../src/reviews/reviewRules.ts";

function createCleanState(): ReviewPromptState {
  return { ...DEFAULT_REVIEW_PROMPT_STATE, activeDays: [] };
}

test("isStoreReviewSupported - distribution channels and platforms", () => {
  assert.equal(isStoreReviewSupported("ios", "ios"), true, "iOS App Store build should be supported");
  assert.equal(isStoreReviewSupported("play", "android"), true, "Google Play Android build should be supported");
  assert.equal(isStoreReviewSupported("github", "android"), false, "GitHub Android release build must NOT be supported");
  assert.equal(isStoreReviewSupported("ios", "web"), false, "Web platform must NOT be supported");
  assert.equal(isStoreReviewSupported("play", "web"), false, "Web platform must NOT be supported");
});

test("checkReviewEligibility - rejects unsupported build channels and platforms", () => {
  const state: ReviewPromptState = {
    ...createCleanState(),
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 10,
    totalListeningSeconds: 3600
  };

  const githubResult = checkReviewEligibility(state, {
    channel: "github",
    os: "android",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 200
  });
  assert.equal(githubResult.eligible, false);
  assert.match(githubResult.reason || "", /not supported/i);

  const webResult = checkReviewEligibility(state, {
    channel: "ios",
    os: "web",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 200
  });
  assert.equal(webResult.eligible, false);
});

test("checkReviewEligibility - rejects if user has already reviewed", () => {
  const state: ReviewPromptState = {
    ...createCleanState(),
    hasReviewed: true,
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 8,
    totalListeningSeconds: 4000
  };

  const result = checkReviewEligibility(state, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 300
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason || "", /already reviewed/i);
});

test("checkReviewEligibility - enforces lifetime prompt limit", () => {
  const state: ReviewPromptState = {
    ...createCleanState(),
    promptCount: MAX_LIFETIME_PROMPT_COUNT,
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 12,
    totalListeningSeconds: 5000
  };

  const result = checkReviewEligibility(state, {
    channel: "play",
    os: "android",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 300
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason || "", /lifetime prompt limit/i);
});

test("checkReviewEligibility - prevents prompting twice on the same app version", () => {
  const state: ReviewPromptState = {
    ...createCleanState(),
    promptCount: 1,
    lastPromptVersion: "2.0.1",
    lastPromptMs: Date.now() - (REVIEW_COOLDOWN_MS + 1000),
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 10,
    totalListeningSeconds: 3600
  };

  const result = checkReviewEligibility(state, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 300
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason || "", /current app version/i);

  // If app was updated to a new version and cooldown passed, eligibility check can proceed
  const updatedResult = checkReviewEligibility(state, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.2",
    sessionDurationSeconds: 300
  });
  assert.equal(updatedResult.eligible, true);
});

test("checkReviewEligibility - enforces 60-day cooldown between prompts", () => {
  const now = Date.now();
  const state: ReviewPromptState = {
    ...createCleanState(),
    promptCount: 1,
    lastPromptVersion: "2.0.0",
    lastPromptMs: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago (less than 60 days)
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 15,
    totalListeningSeconds: 4000
  };

  const result = checkReviewEligibility(state, {
    channel: "play",
    os: "android",
    currentVersion: "2.0.1",
    nowMs: now,
    sessionDurationSeconds: 300
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason || "", /cooldown/i);

  // After 61 days
  const eligibleAfterCooldown = checkReviewEligibility(state, {
    channel: "play",
    os: "android",
    currentVersion: "2.0.1",
    nowMs: now + REVIEW_COOLDOWN_MS + 1000,
    sessionDurationSeconds: 300
  });
  assert.equal(eligibleAfterCooldown.eligible, true);
});

test("checkReviewEligibility - requires minimum current session duration (no popup at launch)", () => {
  const state: ReviewPromptState = {
    ...createCleanState(),
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 6,
    totalListeningSeconds: 2500
  };

  const immediateResult = checkReviewEligibility(state, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 30 // Only 30s into app open
  });
  assert.equal(immediateResult.eligible, false);
  assert.match(immediateResult.reason || "", /session duration too short/i);

  const afterMinDuration = checkReviewEligibility(state, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.1",
    sessionDurationSeconds: MIN_SESSION_DURATION_SECONDS + 10
  });
  assert.equal(afterMinDuration.eligible, true);
});

test("checkReviewEligibility - requires at least 3 distinct active days and 5 sessions", () => {
  // Only 2 days
  const twoDaysState: ReviewPromptState = {
    ...createCleanState(),
    activeDays: ["2026-09-01", "2026-09-02"],
    sessionCount: 8,
    totalListeningSeconds: 3600
  };
  const daysResult = checkReviewEligibility(twoDaysState, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 200
  });
  assert.equal(daysResult.eligible, false);
  assert.match(daysResult.reason || "", /active days/i);

  // 3 days, but only 4 sessions
  const fourSessionsState: ReviewPromptState = {
    ...createCleanState(),
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 4,
    totalListeningSeconds: 3600
  };
  const sessionsResult = checkReviewEligibility(fourSessionsState, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 200
  });
  assert.equal(sessionsResult.eligible, false);
  assert.match(sessionsResult.reason || "", /sessions/i);
});

test("checkReviewEligibility - engagement threshold options", () => {
  const baseQualifyingState: ReviewPromptState = {
    ...createCleanState(),
    activeDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
    sessionCount: 6,
    totalListeningSeconds: 100,
    completedEpisodesCount: 0
  };

  // Case 1: Insufficient listening, 0 completed episodes, no favourites -> ineligible
  const ineligible = checkReviewEligibility(baseQualifyingState, {
    channel: "ios",
    os: "ios",
    currentVersion: "2.0.1",
    sessionDurationSeconds: 200,
    hasFavoritesOrSubs: false
  });
  assert.equal(ineligible.eligible, false);
  assert.match(ineligible.reason || "", /insufficient listening/i);

  // Case 2: Listening >= 1800s (30 mins) -> eligible
  const eligibleListening = checkReviewEligibility(
    { ...baseQualifyingState, totalListeningSeconds: MIN_LISTENING_SECONDS },
    { channel: "ios", os: "ios", currentVersion: "2.0.1", sessionDurationSeconds: 200 }
  );
  assert.equal(eligibleListening.eligible, true);

  // Case 3: Completed >= 2 episodes even if listening time is low -> eligible
  const eligibleEpisodes = checkReviewEligibility(
    { ...baseQualifyingState, completedEpisodesCount: MIN_COMPLETED_EPISODES },
    { channel: "ios", os: "ios", currentVersion: "2.0.1", sessionDurationSeconds: 200 }
  );
  assert.equal(eligibleEpisodes.eligible, true);

  // Case 4: Has favourites/subscriptions and listening >= 900s (15 mins) -> eligible
  const eligibleWithFavs = checkReviewEligibility(
    { ...baseQualifyingState, totalListeningSeconds: MIN_LISTENING_WITH_FAVOURITES_SECONDS },
    { channel: "ios", os: "ios", currentVersion: "2.0.1", sessionDurationSeconds: 200, hasFavoritesOrSubs: true }
  );
  assert.equal(eligibleWithFavs.eligible, true);
});

test("computeSessionUpdate - manages first launch, active days, and deduplicated sessions", () => {
  let state = createCleanState();
  let lastRecordedMs = 0;

  // First session
  const update1 = computeSessionUpdate(state, new Date("2026-10-01T10:00:00Z"), lastRecordedMs);
  assert.equal(update1.modified, true);
  assert.equal(update1.nextState.sessionCount, 1);
  assert.deepEqual(update1.nextState.activeDays, ["2026-10-01"]);
  assert.equal(update1.nextState.firstLaunchMs, new Date("2026-10-01T10:00:00Z").getTime());

  // Rapid revisit within 5 minutes on same day -> session count does not increment
  const update2 = computeSessionUpdate(update1.nextState, new Date("2026-10-01T10:05:00Z"), update1.recordedMs);
  assert.equal(update2.modified, false);
  assert.equal(update2.nextState.sessionCount, 1);

  // Later revisit after 20 minutes on same day -> session count increments, same date in activeDays
  const update3 = computeSessionUpdate(update1.nextState, new Date("2026-10-01T10:25:00Z"), update1.recordedMs);
  assert.equal(update3.modified, true);
  assert.equal(update3.nextState.sessionCount, 2);
  assert.deepEqual(update3.nextState.activeDays, ["2026-10-01"]);

  // Next day revisit -> session count increments and activeDays appends new date
  const update4 = computeSessionUpdate(update3.nextState, new Date("2026-10-02T09:00:00Z"), update3.recordedMs);
  assert.equal(update4.modified, true);
  assert.equal(update4.nextState.sessionCount, 3);
  assert.deepEqual(update4.nextState.activeDays, ["2026-10-01", "2026-10-02"]);
});
