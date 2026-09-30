export interface QueuedScrobble {
  artist: string;
  track: string;
  album?: string;
  durationSec?: number;
  timestampSec: number;
}

/**
 * Last.fm collapses repeat scrobbles of the same artist/track within a couple of
 * minutes, so anything closer than this is a replay rather than a new listen.
 */
export const SCROBBLE_DEDUP_WINDOW_MS = 60_000;

/** Bounds the queue so a long offline stretch cannot grow it without limit. */
export const SCROBBLE_QUEUE_LIMIT = 50;

/** Case- and padding-insensitive identity, so a replay is recognised even if the
 * metadata arrived with different casing or padding. */
export function scrobbleKey(item: QueuedScrobble): string {
  return `${item.artist.trim().toLowerCase()}\u0000${item.track.trim().toLowerCase()}`;
}

/**
 * Prepends an entry unless the queue already holds the same artist/track within the
 * dedup window, which is what a retry or a double threshold crossing looks like.
 */
export function enqueueScrobble(
  queue: QueuedScrobble[],
  entry: QueuedScrobble
): QueuedScrobble[] {
  const key = scrobbleKey(entry);
  const isDup = queue.some(
    (item) =>
      scrobbleKey(item) === key &&
      Math.abs(item.timestampSec - entry.timestampSec) * 1000 < SCROBBLE_DEDUP_WINDOW_MS
  );
  if (isDup) return queue;

  return [entry, ...queue].slice(0, SCROBBLE_QUEUE_LIMIT);
}

/** Drops anything Last.fm would reject as too old to be a genuine listen. */
export function isStaleScrobble(entry: QueuedScrobble, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - entry.timestampSec * 1000 > maxAgeMs;
}

/** Discards entries that are not shaped like a scrobble, so one bad write cannot
 * wedge the whole queue. */
export function sanitizeScrobbleQueue(raw: unknown): QueuedScrobble[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is QueuedScrobble =>
      !!item &&
      typeof item === "object" &&
      typeof (item as QueuedScrobble).artist === "string" &&
      typeof (item as QueuedScrobble).track === "string" &&
      typeof (item as QueuedScrobble).timestampSec === "number" &&
      Number.isFinite((item as QueuedScrobble).timestampSec)
  );
}
