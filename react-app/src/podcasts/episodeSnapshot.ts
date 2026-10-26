import { byEpisodePubDate } from "./episodeDates.ts";

/**
 * Shapes an episode list for persistence.
 *
 * The in-memory cache in `src/api/podcasts.ts` holds whole feeds; the durable snapshot holds
 * only what the app can plausibly revisit. Without a cap, a subscription list of any size
 * would push the store into megabytes — BBC feeds run to hundreds of episodes and their
 * descriptions run to paragraphs.
 *
 * Kept free of storage and platform imports so the rules are testable on their own.
 */

/**
 * How many episodes of one podcast are persisted, newest first.
 *
 * The in-car surface caps to 50 per show (`buildAutoSnapshot`), and BBC feeds rotate their back
 * catalogue out continuously, so a little headroom over that cap is all any consumer needs.
 */
export const MAX_EPISODES_PER_SNAPSHOT = 60;

/** Descriptions are truncated to this many characters before persisting. */
export const MAX_SNAPSHOT_DESCRIPTION_CHARS = 400;

/** An episode row, structurally `Episode` from `src/api/podcasts.ts`. */
export interface SnapshotEpisode {
  id: string;
  title: string;
  description: string;
  audioUrl: string;
  imageUrl: string;
  pubDate: string;
  durationMins: number;
  podcastId: string;
}

/** One podcast's persisted episode list, plus when the feed was read. */
export interface EpisodeSnapshot {
  fetchedAtMs: number;
  episodes: SnapshotEpisode[];
}

/**
 * Orders newest first, truncates descriptions, drops rows without an id, and caps the list.
 *
 * The cap keeps the *newest* entries, which is what a consumer would play; the sort happens
 * first so the truncation is not dependent on the feed's own ordering.
 */
export function shapeEpisodeSnapshot(podcastId: string, episodes: SnapshotEpisode[]): SnapshotEpisode[] {
  if (!Array.isArray(episodes)) return [];
  return episodes
    .filter((episode) => !!episode && typeof episode === "object" && typeof episode.id === "string" && episode.id !== "")
    .map((episode) => ({
      ...episode,
      podcastId: episode.podcastId || podcastId,
      description:
        typeof episode.description === "string"
          ? episode.description.slice(0, MAX_SNAPSHOT_DESCRIPTION_CHARS)
          : ""
    }))
    .sort(byEpisodePubDate)
    .slice(0, MAX_EPISODES_PER_SNAPSHOT);
}

/** Validates a stored snapshot, returning `null` when it is unusable. */
export function readEpisodeSnapshot(
  stored: unknown
): EpisodeSnapshot | null {
  if (!stored || typeof stored !== "object") return null;
  const record = stored as { fetchedAtMs?: unknown; episodes?: unknown };
  if (!Array.isArray(record.episodes)) return null;
  const episodes = (record.episodes as SnapshotEpisode[]).filter(
    (episode) => !!episode && typeof episode === "object" && typeof episode.id === "string" && episode.id !== ""
  );
  if (episodes.length === 0) return null;
  return {
    fetchedAtMs: typeof record.fetchedAtMs === "number" ? record.fetchedAtMs : 0,
    episodes
  };
}
