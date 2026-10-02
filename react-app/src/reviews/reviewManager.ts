import { Platform, Linking } from "react-native";
import * as StoreReview from "expo-store-review";
import { DISTRIBUTION_CHANNEL } from "../config/distribution.ts";
import { appVersion } from "../config/buildInfo.ts";
import { Preferences } from "../storage/preferences.ts";
import {
  ReviewPromptState,
  ReviewEligibilityResult,
  checkReviewEligibility,
  computeSessionUpdate,
  isStoreReviewSupported as isStoreReviewSupportedRule,
  MIN_ACTIVE_DAYS,
  MIN_SESSIONS,
  MIN_LISTENING_SECONDS,
  MIN_COMPLETED_EPISODES,
  MIN_LISTENING_WITH_FAVOURITES_SECONDS,
  MIN_SESSION_DURATION_SECONDS,
  REVIEW_COOLDOWN_MS,
  MAX_LIFETIME_PROMPT_COUNT,
  SESSION_DEDUPE_MS,
  IOS_STORE_REVIEW_URL,
  ANDROID_PLAY_STORE_MARKET_URL,
  ANDROID_PLAY_STORE_WEB_URL
} from "./reviewRules.ts";

export {
  type ReviewPromptState,
  type ReviewEligibilityResult,
  MIN_ACTIVE_DAYS,
  MIN_SESSIONS,
  MIN_LISTENING_SECONDS,
  MIN_COMPLETED_EPISODES,
  MIN_LISTENING_WITH_FAVOURITES_SECONDS,
  MIN_SESSION_DURATION_SECONDS,
  REVIEW_COOLDOWN_MS,
  MAX_LIFETIME_PROMPT_COUNT,
  SESSION_DEDUPE_MS,
  IOS_STORE_REVIEW_URL,
  ANDROID_PLAY_STORE_MARKET_URL,
  ANDROID_PLAY_STORE_WEB_URL
};

let currentSessionStartMs = Date.now();
let lastSessionRecordedMs = 0;

export function getSessionDurationSeconds(nowMs = Date.now()): number {
  return Math.max(0, Math.floor((nowMs - currentSessionStartMs) / 1000));
}

export function setSessionStartForTesting(startMs: number): void {
  currentSessionStartMs = startMs;
  lastSessionRecordedMs = 0;
}

/**
 * Checks if the current build channel and platform support store reviews.
 */
export function isStoreReviewSupported(
  channel: string = DISTRIBUTION_CHANNEL,
  os: string = Platform.OS
): boolean {
  return isStoreReviewSupportedRule(channel, os);
}

/**
 * Records an active app session, tracking first launch, distinct days, and session counts.
 */
export function recordSessionStart(now = new Date()): void {
  currentSessionStartMs = now.getTime();
  const state = Preferences.getReviewPromptState();
  const update = computeSessionUpdate(state, now, lastSessionRecordedMs);
  lastSessionRecordedMs = update.recordedMs;

  if (update.modified) {
    Preferences.setReviewPromptState(update.nextState);
  }
}

/**
 * Accumulates listening duration in seconds.
 */
export function recordListeningSeconds(seconds: number): void {
  if (seconds <= 0) return;
  const state = Preferences.getReviewPromptState();
  state.totalListeningSeconds += Math.floor(seconds);
  Preferences.setReviewPromptState(state);
}

/**
 * Increments the completed podcast episode counter.
 */
export function recordEpisodeCompleted(): void {
  const state = Preferences.getReviewPromptState();
  state.completedEpisodesCount += 1;
  Preferences.setReviewPromptState(state);
}

/**
 * Marks that the user has reviewed or engaged with review flow, permanently
 * disabling future automated review prompts.
 */
export function markUserReviewed(): void {
  const state = Preferences.getReviewPromptState();
  state.hasReviewed = true;
  Preferences.setReviewPromptState(state);
}

/**
 * Evaluates whether an automated review prompt should be shown.
 */
export function isReviewPromptEligible(
  options: {
    nowMs?: number;
    currentVersion?: string;
    sessionDurationSeconds?: number;
    hasFavoritesOrSubs?: boolean;
    distributionChannel?: string;
    platformOs?: string;
  } = {}
): ReviewEligibilityResult {
  const state = Preferences.getReviewPromptState();
  const now = options.nowMs ?? Date.now();
  const sessionDuration = options.sessionDurationSeconds ?? getSessionDurationSeconds(now);
  const hasFavs =
    options.hasFavoritesOrSubs ??
    (Preferences.getFavorites().length > 0 || Preferences.getSubscribedPodcasts().length > 0);

  return checkReviewEligibility(state, {
    channel: options.distributionChannel ?? DISTRIBUTION_CHANNEL,
    os: options.platformOs ?? Platform.OS,
    currentVersion: options.currentVersion ?? appVersion(),
    nowMs: now,
    sessionDurationSeconds: sessionDuration,
    hasFavoritesOrSubs: hasFavs
  });
}

/**
 * Checks eligibility and requests the native store review dialog if eligible.
 * Returns true if a review prompt was triggered.
 */
export async function requestReviewIfEligible(triggerContext?: string): Promise<boolean> {
  const eligibility = isReviewPromptEligible();
  if (!eligibility.eligible) {
    return false;
  }

  // Update prompt record before presenting to avoid re-triggering on race conditions
  const state = Preferences.getReviewPromptState();
  state.lastPromptMs = Date.now();
  state.lastPromptVersion = appVersion();
  state.promptCount += 1;
  Preferences.setReviewPromptState(state);

  try {
    const isAvailable = await StoreReview.isAvailableAsync();
    if (isAvailable) {
      await StoreReview.requestReview();
      return true;
    }
  } catch (error) {
    console.warn(`[ReviewManager] StoreReview failed on trigger "${triggerContext}":`, error);
  }
  return false;
}

/**
 * Initiates user-requested review from the Settings screen.
 * Always marks the user as reviewed so automated prompts are permanently disabled.
 */
export async function requestManualReview(): Promise<void> {
  markUserReviewed();

  if (Platform.OS === "ios") {
    try {
      const isAvailable = await StoreReview.isAvailableAsync();
      if (isAvailable) {
        await StoreReview.requestReview();
        return;
      }
    } catch {
      // Fall through to direct link
    }
    void Linking.openURL(IOS_STORE_REVIEW_URL);
  } else if (Platform.OS === "android") {
    try {
      const isAvailable = await StoreReview.isAvailableAsync();
      if (isAvailable) {
        await StoreReview.requestReview();
        return;
      }
    } catch {
      // Fall through to direct link
    }
    try {
      const canOpenMarket = await Linking.canOpenURL(ANDROID_PLAY_STORE_MARKET_URL);
      if (canOpenMarket) {
        await Linking.openURL(ANDROID_PLAY_STORE_MARKET_URL);
        return;
      }
    } catch {}
    void Linking.openURL(ANDROID_PLAY_STORE_WEB_URL);
  }
}

let hasInitialized = false;
let previousSubscribedCount = 0;

/**
 * Initializes review prompt lifecycle and monitors for positive engagement events
 * such as podcast subscriptions.
 */
export function initReviewManager(): () => void {
  if (hasInitialized) return () => {};
  hasInitialized = true;

  recordSessionStart();

  try {
    previousSubscribedCount = Preferences.getSubscribedPodcasts().length;
  } catch {
    previousSubscribedCount = 0;
  }

  const subscription = Preferences.onChanged((key) => {
    if (key === "pref_subscribed_podcasts") {
      try {
        const currentCount = Preferences.getSubscribedPodcasts().length;
        if (currentCount > previousSubscribedCount) {
          previousSubscribedCount = currentCount;
          setTimeout(() => void requestReviewIfEligible("podcast_subscribed"), 2000);
        } else {
          previousSubscribedCount = currentCount;
        }
      } catch {}
    }
  });

  return () => {
    subscription.remove();
    hasInitialized = false;
  };
}
