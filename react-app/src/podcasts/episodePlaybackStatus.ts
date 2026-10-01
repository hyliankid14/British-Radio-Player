/**
 * Playback progress and played-state calculation for podcast episode list items,
 * matching the legacy Android Kotlin behaviour in PodcastAdapter, SavedEpisodesAdapter,
 * and PlayedHistoryAdapter.
 */

export const EPISODE_CHECK_GREEN = "#4CAF50";
export const EPISODE_TILDE_AMBER = "#FF5252";

export interface EpisodePlaybackStatus {
  isPlayed: boolean;
  isInProgress: boolean;
  progressPercent: number; // 0..100
}

export const EPISODE_COMPLETION_RATIO_THRESHOLD = 0.95;
export const EPISODE_COMPLETION_END_BUFFER_SECONDS = 1;

/**
 * Determines whether an episode should be marked played based on its playback position and duration.
 * Matches RadioService.kt:
 * - Marked played when >= 95% consumed (`ratio >= 0.95`)
 * - Or when within 1 second of known duration (`clamped >= knownDuration - 1000L`)
 */
export function shouldMarkEpisodePlayed(
  positionSeconds: number,
  durationSeconds: number
): boolean {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) {
    return false;
  }
  if (durationSeconds <= 0 || positionSeconds <= 0) {
    return false;
  }
  if (positionSeconds >= durationSeconds - EPISODE_COMPLETION_END_BUFFER_SECONDS) {
    return true;
  }
  return positionSeconds / durationSeconds >= EPISODE_COMPLETION_RATIO_THRESHOLD;
}

/**
 * Resolves the effective duration of an episode in seconds, using stream metadata first,
 * then store duration, then catalog episode duration in minutes.
 * Mirrors RadioService.kt: `if (player.duration > 0L) player.duration else currentEpisodeDurationMs`
 */
export function resolveEffectiveDuration(
  streamDurationSeconds?: number | null,
  storeDurationSeconds?: number | null,
  episodeDurationMins?: number | null
): number {
  if (streamDurationSeconds && Number.isFinite(streamDurationSeconds) && streamDurationSeconds > 0) {
    return streamDurationSeconds;
  }
  if (storeDurationSeconds && Number.isFinite(storeDurationSeconds) && storeDurationSeconds > 0) {
    return storeDurationSeconds;
  }
  if (episodeDurationMins && Number.isFinite(episodeDurationMins) && episodeDurationMins > 0) {
    return episodeDurationMins * 60;
  }
  return 0;
}

/**
 * Computes the played status, in-progress flag, and progress bar percentage
 * for an episode list item.
 *
 * Rules:
 * - If episode is marked played:
 *   - isPlayed is true (shows checkmark)
 *   - isInProgress is false
 *   - progressPercent is 0 (progress bar is hidden)
 * - If episode is not played and has valid duration (>0) and progress (>0):
 *   - ratio = progress / duration
 *   - progressPercent = Math.round(ratio * 100) clamped to 0..100 (progress bar is visible)
 *   - isInProgress = ratio < 0.95 (shows ~ in-progress indicator when below 95%)
 * - Otherwise:
 *   - isPlayed is false
 *   - isInProgress is false
 *   - progressPercent is 0 (progress bar is hidden)
 */
export function computeEpisodePlaybackStatus(
  isPlayed: boolean,
  durationMins: number,
  progressSeconds: number
): EpisodePlaybackStatus {
  if (isPlayed) {
    return {
      isPlayed: true,
      isInProgress: false,
      progressPercent: 0
    };
  }

  const durationSeconds = (durationMins > 0 ? durationMins : 0) * 60;
  if (durationSeconds > 0 && progressSeconds > 0) {
    const ratio = progressSeconds / durationSeconds;
    const progressPercent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
    const isInProgress = ratio < EPISODE_COMPLETION_RATIO_THRESHOLD;
    return {
      isPlayed: false,
      isInProgress,
      progressPercent
    };
  }

  return {
    isPlayed: false,
    isInProgress: false,
    progressPercent: 0
  };
}

