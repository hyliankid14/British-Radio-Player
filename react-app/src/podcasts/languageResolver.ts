import type { Podcast } from "../api/podcasts";
import { Preferences } from "../storage/preferences";
import { getNetworkStatus } from "../store/networkStore";
import { isForeignLanguageService, readFeedLanguage, readProgrammeService } from "./languageRules";

const SERVICE_CONCURRENCY = 8;
const LANGUAGE_CONCURRENCY = 4;
const FEED_BATCH_SIZE = 20;
const FETCH_TIMEOUT_MS = 15000;

// In-memory mirrors of the persisted maps. Filtering walks the whole catalogue on
// every render, so the maps are read once and kept in step with the writes.
let serviceMap: Record<string, string> | null = null;
let languageMap: Record<string, string> | null = null;

function services(): Record<string, string> {
  if (!serviceMap) serviceMap = Preferences.getPodcastServiceMap();
  return serviceMap;
}

function languages(): Record<string, string> {
  if (!languageMap) languageMap = Preferences.getPodcastLanguageMap();
  return languageMap;
}

/** Resolved BBC service key for a podcast, or undefined when not yet known. */
export function getServiceKey(podcastId: string): string | undefined {
  return services()[podcastId];
}

/** Resolved feed `<language>` for a podcast, or undefined when not yet known. */
export function getLanguageTag(podcastId: string): string | undefined {
  return languages()[podcastId];
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "British Radio Player/1.0",
        Accept: "application/json, application/rss+xml, application/xml, text/xml, */*"
      },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
 * Records the language of a feed the app has already downloaded, so podcasts the
 * user already plays are indexed without spending a request on them.
 */
export function harvestFeedLanguage(podcastId: string, xml: string): void {
  if (!podcastId) return;
  const known = languages();
  if (known[podcastId]) return;
  const tag = readFeedLanguage(xml);
  if (!tag) return;
  known[podcastId] = tag;
  Preferences._mergePodcastLanguages({ [podcastId]: tag });
}

let crawlInFlight: Promise<void> | null = null;

/**
 * Builds the PID -> language index used by the "Exclude non-English podcasts" filter.
 *
 * Runs only while that preference is on, works strictly on podcasts it has not seen
 * before, and reports each batch that lands so the caller can re-filter. Resolved
 * values are permanent — a podcast's service and language do not change — so a full
 * catalogue costs one pass ever, and later catalogue refreshes only cover new arrivals.
 */
export function ensureLanguageIndex(catalog: Podcast[], onProgress: () => void): Promise<void> {
  if (crawlInFlight) return crawlInFlight;
  if (!Preferences.getSetting("pref_exclude_non_english", false)) return Promise.resolve();
  if (!getNetworkStatus().isOnline) return Promise.resolve();

  const knownServices = services();
  const knownLanguages = languages();

  const unresolved = catalog.filter((p) => {
    if (knownLanguages[p.id]) return false;
    const service = knownServices[p.id];
    // An English-language service settles the podcast without a feed fetch.
    if (service && !isForeignLanguageService(service)) return false;
    return true;
  });
  if (unresolved.length === 0) return Promise.resolve();

  crawlInFlight = (async () => {
    const serviceResults: Record<string, string> = {};
    await inBatches(
      unresolved.filter((p) => !knownServices[p.id]),
      SERVICE_CONCURRENCY,
      async (podcast) => {
        const body = await fetchText(`https://www.bbc.co.uk/programmes/${podcast.id}.json`);
        const key = body ? readProgrammeService(body) : null;
        if (key) serviceResults[podcast.id] = key;
      }
    );

    if (Object.keys(serviceResults).length > 0) {
      Object.assign(knownServices, serviceResults);
      Preferences._mergePodcastServices(serviceResults);
      onProgress();
    }

    // Feeds are only needed for foreign-language services, and for PIDs the programme
    // JSON could not place on any service at all.
    const needsFeed = unresolved.filter((p) => {
      const key = knownServices[p.id];
      return !key || isForeignLanguageService(key);
    });
    if (needsFeed.length === 0) return;

    const languageResults: Record<string, string> = {};
    await inBatches(needsFeed, LANGUAGE_CONCURRENCY, async (podcast) => {
      const body = await fetchText(podcast.rssUrl);
      const tag = body ? readFeedLanguage(body) : null;
      if (!tag) return;
      languageResults[podcast.id] = tag;
      if (Object.keys(languageResults).length < FEED_BATCH_SIZE) return;
      Object.assign(knownLanguages, languageResults);
      Preferences._mergePodcastLanguages(languageResults);
      onProgress();
      for (const id of Object.keys(languageResults)) delete languageResults[id];
    });

    if (Object.keys(languageResults).length > 0) {
      Object.assign(knownLanguages, languageResults);
      Preferences._mergePodcastLanguages(languageResults);
      onProgress();
    }
  })()
    .catch((err) => {
      console.warn("Podcast language index failed:", err);
    })
    .finally(() => {
      crawlInFlight = null;
    });

  return crawlInFlight;
}

/** @internal Test seam: drops the in-memory mirrors so they re-read from storage. */
export function resetLanguageIndexCache(): void {
  serviceMap = null;
  languageMap = null;
}
