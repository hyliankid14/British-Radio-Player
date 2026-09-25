export const MIN_SCROBBLE_TIME_MS = 30_000; // 30 seconds minimum
export const MAX_SCROBBLE_THRESHOLD_MS = 240_000; // 4 minutes max
export const DEFAULT_RADIO_THRESHOLD_MS = 60_000; // 1 minute default if duration unknown

export function calculateScrobbleThresholdMs(durationSec: number): number {
  if (durationSec <= 0) {
    return DEFAULT_RADIO_THRESHOLD_MS;
  }
  const durationMs = durationSec * 1000;
  const halfDuration = durationMs / 2;
  const threshold = Math.min(halfDuration, MAX_SCROBBLE_THRESHOLD_MS);
  return Math.max(MIN_SCROBBLE_TIME_MS, threshold);
}
