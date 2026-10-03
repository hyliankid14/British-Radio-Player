/**
 * Single source of truth for reading and ordering episode `pubDate` values.
 *
 * BBC feeds publish RFC 2822 `pubDate`, which `Date.parse` handles, but a handful of
 * shows omit the day or carry a bare `YYYY-MM-DD`. Anything unparseable collapses to `0`
 * so a missing date can never masquerade as a recent one.
 */

/** Epoch milliseconds for an episode `pubDate`, or `0` when absent or unparseable. */
export function parseEpisodeDateEpoch(pubDate?: string): number {
  if (!pubDate) return 0;
  const parsed = Date.parse(pubDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** The newest `pubDate` across a set of episodes. `0` when none carries a usable date. */
export function latestEpisodeEpoch(pubDates: Iterable<string | undefined>): number {
  let max = 0;
  for (const pubDate of pubDates) {
    const epoch = parseEpisodeDateEpoch(pubDate);
    if (epoch > max) max = epoch;
  }
  return max;
}

/**
 * Folds freshly resolved newest-episode dates into the stored map, in place.
 *
 * A stored date is only ever raised. A podcast's newest episode cannot move backwards, so
 * a stale read, a republished feed or a failed crawl must never demote a podcast that is
 * already known to be fresher. Entries that are not usable positive timestamps are ignored.
 */
export function mergeLatestEpisodeDates(
  current: Record<string, number>,
  entries: Record<string, number>
): Record<string, number> {
  for (const [id, value] of Object.entries(entries)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    if ((current[id] ?? 0) >= value) continue;
    current[id] = value;
  }
  return current;
}

/**
 * Orders entries newest first. Entries without a usable date sort **last**, so an
 * undated episode can never lead a "latest" list — `0` is the smallest value and a bare
 * descending compare would put it first.
 */
export function byNewestFirst<T>(getDate: (entry: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const aEpoch = getDate(a);
    const bEpoch = getDate(b);
    if (!aEpoch && !bEpoch) return 0;
    if (!aEpoch) return 1;
    if (!bEpoch) return -1;
    return bEpoch - aEpoch;
  };
}

/** Reads `pubDate` off an episode-shaped entry. */
function entryEpoch<T extends { pubDate?: string }>(entry: T): number {
  return parseEpisodeDateEpoch(entry.pubDate);
}

/** The `byNewestFirst` comparator reading `pubDate` off entries that carry one. */
export function byEpisodePubDate<T extends { pubDate?: string }>(a: T, b: T): number {
  return byNewestFirst(entryEpoch)(a, b);
}

/**
 * The `byNewestFirst` comparator with the direction flipped, for oldest-first lists.
 *
 * Written out rather than as `byEpisodePubDate(b, a)`: reversing the arguments also
 * reverses the undated handling, which would push undated entries to the *top* of an
 * oldest-first list instead of leaving them last.
 */
export function byEpisodePubDateOldest<T extends { pubDate?: string }>(a: T, b: T): number {
  const aEpoch = entryEpoch(a);
  const bEpoch = entryEpoch(b);
  if (!aEpoch && !bEpoch) return 0;
  if (!aEpoch) return 1;
  if (!bEpoch) return -1;
  return aEpoch - bEpoch;
}