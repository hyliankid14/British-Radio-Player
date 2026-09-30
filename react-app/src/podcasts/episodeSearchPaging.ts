import type { SearchEpisodeResult } from "../api/podcasts";

/**
 * Accumulator for lazily paged episode search results.
 *
 * Broad queries such as "More or Less" or "Newscast" match thousands of
 * episodes. The search screen fetches one small page up front and only asks for
 * further pages when the user requests them, so the offset, dedupe and
 * end-of-results rules live here rather than in the component.
 */
export interface EpisodePageState {
  /** Every candidate fetched so far, in arrival order, deduplicated by id. */
  episodes: SearchEpisodeResult[];
  /** Offset to request for the next page. */
  nextOffset: number;
  /** True once the server runs out of rows or the cap is reached. */
  exhausted: boolean;
}

export function emptyEpisodePageState(): EpisodePageState {
  return { episodes: [], nextOffset: 0, exhausted: false };
}

/**
 * Merge one fetched page into the accumulated state.
 *
 * `pageSize` — the size the page was requested at, not the number of rows that
 * came back. Phrase searches widen a page with per-term results, and advancing
 * by the inflated row count would skip hits in the main query.
 */
export function appendEpisodePage(
  state: EpisodePageState,
  batch: SearchEpisodeResult[],
  pageSize: number,
  maxEpisodes: number
): EpisodePageState {
  const merged = [...state.episodes];
  const seenIds = new Set(merged.map((episode) => episode.episodeId));
  for (const episode of batch) {
    if (!seenIds.has(episode.episodeId)) {
      merged.push(episode);
      seenIds.add(episode.episodeId);
    }
  }

  return {
    episodes: merged,
    nextOffset: state.nextOffset + pageSize,
    exhausted: batch.length < pageSize || merged.length >= maxEpisodes
  };
}
