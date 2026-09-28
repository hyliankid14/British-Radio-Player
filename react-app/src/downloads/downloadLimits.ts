/**
 * Pure, dependency-free helpers behind the download housekeeping settings:
 * "Delete when completed" and the global "Maximum downloaded episodes" cap.
 *
 * Kept free of React Native/native imports so the selection logic can be unit
 * tested under the plain Node test runner.
 */

/** Preference key holding the maximum number of episodes kept on the device. */
export const MAX_DOWNLOADS_PREF_KEY = "pref_max_downloads";

/** Preference key holding the "Delete when completed" switch. */
export const DELETE_PLAYED_PREF_KEY = "pref_delete_played";

/** Sentinel value meaning "keep every download". */
export const UNLIMITED_DOWNLOADS = 0;

/** Values offered in Settings → Subscriptions. */
export const MAX_DOWNLOADS_OPTIONS: number[] = [UNLIMITED_DOWNLOADS, 5, 10, 20, 50, 100];

/** Coerces a stored preference value into a usable cap; anything invalid means unlimited. */
export function normaliseMaxDownloads(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return UNLIMITED_DOWNLOADS;
  return Math.floor(parsed);
}

export interface DownloadedRecordLike {
  downloadedAtMs?: number;
}

/**
 * Returns the episode ids to delete so that at most `max` downloads remain.
 *
 * The oldest downloads are dropped first, which keeps the episodes a user is
 * most likely still to want. Records without a recorded download time count as
 * the oldest. Returns an empty array when the cap is unlimited or already met.
 */
export function pickDownloadsToRemove(
  records: Record<string, DownloadedRecordLike | undefined>,
  max: unknown
): string[] {
  const limit = normaliseMaxDownloads(max);
  if (limit === UNLIMITED_DOWNLOADS) return [];

  const ids = Object.keys(records).filter((id) => !!records[id]);
  if (ids.length <= limit) return [];

  return ids
    .sort((a, b) => {
      const aAt = records[a]?.downloadedAtMs ?? 0;
      const bAt = records[b]?.downloadedAtMs ?? 0;
      if (aAt !== bAt) return aAt - bAt;
      return a.localeCompare(b);
    })
    .slice(0, ids.length - limit);
}
