/**
 * Pure, dependency-free helpers behind the download housekeeping settings:
 * "Delete when completed", the global "Maximum downloaded episodes" cap and the
 * per-podcast "Download limit per podcast" cap.
 *
 * Kept free of React Native/native imports so the selection logic can be unit
 * tested under the plain Node test runner.
 */

/** Preference key holding the maximum number of episodes kept on the device. */
export const MAX_DOWNLOADS_PREF_KEY = "pref_max_downloads";

/** Preference key holding the "Delete when completed" switch. */
export const DELETE_PLAYED_PREF_KEY = "pref_delete_played";

/** Preference key holding the per-podcast automatic download cap. */
export const AUTO_DOWNLOAD_LIMIT_PREF_KEY = "pref_auto_download_limit";

/** Sentinel value meaning "keep every download". */
export const UNLIMITED_DOWNLOADS = 0;

/** Values offered in Settings → Subscriptions. */
export const MAX_DOWNLOADS_OPTIONS: number[] = [UNLIMITED_DOWNLOADS, 5, 10, 20, 50, 100];

/** Values offered for the per-podcast cap. There is no unlimited option. */
export const AUTO_DOWNLOAD_LIMIT_OPTIONS: number[] = [1, 2, 3, 5, 10];

/** Coerces a stored preference value into a usable cap; anything invalid means unlimited. */
export function normaliseMaxDownloads(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return UNLIMITED_DOWNLOADS;
  return Math.floor(parsed);
}

/**
 * Coerces a stored preference value into a usable per-podcast cap. Unlike the
 * global cap this setting has no unlimited mode, so anything invalid falls back
 * to the single-episode default rather than to "no limit".
 */
export function normaliseAutoDownloadLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}
/**
 * Sanitizes file names to remove characters forbidden in Android / FAT / Linux storage.
 * Characters forbidden: / \ ? % * : | " < >
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes an episode ID or GUID to its canonical BBC PID / short ID.
 * Strips URN schemes (urn:bbc:podcast:w3ct998z -> w3ct998z) and URL paths
 * (https://www.bbc.co.uk/programmes/w3ct998z -> w3ct998z).
 */
export function normalizeEpisodeId(rawId: string | undefined | null): string {
  if (!rawId) return "";
  let decoded = rawId.trim();
  try {
    if (decoded.includes("%")) decoded = decodeURIComponent(decoded);
  } catch {}
  const lastDelimiter = Math.max(decoded.lastIndexOf("/"), decoded.lastIndexOf(":"));
  if (lastDelimiter !== -1 && lastDelimiter < decoded.length - 1) {
    const candidate = decoded.slice(lastDelimiter + 1).trim();
    if (/^[a-z0-9_-]+$/i.test(candidate)) return candidate;
  }
  return decoded;
}

/** Builds a safe public displayName for MediaStore / file system. */
export function buildDownloadDisplayName(title: string | undefined, id: string, extension: string): string {
  const safeId = sanitizeFileName(normalizeEpisodeId(id) || id);
  const baseTitle = sanitizeFileName(title || id).slice(0, 100).trim();
  return `${baseTitle || safeId} - ${safeId}${extension}`;
}

export interface DownloadedRecordLike {
  downloadedAtMs?: number;
}

/**
 * Returns the episode ids to delete so that at most `max` downloads remain.
 *
 * The oldest downloads are dropped first, which keeps the episodes a user is
 * most likely still to want. Records without a recorded download time count as
 * the oldest. Ids listed in `protectedIds` (the episode currently streaming) are
 * never returned, and the next-oldest episode is taken instead so the cap is
 * still met. Returns an empty array when the cap is unlimited or already met.
 */
export function pickDownloadsToRemove(
  records: Record<string, DownloadedRecordLike | undefined>,
  max: unknown,
  protectedIds: Iterable<string> = []
): string[] {
  const limit = normaliseMaxDownloads(max);
  if (limit === UNLIMITED_DOWNLOADS) return [];

  const ids = Object.keys(records).filter((id) => !!records[id]);
  if (ids.length <= limit) return [];

  const keep = new Set(protectedIds);
  const excess = ids.length - limit;

  return ids
    .filter((id) => !keep.has(id))
    .sort((a, b) => {
      const aAt = records[a]?.downloadedAtMs ?? 0;
      const bAt = records[b]?.downloadedAtMs ?? 0;
      if (aAt !== bAt) return aAt - bAt;
      return a.localeCompare(b);
    })
    .slice(0, excess);
}

export interface DatedEpisodeLike {
  id: string;
  pubDate?: string;
}

function episodeEpoch(pubDate?: string): number {
  if (!pubDate) return 0;
  const parsed = Date.parse(pubDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** A newest-first copy of the episodes; entries without a usable date sort last. */
export function sortEpisodesNewestFirst<T extends { pubDate?: string }>(episodes: T[]): T[] {
  return [...episodes].sort((a, b) => episodeEpoch(b.pubDate) - episodeEpoch(a.pubDate));
}

/**
 * Ids of the newest `limit` episodes — the rolling window automatic downloading
 * keeps on the device. The window is taken over every episode rather than only the
 * ones missing from the device, so an episode that is already downloaded still
 * holds its slot and the run cannot reach into the back catalogue to replace it.
 */
export function newestEpisodeIds(episodes: DatedEpisodeLike[], limit: unknown): string[] {
  const max = normaliseAutoDownloadLimit(limit);
  return sortEpisodesNewestFirst(episodes)
    .slice(0, max)
    .map((episode) => episode.id);
}

export interface PerPodcastRecordLike extends DownloadedRecordLike {
  /**
   * Whether the app fetched this file on the user's behalf. Absent on records
   * written before the per-podcast cap existed, which are all treated as
   * automatic so a library that already overflows can be trimmed.
   */
  isAutoDownloaded?: boolean;
  entry?: { podcastId?: string };
}

/** Only automatic downloads are governed by the per-podcast cap. */
export function isAutomaticDownload(record: PerPodcastRecordLike | undefined): boolean {
  return !!record && record.isAutoDownloaded !== false;
}

/**
 * Returns the ids of the oldest automatic downloads to delete so that no podcast
 * holds more than `max` automatic downloads. Manual downloads are never touched,
 * and records with no podcast attribution are left alone because there is no way
 * to tell which cap they belong to.
 */
export function pickPerPodcastDownloadsToRemove(
  records: Record<string, PerPodcastRecordLike | undefined>,
  max: unknown,
  protectedIds: Iterable<string> = []
): string[] {
  const limit = normaliseAutoDownloadLimit(max);
  const keep = new Set(protectedIds);
  const byPodcast = new Map<string, string[]>();

  for (const [id, record] of Object.entries(records)) {
    if (!isAutomaticDownload(record)) continue;
    const podcastId = record?.entry?.podcastId;
    if (!podcastId) continue;
    const group = byPodcast.get(podcastId);
    if (group) group.push(id);
    else byPodcast.set(podcastId, [id]);
  }

  const victims: string[] = [];
  for (const group of byPodcast.values()) {
    if (group.length <= limit) continue;
    const removable = group.filter((id) => !keep.has(id));
    if (removable.length === 0) continue;
    const excess = group.length - limit;
    removable
      .sort((a, b) => {
        const aAt = records[a]?.downloadedAtMs ?? 0;
        const bAt = records[b]?.downloadedAtMs ?? 0;
        if (aAt !== bAt) return aAt - bAt;
        return a.localeCompare(b);
      })
      .slice(0, excess)
      .forEach((id) => victims.push(id));
  }
  return victims;
}

/**
 * Ids of the automatic downloads belonging to `podcastId` that are no longer in
 * the current window — the files the rolling window has superseded. Manually
 * requested downloads and ids listed in `protectedIds` (the episode streaming
 * now) are never returned.
 */
export function pickStaleAutomaticDownloads(
  records: Record<string, PerPodcastRecordLike | undefined>,
  podcastId: string,
  windowIds: Iterable<string>,
  protectedIds: Iterable<string> = []
): string[] {
  const normWindow = new Set(Array.from(windowIds).map((id) => normalizeEpisodeId(id) || id));
  const keep = new Set(Array.from(protectedIds).map((id) => normalizeEpisodeId(id) || id));
  const stale: string[] = [];

  for (const [id, record] of Object.entries(records)) {
    if (!isAutomaticDownload(record)) continue;
    if (record?.entry?.podcastId !== podcastId) continue;
    const normId = normalizeEpisodeId(id) || id;
    if (normWindow.has(normId) || keep.has(normId) || normWindow.has(id) || keep.has(id)) continue;
    stale.push(id);
  }
  return stale;
}
