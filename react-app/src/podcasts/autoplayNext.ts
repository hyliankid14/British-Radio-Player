import { normalizeEpisodeId } from "../downloads/downloadLimits.ts";
import type { Episode } from "../api/podcasts.ts";
import { parseEpisodeDateEpoch } from "./episodeDates.ts";

/** @internal Re-exported so existing callers keep one canonical implementation. */
export { parseEpisodeDateEpoch as parseEpisodePubDateEpoch };

/**
 * Finds the next unplayed episode to advance to when the current episode ends.
 *
 * - When `order === "oldest_first"` (sorted oldest to newest):
 *   Advances to the next oldest unplayed episode (chronological order).
 * - When `order === "newest_first"` (sorted newest to oldest):
 *   Advances to the next unplayed episode in the reverse-chronological list.
 *
 * Falls back to matching by publication date or the first unplayed episode in the
 * configured order if the current episode cannot be matched by index.
 */
export function findNextEpisodeToPlay(
  episodes: Episode[],
  currentEpisode: Episode,
  order: "oldest_first" | "newest_first",
  isPlayed: (episodeId: string) => boolean
): Episode | undefined {
  if (!episodes.length) return undefined;

  const currentNormId = normalizeEpisodeId(currentEpisode.id) || currentEpisode.id;
  const currentTitle = currentEpisode.title?.trim().toLowerCase();
  const currentEpoch = parseEpisodeDateEpoch(currentEpisode.pubDate);

  const isCurrent = (ep: Episode) => {
    if (ep.id === currentEpisode.id) return true;
    const norm = normalizeEpisodeId(ep.id) || ep.id;
    if (norm && norm === currentNormId) return true;
    if (currentTitle && ep.title && ep.title.trim().toLowerCase() === currentTitle) return true;
    return false;
  };

  const checkPlayed = (ep: Episode) => {
    if (isPlayed(ep.id)) return true;
    const norm = normalizeEpisodeId(ep.id);
    if (norm && isPlayed(norm)) return true;
    return false;
  };

  if (order === "oldest_first") {
    // Sort oldest first (ascending epoch; undated last)
    const sorted = [...episodes].sort((a, b) => {
      const aEpoch = parseEpisodeDateEpoch(a.pubDate);
      const bEpoch = parseEpisodeDateEpoch(b.pubDate);
      if (!aEpoch && !bEpoch) return 0;
      if (!aEpoch) return 1;
      if (!bEpoch) return -1;
      return aEpoch - bEpoch;
    });

    const currentIndex = sorted.findIndex(isCurrent);
    if (currentIndex !== -1) {
      const nextAfter = sorted
        .slice(currentIndex + 1)
        .find((ep) => !checkPlayed(ep) && !isCurrent(ep));
      if (nextAfter) return nextAfter;
    }

    // If not found by index, find unplayed episodes published after currentEpisode
    if (currentEpoch > 0) {
      const nextByDate = sorted.find((ep) => {
        if (isCurrent(ep) || checkPlayed(ep)) return false;
        const epoch = parseEpisodeDateEpoch(ep.pubDate);
        return epoch > currentEpoch;
      });
      if (nextByDate) return nextByDate;
    }

    // Fallback: first unplayed episode in oldest-first order
    return sorted.find((ep) => !isCurrent(ep) && !checkPlayed(ep));
  } else {
    // Newest first (descending epoch; undated last)
    const sorted = [...episodes].sort((a, b) => {
      const aEpoch = parseEpisodeDateEpoch(a.pubDate);
      const bEpoch = parseEpisodeDateEpoch(b.pubDate);
      return bEpoch - aEpoch;
    });

    const currentIndex = sorted.findIndex(isCurrent);
    if (currentIndex !== -1) {
      const nextAfter = sorted
        .slice(currentIndex + 1)
        .find((ep) => !checkPlayed(ep) && !isCurrent(ep));
      if (nextAfter) return nextAfter;
    }

    // If not found by index, find unplayed episodes published before currentEpisode
    if (currentEpoch > 0) {
      const nextByDate = sorted.find((ep) => {
        if (isCurrent(ep) || checkPlayed(ep)) return false;
        const epoch = parseEpisodeDateEpoch(ep.pubDate);
        return epoch < currentEpoch;
      });
      if (nextByDate) return nextByDate;
    }

    return sorted.find((ep) => !isCurrent(ep) && !checkPlayed(ep));
  }
}
