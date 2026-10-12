import type { Podcast, PopularEntry } from "../api/podcasts.ts";

export interface PopularRankings {
  idRanks: Map<string, number>;
  titleRanks: Map<string, number>;
}

/**
 * Normalizes a podcast title for resilient rank matching across different BBC index formats.
 * Normalizes case, trims whitespace, standardizes smart quotes/apostrophes, and collapses spaces.
 */
export function normalizePodcastTitle(title?: string): string {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
}

/**
 * Builds 1-based popularity lookup tables by both podcast ID and normalized title.
 * This mirrors the resilient ranking behavior of the legacy application, ensuring
 * that podcasts whose IDs differ between the analytics database (e.g. legacy numeric
 * hashes or older programme IDs) and the live BBC OPML catalog still match and appear in rank order.
 */
export function buildPopularRankings(entries: PopularEntry[]): PopularRankings {
  const idRanks = new Map<string, number>();
  const titleRanks = new Map<string, number>();

  entries.forEach((entry, idx) => {
    const rank = idx + 1;
    const cleanId = entry.id?.trim();
    if (cleanId && !idRanks.has(cleanId)) {
      idRanks.set(cleanId, rank);
    }
    const cleanTitle = normalizePodcastTitle(entry.name);
    if (cleanTitle && !titleRanks.has(cleanTitle)) {
      titleRanks.set(cleanTitle, rank);
    }
  });

  return { idRanks, titleRanks };
}

/**
 * Resolves the 1-based popularity rank for a podcast.
 * Prefers exact ID match; falls back to normalized title match.
 * Returns null if the podcast does not have a rank in the popularity snapshot.
 */
export function getPopularRank(
  rankings: PopularRankings,
  podcast: Pick<Podcast, "id" | "title">
): number | null {
  const cleanId = podcast.id?.trim();
  if (cleanId) {
    const byId = rankings.idRanks.get(cleanId);
    if (byId !== undefined) return byId;
  }

  const cleanTitle = normalizePodcastTitle(podcast.title);
  if (cleanTitle) {
    const byTitle = rankings.titleRanks.get(cleanTitle);
    if (byTitle !== undefined) return byTitle;
  }

  return null;
}

/**
 * Checks whether a podcast is included in the popular rankings snapshot
 * by either its ID or normalized title.
 */
export function hasPopularRank(
  rankings: PopularRankings,
  podcast: Pick<Podcast, "id" | "title">
): boolean {
  return getPopularRank(rankings, podcast) !== null;
}
