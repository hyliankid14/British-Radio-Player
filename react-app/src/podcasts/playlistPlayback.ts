import { byEpisodePubDate, byEpisodePubDateOldest } from "./episodeDates.ts";
import { normalizeEpisodeId } from "../downloads/downloadLimits.ts";

export type PlaylistSort = "newest_first" | "oldest_first" | "title" | "manual";

export interface SavedEpisodeEntry {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  audioUrl: string;
  pubDate: string;
  durationMins: number;
  podcastId: string;
  podcastTitle: string;
  savedAtMs?: number;
}

export interface PlaylistStorageReader {
  getPodcastPlaylistEntries: (playlistId: string) => SavedEpisodeEntry[];
  getDownloadedEntries: () => Record<string, { entry: SavedEpisodeEntry; downloadedAtMs: number }>;
  getPlaylistSort: (playlistId: string) => PlaylistSort;
  getPlaylistManualOrder: (playlistId: string) => string[];
  getHidePlayedEpisodesInPlaylists: () => boolean;
  getPlayedEpisodeIdSet: () => Set<string>;
  isEpisodeDownloaded: (id: string) => boolean;
}

let activeStorageReader: PlaylistStorageReader | null = null;

export function setPlaylistStorageReader(reader: PlaylistStorageReader | null): void {
  activeStorageReader = reader;
}

export function getPlaylistStorageReader(): PlaylistStorageReader | null {
  return activeStorageReader;
}

/**
 * Sorts saved episode entries according to the playlist sort criteria.
 */
export function sortPlaylistEntries(
  entries: SavedEpisodeEntry[],
  sort: PlaylistSort,
  manualOrder: string[] = []
): SavedEpisodeEntry[] {
  if (sort === "newest_first") {
    return [...entries].sort(byEpisodePubDate);
  }
  if (sort === "oldest_first") {
    return [...entries].sort(byEpisodePubDateOldest);
  }
  if (sort === "title") {
    return [...entries].sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sort === "manual") {
    const orderMap = new Map(manualOrder.map((id, index) => [id, index]));
    return [...entries].sort((a, b) => {
      const indexA = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
      const indexB = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
      if (indexA !== indexB) return indexA - indexB;
      return byEpisodePubDate(a, b);
    });
  }
  return [...entries];
}

/**
 * Loads and sorts entries for a playlist, ready for playback in first-to-last playlist order.
 */
export function getPlaylistEntriesForPlayback(
  playlistId: string,
  options?: { isOnline?: boolean; hidePlayed?: boolean; reader?: PlaylistStorageReader }
): SavedEpisodeEntry[] {
  const reader = options?.reader || activeStorageReader;
  if (!reader) return [];

  let raw: SavedEpisodeEntry[] = [];
  if (playlistId === "downloaded") {
    raw = Object.values(reader.getDownloadedEntries())
      .sort((a, b) => b.downloadedAtMs - a.downloadedAtMs)
      .map((record) => record.entry);
  } else {
    raw = reader.getPodcastPlaylistEntries(playlistId);
    if (options?.isOnline === false) {
      raw = raw.filter((entry) => reader.isEpisodeDownloaded(entry.id));
    }
  }

  const sort = reader.getPlaylistSort(playlistId);
  const manualOrder = reader.getPlaylistManualOrder(playlistId);
  let sorted = sortPlaylistEntries(raw, sort, manualOrder);

  const shouldHidePlayed = options?.hidePlayed ?? reader.getHidePlayedEpisodesInPlaylists();
  if (shouldHidePlayed) {
    const played = reader.getPlayedEpisodeIdSet();
    sorted = sorted.filter((entry) => !played.has(entry.id));
  }

  return sorted;
}

/**
 * Finds the next episode to play when an episode finishes in a playlist,
 * guaranteeing playback advances from first to last in the playlist's configured order.
 */
export function findNextPlaylistEpisodeToPlay(
  playlistEntries: SavedEpisodeEntry[],
  currentEpisodeId: string,
  isPlayed?: (id: string) => boolean
): SavedEpisodeEntry | undefined {
  if (!playlistEntries.length) return undefined;

  const currentNormId = normalizeEpisodeId(currentEpisodeId) || currentEpisodeId;
  const currentIndex = playlistEntries.findIndex(
    (e) => e.id === currentEpisodeId || (normalizeEpisodeId(e.id) || e.id) === currentNormId
  );

  if (currentIndex !== -1) {
    for (let i = currentIndex + 1; i < playlistEntries.length; i++) {
      const candidate = playlistEntries[i];
      if (!isPlayed || !isPlayed(candidate.id)) {
        return candidate;
      }
    }
    return undefined;
  }

  // Current episode not found in the playlist. Advance to the first unplayed episode in the playlist order.
  for (const entry of playlistEntries) {
    if (!isPlayed || !isPlayed(entry.id)) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Finds the previous episode in the playlist order.
 */
export function findPreviousPlaylistEpisodeToPlay(
  playlistEntries: SavedEpisodeEntry[],
  currentEpisodeId: string
): SavedEpisodeEntry | undefined {
  if (!playlistEntries.length) return undefined;

  const currentNormId = normalizeEpisodeId(currentEpisodeId) || currentEpisodeId;
  const currentIndex = playlistEntries.findIndex(
    (e) => e.id === currentEpisodeId || (normalizeEpisodeId(e.id) || e.id) === currentNormId
  );

  if (currentIndex > 0) {
    return playlistEntries[currentIndex - 1];
  }
  return undefined;
}
