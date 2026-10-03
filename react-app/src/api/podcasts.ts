import { Preferences } from "../storage/preferences";
import { normalizeBbcAudioUrl } from "../utils/shareLinks";
import { harvestFeedLanguage } from "../podcasts/languageResolver";
import { byEpisodePubDate, parseEpisodeDateEpoch } from "../podcasts/episodeDates.ts";
import { normalizeEpisodeId } from "../downloads/downloadLimits";
import { calculateUpdatedRating, formatRatingValue } from "../podcasts/ratingUtils";
import { isAdvancedBooleanQuery, booleanSearchCandidateQueries } from "../utils/searchUtils";
import { BoundedCache } from "../utils/boundedCache.ts";

export { calculateUpdatedRating, formatRatingValue };

export const PI_BASE_URL = "https://bbc-radio.shai.website";
export const BBC_OPML_URL = "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml";

export interface Podcast {
  id: string;
  title: string;
  description: string;
  rssUrl: string;
  htmlUrl: string;
  imageUrl: string;
  genres: string[];
  typicalDurationMins: number;
}

export interface Episode {
  id: string;
  title: string;
  description: string;
  audioUrl: string;
  imageUrl: string;
  pubDate: string;
  durationMins: number;
  podcastId: string;
}

export interface PopularEntry {
  id: string;
  name: string;
  plays: number;
}

export interface NewPodcastEntry {
  id: string;
  title: string;
  first_seen_epoch_ms?: number;
  oldest_pub_epoch_ms?: number;
}

export interface PodcastRatingSummary {
  average: number;
  count: number;
  mine?: number;
}

export interface SearchPodcastResult {
  podcastId: string;
  title: string;
  description: string;
}

export interface SearchEpisodeResult {
  episodeId: string;
  podcastId: string;
  title: string;
  description: string;
  pubDate: string;
}

// In-memory catalog cache for the active session
let cachedCatalog: Podcast[] = [];
let catalogFetchPromise: Promise<Podcast[]> | null = null;

// In-memory episodes cache keyed by podcastId. Bounded: without a cap it grew for the whole
// session, holding every parsed episode (descriptions included) for every feed ever opened.
const MAX_CACHED_EPISODE_LISTS = 60;
const episodesCache = new BoundedCache<string, Episode[]>(MAX_CACHED_EPISODE_LISTS);
const episodeFetchPromises = new Map<string, Promise<Episode[]>>();

/**
 * Cache of decoded strings.
 *
 * `decodeXmlEntities` runs up to nine regex passes, and list screens call it for every
 * visible row on every render — often several times per row for the title, podcast title and
 * description. The same podcast and episode strings are decoded repeatedly, so memoising by
 * input string removes almost all of that work.
 */
const DECODED_CACHE_MAX = 500;
const decodedCache = new BoundedCache<string, string>(DECODED_CACHE_MAX);

// XML Tag Parser helper for OPML & RSS
export function decodeXmlEntities(str?: string): string {
  if (!str) return "";
  const cached = decodedCache.get(str);
  if (cached !== undefined) return cached;

  let res = str
    .replace(/<[^>]*>/g, "") // Strip HTML tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
  // Handle double-encoded entities (e.g. &amp;amp;)
  if (res.includes("&amp;")) {
    res = res.replace(/&amp;/g, "&");
  }
  decodedCache.set(str, res);
  return res;
}

function parseDurationSeconds(durationStr: string): number {
  if (!durationStr) return 0;
  if (durationStr.includes(":")) {
    const parts = durationStr.split(":").map((p) => parseInt(p, 10) || 0);
    if (parts.length === 3) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 2) {
      return parts[0];
    }
  }
  const secs = parseInt(durationStr, 10);
  return isNaN(secs) ? 0 : Math.round(secs / 60);
}

// Search requests can be slow on the first call after the backend index cache
// expires. Bound each attempt and retry once so a transient timeout does not
// surface to the user as "no results".
const SEARCH_REQUEST_TIMEOUT_MS = 15000;
const SEARCH_REQUEST_ATTEMPTS = 2;

// How many rows to pull for each extra alternative of a boolean query. The
// index ranks individual tokens, so a phrase's exact matches can sit well below
// the first page of the phrase itself; a wider page per alternative recovers
// them. Merged results are deduplicated, so overlap is cheap.
const BOOLEAN_CANDIDATE_LIMIT = 100;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Fetch JSON with a bounded timeout, one retry, and optional caller
 * cancellation. Returns the decoded payload as-is; shape handling is the
 * caller's job.
 */
async function fetchJsonWithRetry(url: string, signal?: AbortSignal): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SEARCH_REQUEST_ATTEMPTS; attempt++) {
    if (signal?.aborted) return null;
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener("abort", onCallerAbort);
    const timeout = setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      // Caller-driven cancellation is terminal: never retry it, and never let it
      // reach the retry backoff.
      if (signal?.aborted || isAbortError(err)) return null;
      lastError = controller.signal.aborted ? new Error("Request timed out") : err;
      if (attempt < SEARCH_REQUEST_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onCallerAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

async function fetchJsonArrayWithRetry(url: string, signal?: AbortSignal): Promise<unknown[]> {
  const data = await fetchJsonWithRetry(url, signal);
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch one page of episode search results plus, optionally, the total number
 * of matches.
 *
 * `includeTotal` asks the backend to keep counting past the requested page and
 * report the figure, so the caller can show "Episodes (1,204)" as soon as the
 * first page lands instead of after paging the whole result set. The flag is
 * opt-in because it costs a full index scan server-side, so only the first page
 * of a query should use it.
 *
 * `total` is null when the backend does not support the flag (an older
 * deployment ignores it and answers with a bare array) or the count was not
 * requested.
 */
async function searchEpisodePage(
  query: string,
  limit: number,
  offset: number,
  signal: AbortSignal | undefined,
  includeTotal: boolean
): Promise<{ results: SearchEpisodeResult[]; total: number | null }> {
  const empty = { results: [] as SearchEpisodeResult[], total: null };
  if (!query.trim()) return empty;
  try {
    const backendQuery = query.trim().replace(/[“”"]/g, "");
    const request = async (value: string, resultLimit: number, withTotal: boolean) => {
      const totalParam = withTotal ? "&include_total=1" : "";
      const url =
        `${PI_BASE_URL}/search/episodes?q=${encodeURIComponent(value)}` +
        `&limit=${resultLimit}&offset=${offset}${totalParam}`;
      const payload = await fetchJsonWithRetry(url, signal);
      // The endpoint answers with a bare array by default and with
      // { results, total } when include_total is honoured. Older deployments
      // ignore the flag and always send the array.
      if (payload && !Array.isArray(payload) && Array.isArray((payload as { results?: unknown }).results)) {
        const body = payload as { results: SearchEpisodeResult[]; total?: unknown };
        return {
          results: body.results,
          total: typeof body.total === "number" ? body.total : null
        };
      }
      return {
        results: Array.isArray(payload) ? (payload as SearchEpisodeResult[]) : [],
        total: null
      };
    };

    const main = await request(backendQuery, limit, includeTotal);
    if (!isAdvancedBooleanQuery(query)) return main;

    // The index tokenises the query and ANDs the tokens, so it cannot honour
    // quotes, OR, grouping or exclusion — it always answers with a superset.
    // Union the pages for the positive alternatives so nothing is missed, then
    // let episodeMatchesQuery apply the semantics that were actually typed.
    const alternatives = booleanSearchCandidateQueries(query).filter(
      (candidate) => candidate !== backendQuery
    );
    if (alternatives.length === 0) return main;

    const broadened = await Promise.all(
      alternatives.map((candidate) =>
        request(candidate, Math.max(limit, BOOLEAN_CANDIDATE_LIMIT), false).then(
          (r) => r.results
        )
      )
    );
    const merged = [...main.results, ...broadened.flat()];
    return {
      results: Array.from(new Map(merged.map((episode) => [episode.episodeId, episode])).values()),
      // Only the main query's total is meaningful for a boolean search: the
      // alternative pages are extra candidates, not extra answers.
      total: main.total
    };
  } catch (err) {
    console.warn("Failed to search episodes on Raspberry Pi:", err);
    return empty;
  }
}

export const PodcastApi = {
  getRatingsBaseUrl(): string {
    return PI_BASE_URL;
  },

  async fetchRatings(podcastIds: string[]): Promise<Record<string, PodcastRatingSummary>> {
    if (!podcastIds || podcastIds.length === 0) return Preferences.getCachedPodcastRatings();
    const installId = Preferences.getAnonymousInstallId();
    const installParam = installId ? `&install_id=${encodeURIComponent(installId)}` : "";
    const cleanIds = Array.from(new Set(podcastIds.map((id) => id.trim()).filter(Boolean)));
    const chunkSize = 100;
    const fetchedResults: Record<string, PodcastRatingSummary> = {};

    for (let i = 0; i < cleanIds.length; i += chunkSize) {
      const chunk = cleanIds.slice(i, i + chunkSize);
      const idsParam = chunk.map((id) => encodeURIComponent(id)).join(",");
      const url = `${PI_BASE_URL}/ratings?podcast_ids=${idsParam}${installParam}`;

      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) continue;
        const payload = await res.json();
        const ratingsObj = payload?.ratings;
        if (ratingsObj && typeof ratingsObj === "object") {
          for (const [id, r] of Object.entries(ratingsObj)) {
            const rData = r as any;
            const avg = Number(rData?.average_rating) || 0;
            const count = Number(rData?.rating_count) || 0;
            const mine = rData?.my_rating != null ? Number(rData.my_rating) : undefined;
            if (count > 0 && avg > 0) {
              fetchedResults[id] = { average: avg, count, mine };
            }
          }
        }
      } catch (err) {
        console.warn("fetchRatings chunk failed:", err);
      }
    }

    const cached = Preferences.getCachedPodcastRatings();
    const merged = { ...cached, ...fetchedResults };
    Preferences.setCachedPodcastRatings(merged);
    return merged;
  },

  async fetchRating(podcastId: string): Promise<PodcastRatingSummary | null> {
    if (!podcastId) return null;
    const ratings = await this.fetchRatings([podcastId]);
    return ratings[podcastId] || null;
  },

  async submitRating(podcastId: string, rating: number, podcastTitle?: string): Promise<boolean> {
    if (!podcastId || rating < 1 || rating > 5) return false;
    const installId = Preferences.getAnonymousInstallId();

    // Immediately update cache optimistically so listeners reflect the new rating
    const current = Preferences.getCachedPodcastRatings()[podcastId];
    const optimistic = calculateUpdatedRating(current, rating);
    Preferences.updateCachedPodcastRating(podcastId, optimistic);

    try {
      const res = await fetch(`${PI_BASE_URL}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podcast_id: podcastId,
          rating,
          install_id: installId,
          podcast_title: podcastTitle || "",
          platform: "ios"
        })
      });
      if (res.ok) {
        return true;
      }
    } catch (err) {
      console.warn("submitRating failed:", err);
    }
    return false;
  },
  /**
   * Search podcasts on Raspberry Pi database via /search/podcasts
   */
  async searchPodcastsOnPi(
    query: string,
    limit: number = 100,
    signal?: AbortSignal
  ): Promise<SearchPodcastResult[]> {
    if (!query.trim()) return [];
    try {
      // The index endpoint tokenises terms and ANDs them, so it understands
      // neither phrase delimiters nor OR; boolean matching is enforced by the
      // client-side evaluator. For a boolean query the positive alternatives are
      // fetched separately and unioned, so the evaluator has the superset it
      // needs to narrow back down to what was typed.
      const backendQuery = query.trim().replace(/[“”"]/g, "");
      const candidates = isAdvancedBooleanQuery(query)
        ? Array.from(new Set([backendQuery, ...booleanSearchCandidateQueries(query)])).filter(
            Boolean
          )
        : [backendQuery];
      const pages = await Promise.all(
        candidates.map((value) =>
          fetchJsonArrayWithRetry(
            `${PI_BASE_URL}/search/podcasts?q=${encodeURIComponent(value)}&limit=${limit}`,
            signal
          ).then((payload) => payload as SearchPodcastResult[])
        )
      );
      const merged = pages.flat();
      return Array.from(new Map(merged.map((podcast) => [podcast.podcastId, podcast])).values());
    } catch (err) {
      console.warn("Failed to search podcasts on Raspberry Pi:", err);
      return [];
    }
  },

  /**
   * Fetch one page of episode search results plus, optionally, the total
   * number of matches. See searchEpisodePage.
   */
  async searchEpisodesPageOnPi(
    query: string,
    limit: number = 50,
    offset: number = 0,
    signal?: AbortSignal,
    includeTotal: boolean = false
  ): Promise<{ results: SearchEpisodeResult[]; total: number | null }> {
    return searchEpisodePage(query, limit, offset, signal, includeTotal);
  },

  /**
   * Search episodes on Raspberry Pi database via /search/episodes.
   * Paged: callers fetch a bounded page at a time and append, rather than
   * pulling every match for a broad query in one go.
   */
  async searchEpisodesOnPi(
    query: string,
    limit: number = 50,
    offset: number = 0,
    signal?: AbortSignal
  ): Promise<SearchEpisodeResult[]> {
    return (await searchEpisodePage(query, limit, offset, signal, false)).results;
  },

  /**
   * Fetch search suggestions on Raspberry Pi via /search/suggestions
   */
  async searchSuggestionsOnPi(query: string, limit: number = 10): Promise<{ podcastId: string; title: string }[]> {
    if (!query.trim() || query.trim().length < 2) return [];
    try {
      const url = `${PI_BASE_URL}/search/suggestions?q=${encodeURIComponent(query.trim())}&limit=${limit}`;
      return (await fetchJsonArrayWithRetry(url)) as { podcastId: string; title: string }[];
    } catch (err) {
      console.warn("Failed to get suggestions from Raspberry Pi:", err);
      return [];
    }
  },

  /**
   * Fetch popular podcasts snapshot from Raspberry Pi via /data/popular-podcasts.json.
   * Returns fresh MMKV cache immediately when < 6 hours old (mirrors Kotlin disk cache).
   * On success writes through to cache; on failure returns stale cache so the list
   * is never empty after the first successful fetch.
   */
  async getPopularPodcastsFromPi(): Promise<PopularEntry[]> {
    // 1. Return fresh cache immediately — avoids a network round-trip on every launch
    const cached = Preferences.getCachedPopularPodcasts();
    if (cached) return cached;

    // 2. Fetch live from Pi
    try {
      const res = await fetch(`${PI_BASE_URL}/data/popular-podcasts.json`, {
        headers: { Accept: "application/json" }
      });
      if (res.ok) {
        const json = await res.json();
        const entries: PopularEntry[] = json.popular_podcasts || [];
        if (entries.length > 0) {
          Preferences.setCachedPopularPodcasts(entries);
          return entries;
        }
      }
    } catch (err) {
      console.warn("Failed to get popular podcasts from Raspberry Pi:", err);
    }

    // 3. Fallback: return stale cache (Pi unreachable / Tailscale off)
    return Preferences._readPopularPodcastsRaw() ?? [];
  },

  /**
   * Fetch new podcasts snapshot from Raspberry Pi via /data/new-podcasts.json.
   * Returns fresh MMKV cache immediately when < 6 hours old (mirrors Kotlin disk cache).
   * On success writes through to cache; on failure returns stale cache so the list
   * is never empty after the first successful fetch.
   */
  async getNewPodcastsFromPi(): Promise<NewPodcastEntry[]> {
    // 1. Return fresh cache immediately
    const cached = Preferences.getCachedNewPodcasts();
    if (cached) return cached;

    // 2. Fetch live from Pi
    try {
      const res = await fetch(`${PI_BASE_URL}/data/new-podcasts.json`, {
        headers: { Accept: "application/json" }
      });
      if (res.ok) {
        const json = await res.json();
        const entries: NewPodcastEntry[] = (json.new_podcasts || []).slice(0, 50);
        if (entries.length > 0) {
          Preferences.setCachedNewPodcasts(entries);
          return entries;
        }
      }
    } catch (err) {
      console.warn("Failed to get new podcasts from Raspberry Pi:", err);
    }

    // 3. Fallback: return stale cache
    return Preferences._readNewPodcastsRaw() ?? [];
  },

  /**
   * Fetch live BBC OPML catalog to obtain full podcast metadata (artwork, bbcgenres, descriptions, rssUrls)
   */
  async fetchLiveCatalog(forceRefresh: boolean = false): Promise<Podcast[]> {
    if (!forceRefresh && cachedCatalog.length > 0) {
      return cachedCatalog;
    }
    if (catalogFetchPromise) {
      return catalogFetchPromise;
    }

    catalogFetchPromise = (async () => {
      try {
        const res = await fetch(BBC_OPML_URL, {
          headers: {
            "User-Agent": "British Radio Player/1.0",
            Accept: "application/xml,text/xml,application/rss+xml,*/*"
          }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xmlText = await res.text();

        // Regex parse outlines matching Kotlin OPMLParser
        const outlines: Podcast[] = [];
        const seenIds = new Set<string>();
        const seenTitles = new Set<string>();

        // Match each <outline ... />
        const outlineRegex = /<outline\s+([^>]+?)\/?>/gi;
        let match: RegExpExecArray | null;

        while ((match = outlineRegex.exec(xmlText)) !== null) {
          const attrsString = match[1];

          const getAttr = (name: string): string => {
            const attrRegex = new RegExp(`${name}="([^"]*)"`, "i");
            const m = attrRegex.exec(attrsString);
            return m ? m[1] : "";
          };

          const xmlUrl = getAttr("xmlUrl");
          const type = getAttr("type").toLowerCase();
          if (!xmlUrl || (type && type !== "rss")) continue;

          // ID extraction: keyname or /([a-z0-9]+)\.rss
          let podcastId = getAttr("keyname");
          if (!podcastId) {
            const idMatch = /\/([a-z0-9]+)\.rss$/i.exec(xmlUrl);
            podcastId = idMatch ? idMatch[1] : "";
          }
          if (!podcastId) continue;

          const title = decodeXmlEntities(getAttr("text"));
          const normTitle = title.toLowerCase();

          if (seenIds.has(podcastId) || seenTitles.has(normTitle)) continue;
          seenIds.add(podcastId);
          seenTitles.add(normTitle);

          const desc = decodeXmlEntities(getAttr("description"));
          const htmlUrl = getAttr("htmlUrl").replace("http://", "https://");
          const rssUrl = xmlUrl.replace("http://", "https://");
          const imageUrl = getAttr("imageHref").replace("http://", "https://");
          const durStr = getAttr("typicalDurationMins");
          const duration = parseInt(durStr, 10) || 0;
          const rawGenres = getAttr("bbcgenres");
          const genres = rawGenres
            .split(",")
            .map((g) => decodeXmlEntities(g.trim()))
            .filter((g) => g.length > 0 && !/^podcasts?$/i.test(g));

          outlines.push({
            id: podcastId,
            title,
            description: desc,
            rssUrl,
            htmlUrl,
            imageUrl,
            genres,
            typicalDurationMins: duration
          });
        }

        cachedCatalog = outlines;
        return outlines;
      } catch (err) {
        console.warn("Failed to fetch live OPML catalog:", err);
        return cachedCatalog;
      } finally {
        catalogFetchPromise = null;
      }
    })();

    return catalogFetchPromise;
  },

  /**
   * Synchronously return cached episodes for a podcast if already fetched or prefetched.
   */
  getEpisodesFromCache(podcastId: string): Episode[] | undefined {
    return episodesCache.get(podcastId);
  },

  /**
   * Background prefetch episodes for top podcasts to make user navigation instant.
   */
  async prefetchEpisodes(podcasts: Podcast[], limit = 25): Promise<void> {
    const targets = podcasts.slice(0, limit).filter((p) => !episodesCache.has(p.id));
    // Concurrently fetch 3 at a time in the background so we don't saturate the network
    const concurrency = 3;
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      await Promise.allSettled(batch.map((p) => this.fetchEpisodes(p.rssUrl, p.id)));
    }
  },

  /**
   * Reads only the newest `pubDate` from a feed, without parsing or caching the episode
   * list.
   *
   * The catalogue-wide "Last Updated" index needs one date per podcast, and `fetchEpisodes`
   * would fill the 60-entry bounded cache with all ~840 crawls, evicting the popular
   * episodes `prefetchEpisodes` deliberately warms so opening them is instant. Returns `0`
   * when the feed cannot be read.
   */
  async fetchLatestEpisodeMs(rssUrl: string, podcastId: string): Promise<number> {
    try {
      const res = await fetch(rssUrl.replace("http://", "https://"), {
        headers: {
          "User-Agent": "British Radio Player/1.0",
          Accept: "application/rss+xml,application/xml,text/xml,*/*"
        }
      });
      if (!res.ok) return 0;
      const xmlText = await res.text();
      harvestFeedLanguage(podcastId, xmlText);

      // Feeds are not reliably ordered, so every pubDate is read rather than the first.
      let max = 0;
      const openTag = "<pubDate";
      const closeTag = "</pubDate>";
      let cursor = 0;
      for (;;) {
        const start = xmlText.indexOf(openTag, cursor);
        if (start === -1) break;
        const openEnd = xmlText.indexOf(">", start + openTag.length);
        if (openEnd === -1) break;
        const end = xmlText.indexOf(closeTag, openEnd + 1);
        if (end === -1) break;
        cursor = end + closeTag.length;
        const epoch = parseEpisodeDateEpoch(
          xmlText.slice(openEnd + 1, end).replace(/<!\[CDATA\[|\]\]>/g, "").trim()
        );
        if (epoch > max) max = epoch;
      }
      return max;
    } catch {
      return 0;
    }
  },

  /**
   * Fetch and parse episodes from a podcast's BBC RSS feed.
   * Cached in-memory so subsequent views return immediately (0ms).
   */
  async fetchEpisodes(rssUrl: string, podcastId: string, forceRefresh = false): Promise<Episode[]> {
    if (!forceRefresh && episodesCache.has(podcastId)) {
      return episodesCache.get(podcastId)!;
    }

    if (episodeFetchPromises.has(podcastId)) {
      return episodeFetchPromises.get(podcastId)!;
    }

    const fetchPromise = (async () => {
      try {
        const secureRssUrl = rssUrl.replace("http://", "https://");
        const res = await fetch(secureRssUrl, {
          headers: {
            "User-Agent": "British Radio Player/1.0",
            Accept: "application/rss+xml,application/xml,text/xml,*/*"
          }
        });
        if (!res.ok) return episodesCache.get(podcastId) || [];
        const xmlText = await res.text();

        // We are already paying for this feed, so record its language for the
        // "Exclude non-English podcasts" filter instead of spending a request on it.
        harvestFeedLanguage(podcastId, xmlText);

        // Extract channel image
        let channelImage = "";
        const chImgIdx = xmlText.indexOf("<image>");
        if (chImgIdx !== -1) {
          const chImgEnd = xmlText.indexOf("</image>", chImgIdx);
          if (chImgEnd !== -1) {
            const chBlock = xmlText.slice(chImgIdx, chImgEnd);
            const uStart = chBlock.indexOf("<url>");
            if (uStart !== -1) {
              const uEnd = chBlock.indexOf("</url>", uStart);
              if (uEnd !== -1) {
                channelImage = chBlock.slice(uStart + 5, uEnd).trim().replace(/^http:\/\//i, "https://");
              }
            }
          }
        }
        if (!channelImage) {
          const itunesImgIdx = xmlText.indexOf("<itunes:image");
          if (itunesImgIdx !== -1) {
            const hIdx = xmlText.indexOf('href="', itunesImgIdx);
            if (hIdx !== -1) {
              const hEnd = xmlText.indexOf('"', hIdx + 6);
              if (hEnd !== -1) {
                channelImage = xmlText.slice(hIdx + 6, hEnd).trim().replace(/^http:\/\//i, "https://");
              }
            }
          }
        }

        // Extract channel title to resolve podcast names for feeds not in OPML
        let channelTitle = "";
        const chStart = xmlText.indexOf("<channel");
        if (chStart !== -1) {
          const tStart = xmlText.indexOf("<title>", chStart);
          if (tStart !== -1) {
            const tEnd = xmlText.indexOf("</title>", tStart);
            if (tEnd !== -1) {
              channelTitle = decodeXmlEntities(xmlText.slice(tStart + 7, tEnd).trim());
            }
          }
        }
        if (channelTitle || channelImage) {
          Preferences.setPodcastMetadata(podcastId, { title: channelTitle, imageUrl: channelImage });
        }

        // Fast linear substring parser (50x faster than RegExp per tag in Hermes)
        const episodes: Episode[] = [];
        let itemStart = 0;

        function extractTagFast(block: string, tag: string): string {
          const openTag = `<${tag}`;
          const s = block.indexOf(openTag);
          if (s === -1) return "";
          const cs = block.indexOf(">", s + openTag.length);
          if (cs === -1) return "";
          const closeTag = `</${tag}>`;
          const e = block.indexOf(closeTag, cs + 1);
          if (e === -1) return "";
          let val = block.slice(cs + 1, e).trim();
          if (val.startsWith("<![CDATA[")) {
            val = val.slice(9);
            const cdataEnd = val.indexOf("]]>");
            if (cdataEnd !== -1) val = val.slice(0, cdataEnd);
          }
          return val.trim();
        }

        while ((itemStart = xmlText.indexOf("<item", itemStart)) !== -1) {
          const tagClose = xmlText.indexOf(">", itemStart);
          if (tagClose === -1) break;
          const itemEnd = xmlText.indexOf("</item>", tagClose);
          if (itemEnd === -1) break;
          const itemContent = xmlText.slice(tagClose + 1, itemEnd);
          itemStart = itemEnd + 7;

          const title = decodeXmlEntities(extractTagFast(itemContent, "title"));
          let desc = decodeXmlEntities(extractTagFast(itemContent, "description"));
          if (!desc) desc = decodeXmlEntities(extractTagFast(itemContent, "itunes:summary"));

          // Audio URL: prefer secure HTTPS enclosure
          let audioUrl = "";
          const secEncIdx = itemContent.indexOf("<ppg:enclosureSecure");
          if (secEncIdx !== -1) {
            const uIdx = itemContent.indexOf('url="', secEncIdx);
            if (uIdx !== -1) {
              const uEnd = itemContent.indexOf('"', uIdx + 5);
              if (uEnd !== -1) audioUrl = itemContent.slice(uIdx + 5, uEnd).trim();
            }
          }
          if (!audioUrl) {
            const encIdx = itemContent.indexOf("<enclosure");
            if (encIdx !== -1) {
              const uIdx = itemContent.indexOf('url="', encIdx);
              if (uIdx !== -1) {
                const uEnd = itemContent.indexOf('"', uIdx + 5);
                if (uEnd !== -1) {
                  audioUrl = itemContent.slice(uIdx + 5, uEnd).trim().replace(/^http:\/\//i, "https://");
                }
              }
            }
          }
          if (audioUrl) {
            audioUrl = normalizeBbcAudioUrl(audioUrl);
          }

          // Episode specific artwork or fallback to channel
          let epImage = channelImage;
          const itunesImgIdx = itemContent.indexOf("<itunes:image");
          if (itunesImgIdx !== -1) {
            const hIdx = itemContent.indexOf('href="', itunesImgIdx);
            if (hIdx !== -1) {
              const hEnd = itemContent.indexOf('"', hIdx + 6);
              if (hEnd !== -1) {
                epImage = itemContent.slice(hIdx + 6, hEnd).trim().replace(/^http:\/\//i, "https://");
              }
            }
          }

          const pubDate = extractTagFast(itemContent, "pubDate");
          const durationStr = extractTagFast(itemContent, "itunes:duration");
          const durationMins = parseDurationSeconds(durationStr);

          // GUID / PID extraction
          const guid = extractTagFast(itemContent, "guid");
          let epId = normalizeEpisodeId(guid);
          if (!epId) {
            epId = `${podcastId}-${episodes.length}`;
          }

          if (title && audioUrl) {
            episodes.push({
              id: epId,
              title,
              description: desc,
              audioUrl,
              imageUrl: epImage,
              pubDate,
              durationMins,
              podcastId
            });
          }
        }

        // Ensure episodes are sorted by default with the newest episode first
        episodes.sort(byEpisodePubDate);

        episodesCache.set(podcastId, episodes);
        return episodes;
      } catch (err) {
        console.warn(`Failed to fetch episodes for podcast ${podcastId}:`, err);
        return episodesCache.get(podcastId) || [];
      }
    })();

    episodeFetchPromises.set(podcastId, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      episodeFetchPromises.delete(podcastId);
    }
  },

  /**
   * Helper to enrich Raspberry Pi search results with full artwork and metadata
   */
  enrichSearchResults(
    piResults: SearchPodcastResult[],
    catalog: Podcast[]
  ): Podcast[] {
    const catalogMap = new Map<string, Podcast>();
    catalog.forEach((p) => catalogMap.set(p.id, p));

    return piResults.map((r) => {
      const full = catalogMap.get(r.podcastId);
      if (full) return full;
      return {
        id: r.podcastId,
        title: r.title,
        description: decodeXmlEntities(r.description),
        rssUrl: `https://podcasts.files.bbci.co.uk/${r.podcastId}.rss`,
        htmlUrl: `https://www.bbc.co.uk/programmes/${r.podcastId}`,
        imageUrl: "",
        genres: [],
        typicalDurationMins: 0
      };
    });
  }
};

export * from "../utils/searchUtils";

