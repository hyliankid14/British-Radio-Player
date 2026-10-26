/**
 * The policy behind background subscription refreshes, with no platform or storage
 * dependencies so it can be reasoned about — and tested — on its own.
 *
 * These rules used to be spread across `backgroundSync.ts`, `notifications.ts` and
 * `autoSync.ts`, where each had a common defect: they asked "does this subscription want a
 * *notification*?" when the real question was "does this subscription want *refreshing*?".
 * Refreshing is what persists an episode list, and every subscription wants that — only the
 * alert is opt-in.
 */

/**
 * How often the native worker should run, in minutes, or `0` when it should be cancelled.
 *
 * The worker is told about every subscription, so it is scheduled whenever there is at least one
 * and the user has not chosen manual-only ("Never" in the Check frequency list). It used to be
 * gated on *at least one subscription having its bell armed*, which — since
 * `isPodcastNotificationsEnabled` defaults to false — cancelled the worker outright on a default
 * install, so nothing at all was fetched in the background.
 */
export function backgroundRefreshInterval(
  subscribedCount: number,
  refreshIntervalMinutes: number
): number {
  if (subscribedCount <= 0) return 0;
  return refreshIntervalMinutes > 0 ? Math.floor(refreshIntervalMinutes) : 0;
}

/** Which subscriptions to refresh, and among those which may post a notification. */
export interface SubscriptionSyncPlan {
  /** Every subscription. These feeds are read and their episode lists persisted. */
  refreshIds: string[];
  /** The subset the user has armed, and the only ones that may alert. */
  notifyIds: string[];
}

/**
 * Splits subscriptions into "refresh" and "refresh and notify".
 *
 * [isArmed] is read per id, so the caller keeps the storage lookup to itself.
 *
 * `refreshIds` is ordered **armed first**, then the rest in subscription order. Both consumers
 * walk the list under a time budget, so without this a listener with fifty subscriptions and two
 * armed shows could have those two perpetually cut off by the forty-eight they do not want
 * alerts for — a regression against the old behaviour, which fetched only the armed ones.
 */
export function planSubscriptionSync(
  subscribedIds: string[],
  isArmed: (podcastId: string) => boolean
): SubscriptionSyncPlan {
  const armedIds: string[] = [];
  const unarmedIds: string[] = [];
  const notifyIds: string[] = [];
  const seen = new Set<string>();
  for (const id of subscribedIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (isArmed(id)) {
      notifyIds.push(id);
      armedIds.push(id);
    } else {
      unarmedIds.push(id);
    }
  }
  return { refreshIds: [...armedIds, ...unarmedIds], notifyIds };
}

/**
 * True when a subscription's cached episode list is old enough to be re-fetched.
 *
 * The in-car prefetch used to re-read only shows with an *empty* cache, so a subscription that
 * had been opened once kept its original list for the life of the process — the car served
 * yesterday's episodes even though the user's own refresh interval had long passed.
 *
 * A list with no recorded fetch time is treated as stale: it arrived from somewhere that was not
 * this app's snapshot store (an older build, or the native worker before it stamped a time).
 *
 * [refreshIntervalMinutes] of 0 means manual-only, and nothing is stale.
 */
export function isEpisodeListStale(
  fetchedAtMs: number,
  refreshIntervalMinutes: number,
  nowMs: number
): boolean {
  if (refreshIntervalMinutes <= 0) return false;
  if (fetchedAtMs <= 0) return true;
  return nowMs - fetchedAtMs > refreshIntervalMinutes * 60_000;
}
