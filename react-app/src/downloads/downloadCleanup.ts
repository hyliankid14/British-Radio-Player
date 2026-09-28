import { Preferences } from "../storage/preferences";
import {
  enforceMaxDownloads,
  enforcePerPodcastDownloadLimit,
  getDownloadInUseEpisode,
  setDownloadInUseEpisode,
  useDownloadStore
} from "./downloadStore";
import { DELETE_PLAYED_PREF_KEY } from "./downloadLimits";

let registered = false;

/** Episode ids marked as played in this tick, awaiting a single batched cleanup. */
const pendingPlayed = new Set<string>();
let flushHandle: ReturnType<typeof setTimeout> | null = null;

export { setDownloadInUseEpisode };

/** Whether finished episodes should have their download removed. */
export function isDeleteWhenPlayed(): boolean {
  return Boolean(Preferences.getSetting(DELETE_PLAYED_PREF_KEY, false));
}

/**
 * Brings the library back inside the configured limits: the per-podcast automatic
 * download cap first, then the global maximum. Returns the number removed.
 */
export function pruneDownloads(): number {
  const remove = (id: string) => useDownloadStore.getState().remove(id);
  return enforcePerPodcastDownloadLimit(remove) + enforceMaxDownloads(remove);
}

/** Removes a single download when "Delete when completed" is switched on. */
export function deleteDownloadWhenPlayed(episodeId: string): boolean {
  if (!episodeId || !isDeleteWhenPlayed()) return false;
  if (!Preferences.isEpisodeDownloaded(episodeId)) return false;
  if (getDownloadInUseEpisode() === episodeId) return false;
  useDownloadStore.getState().remove(episodeId);
  return true;
}

/**
 * Removes the downloads of every episode just marked as played. Batched so
 * bulk "mark as played" actions rewrite the download records once rather than
 * once per episode.
 */
function flushPlayedDownloads(): void {
  flushHandle = null;
  if (pendingPlayed.size === 0) return;
  const ids = Array.from(pendingPlayed);
  pendingPlayed.clear();
  if (!isDeleteWhenPlayed()) return;
  for (const id of ids) {
    if (getDownloadInUseEpisode() === id) continue;
    if (Preferences.isEpisodeDownloaded(id)) {
      useDownloadStore.getState().remove(id);
    }
  }
}

function schedulePlayedCleanup(episodeId: string): void {
  pendingPlayed.add(episodeId);
  if (flushHandle) return;
  flushHandle = setTimeout(flushPlayedDownloads, 0);
}

/**
 * Keeps downloads tidy: removes a download as soon as its episode is marked
 * played, and trims the library back to the configured limits.
 */
export function initDownloadCleanup(): () => void {
  if (registered) return () => {};
  registered = true;
  const unsubscribe = Preferences.onEpisodePlayed(schedulePlayedCleanup);
  pruneDownloads();
  return () => {
    registered = false;
    if (flushHandle) {
      clearTimeout(flushHandle);
      flushHandle = null;
    }
    pendingPlayed.clear();
    unsubscribe();
  };
}
