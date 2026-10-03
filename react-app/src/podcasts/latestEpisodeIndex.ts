import { Podcast, PodcastApi } from "../api/podcasts.ts";
import { Preferences } from "../storage/preferences.ts";
import { getNetworkStatus } from "../store/networkStore.ts";

/**
 * Builds the PID -> newest-episode-date index behind the "Last Updated" catalogue tab.
 *
 * The BBC publishes no endpoint carrying a last-updated date for the whole catalogue, and
 * its OPML is ordered by service rather than by recency, so each podcast's own feed is the
 * only source. Feeds are large and the CDN serves no range requests, so this resolves a
 * bounded slice per pass rather than all ~840 at once: it runs in the background on Wi-Fi,
 * reports every batch so the list re-sorts as results land, and persists what it learns, so
 * the index converges over a few sessions and costs nothing afterwards.
 *
 * Podcasts with no resolved date yet sort last rather than in arbitrary catalogue order, so
 * the tab is never wrong — only incomplete.
 *
 * Persisted dates are only ever raised (see `mergeLatestEpisodeDates`): a podcast's newest
 * episode cannot move backwards, so a stale or failed read can never demote one that is
 * already known to be fresher.
 */

const FEED_CONCURRENCY = 6;
const WRITE_BATCH_SIZE = 20;
const MAX_PER_PASS = 250;

let crawlInFlight: Promise<void> | null = null;
let latestMapCache: Record<string, number> | null = null;

/** The persisted newest-episode dates, read once and kept in step with writes. */
function stored(): Record<string, number> {
  if (!latestMapCache) latestMapCache = Preferences.getPodcastLatestEpisodeMap();
  return latestMapCache;
}

/** Newest known episode date for a podcast, or `0` when nothing is known yet. */
export function getLatestEpisodeMs(podcastId: string): number {
  return stored()[podcastId] ?? 0;
}

/** Runs `worker` over `items` with a fixed number of in-flight requests. */
async function inBatches<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        await worker(items[cursor++]);
      }
    })
  );
}

/**
 * Resolves the newest episode date for every catalogue podcast that is not known yet,
 * calling `onProgress` after each batch so the caller can re-sort.
 *
 * Resolved dates are permanent, so this costs one pass over the catalogue ever; later
 * visits only pick up shows new to the OPML. Concurrent calls share the in-flight pass.
 */
export function ensureLatestEpisodeIndex(
  catalog: Podcast[],
  onProgress: () => void
): Promise<void> {
  if (crawlInFlight) return crawlInFlight;

  const network = getNetworkStatus();
  if (!network.isOnline) return Promise.resolve();
  // Catalogue feeds are large — most are a few hundred kB and the biggest over 6 MB — and
  // the CDN serves no range requests, so a full pass is a heavy download. Requires Wi-Fi
  // rather than borrowing the "Download on Wi-Fi only" preference, which the user reads as
  // being about episode downloads. `pref_exclude_non_english`'s language crawl is not
  // comparable: it spends a ~1 kB programme JSON per podcast, not a whole feed.
  if (!network.isWifi) return Promise.resolve();

  const known = stored();
  const unresolved = catalog.filter((p) => (known[p.id] ?? 0) === 0);
  if (unresolved.length === 0) return Promise.resolve();
  // A pass covers a slice of the catalogue; the remainder carries to the next pass, so the
  // tab fills in over a few sessions instead of one multi-hundred-megabyte download.
  const batch = unresolved.slice(0, MAX_PER_PASS);

  crawlInFlight = (async () => {
    const pending: Record<string, number> = {};

    const flush = (force: boolean) => {
      const count = Object.keys(pending).length;
      if (count === 0 || (!force && count < WRITE_BATCH_SIZE)) return;
      Preferences._mergePodcastLatestEpisodes(pending);
      Object.assign(known, pending);
      for (const id of Object.keys(pending)) delete pending[id];
      onProgress();
    };

    await inBatches(batch, FEED_CONCURRENCY, async (podcast) => {
      try {
        // Deliberately not fetchEpisodes: that fills the 60-entry episode cache with all
        // ~840 crawls and evicts the popular episodes prefetched for instant navigation.
        // Reading the date alone also skips parsing items the index never looks at.
        const latest = await PodcastApi.fetchLatestEpisodeMs(podcast.rssUrl, podcast.id);
        if (latest > 0) pending[podcast.id] = latest;
      } catch {
        // A feed that will not parse stays unresolved rather than being recorded as stale.
      }
      flush(false);
    });

    flush(true);
  })()
    .catch((err) => {
      console.warn("Podcast latest-episode index failed:", err);
    })
    .finally(() => {
      crawlInFlight = null;
    });

  return crawlInFlight;
}