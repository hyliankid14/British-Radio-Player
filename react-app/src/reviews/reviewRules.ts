/**
 * Pure domain rules and eligibility checks for store reviews.
 * Separated from React Native bindings so it can be verified in unit tests.
 */

export interface ReviewPromptState {
  firstLaunchMs: number;
  sessionCount: number;
  activeDays: string[];
  totalListeningSeconds: number;
  completedEpisodesCount: number;
  lastPromptMs: number;
  lastPromptVersion: string;
  promptCount: number;
  hasReviewed: boolean;
}

export const DEFAULT_REVIEW_PROMPT_STATE: ReviewPromptState = {
  firstLaunchMs: 0,
  sessionCount: 0,
  activeDays: [],
  totalListeningSeconds: 0,
  completedEpisodesCount: 0,
  lastPromptMs: 0,
  lastPromptVersion: "",
  promptCount: 0,
  hasReviewed: false
};

/**
 * Minimum distinct calendar days the app must have been opened before considering
 * an automated review prompt. Ensures we never prompt brand new or single-day users.
 */
export const MIN_ACTIVE_DAYS = 3;

/**
 * Minimum distinct app sessions before considering an automated review prompt.
 */
export const MIN_SESSIONS = 5;

/**
 * Minimum cumulative listening time in seconds (30 minutes) required for engagement.
 */
export const MIN_LISTENING_SECONDS = 1800;

/**
 * Minimum completed podcast episodes before considering a prompt.
 */
export const MIN_COMPLETED_EPISODES = 2;

/**
 * Reduced listening threshold (15 minutes) if the user has actively saved favourite
 * stations or subscribed to podcasts, demonstrating explicit positive engagement.
 */
export const MIN_LISTENING_WITH_FAVOURITES_SECONDS = 900;

/**
 * Minimum duration in seconds the current app session must have been active (2 minutes).
 * Avoids popping review dialogs during app startup or initial browsing.
 */
export const MIN_SESSION_DURATION_SECONDS = 120;

/**
 * Minimum cooldown between automated review prompts (60 days in milliseconds).
 */
export const REVIEW_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Lifetime maximum times the automated in-app review prompt can be presented.
 * Aligns with Apple and Google Play recommendations (Apple limits to 3 per 365-day period).
 */
export const MAX_LIFETIME_PROMPT_COUNT = 3;

/**
 * Minimum gap between session counter increments (15 minutes).
 * Prevents brief backgrounding/switching from inflating the session count.
 */
export const SESSION_DEDUPE_MS = 15 * 60 * 1000;

export const IOS_STORE_REVIEW_URL =
  "https://apps.apple.com/app/british-radio-player/id6740921477?action=write-review";
export const ANDROID_PLAY_STORE_MARKET_URL =
  "market://details?id=com.hyliankid14.bbcradioplayer";
export const ANDROID_PLAY_STORE_WEB_URL =
  "https://play.google.com/store/apps/details?id=com.hyliankid14.bbcradioplayer";

/**
 * Only iOS App Store and Google Play Android builds support store reviews.
 * GitHub sideloaded builds and Web never prompt.
 */
export function isStoreReviewSupported(
  channel: string,
  os: string
): boolean {
  if (os === "web") return false;
  return channel === "ios" || channel === "play";
}

export interface ReviewEligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Evaluates whether an automated review prompt should be shown.
 * All criteria must be satisfied to prevent annoying the user.
 */
export function checkReviewEligibility(
  state: ReviewPromptState,
  options: {
    channel: string;
    os: string;
    currentVersion: string;
    nowMs?: number;
    sessionDurationSeconds?: number;
    hasFavoritesOrSubs?: boolean;
  }
): ReviewEligibilityResult {
  if (!isStoreReviewSupported(options.channel, options.os)) {
    return { eligible: false, reason: "Store reviews are not supported on this build channel" };
  }

  if (state.hasReviewed) {
    return { eligible: false, reason: "User has already reviewed or completed review flow" };
  }

  if (state.promptCount >= MAX_LIFETIME_PROMPT_COUNT) {
    return { eligible: false, reason: `Reached maximum lifetime prompt limit (${MAX_LIFETIME_PROMPT_COUNT})` };
  }

  if (state.lastPromptVersion && state.lastPromptVersion === options.currentVersion) {
    return { eligible: false, reason: `Already prompted on current app version (${options.currentVersion})` };
  }

  const now = options.nowMs ?? Date.now();
  if (state.lastPromptMs > 0 && now - state.lastPromptMs < REVIEW_COOLDOWN_MS) {
    return { eligible: false, reason: "Cooldown period has not elapsed since last prompt" };
  }

  const sessionDuration = options.sessionDurationSeconds ?? 0;
  if (sessionDuration < MIN_SESSION_DURATION_SECONDS) {
    return {
      eligible: false,
      reason: `Session duration too short (${sessionDuration}s < ${MIN_SESSION_DURATION_SECONDS}s)`
    };
  }

  if (state.activeDays.length < MIN_ACTIVE_DAYS) {
    return {
      eligible: false,
      reason: `Not enough active days (${state.activeDays.length} < ${MIN_ACTIVE_DAYS})`
    };
  }

  if (state.sessionCount < MIN_SESSIONS) {
    return {
      eligible: false,
      reason: `Not enough sessions (${state.sessionCount} < ${MIN_SESSIONS})`
    };
  }

  const hasFavs = options.hasFavoritesOrSubs ?? false;
  const hasSufficientListening = state.totalListeningSeconds >= MIN_LISTENING_SECONDS;
  const hasCompletedEpisodes = state.completedEpisodesCount >= MIN_COMPLETED_EPISODES;
  const hasFavEngagement = hasFavs && state.totalListeningSeconds >= MIN_LISTENING_WITH_FAVOURITES_SECONDS;

  if (!hasSufficientListening && !hasCompletedEpisodes && !hasFavEngagement) {
    return { eligible: false, reason: "Insufficient listening or completion engagement" };
  }

  return { eligible: true };
}

/**
 * Computes updated review prompt state when recording a new session.
 */
export function computeSessionUpdate(
  state: ReviewPromptState,
  now: Date,
  lastRecordedMs: number
): { nextState: ReviewPromptState; recordedMs: number; modified: boolean } {
  const nowMs = now.getTime();
  let modified = false;
  const next: ReviewPromptState = {
    ...state,
    activeDays: [...state.activeDays]
  };

  if (next.firstLaunchMs === 0) {
    next.firstLaunchMs = nowMs;
    modified = true;
  }

  const dateStr = now.toISOString().slice(0, 10);
  if (!next.activeDays.includes(dateStr)) {
    next.activeDays.push(dateStr);
    modified = true;
  }

  let nextRecordedMs = lastRecordedMs;
  if (nowMs - lastRecordedMs >= SESSION_DEDUPE_MS) {
    nextRecordedMs = nowMs;
    next.sessionCount += 1;
    modified = true;
  }

  return { nextState: next, recordedMs: nextRecordedMs, modified };
}
