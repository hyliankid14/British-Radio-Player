/**
 * Merges the modern per-episode progress map with the legacy
 * last-podcast-position map that `getEpisodeProgress` still falls back to.
 *
 * Kept pure so list screens can build every episode's progress from a couple of
 * MMKV reads instead of one synchronous read + JSON parse per row.
 */
export function mergeEpisodeProgress(
  progress: Record<string, number>,
  positions: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...progress };
  for (const id of Object.keys(positions)) {
    // Match `getEpisodeProgress`, which falls back on any falsy modern value.
    if (!merged[id]) {
      merged[id] = positions[id];
    }
  }
  return merged;
}
