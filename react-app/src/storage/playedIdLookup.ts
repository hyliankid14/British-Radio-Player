import { normalizeEpisodeId } from "../downloads/downloadLimits.ts";

/**
 * Membership structures for the played-episode list.
 *
 * The original check parsed the whole list and then walked every entry calling
 * `normalizeEpisodeId` on it. That ran once per second on the playback path, so its cost was
 * O(episodes ever played) and only ever grew. Precomputing both the raw ids and their
 * normalised forms turns the same question into two O(1) set lookups.
 *
 * `normalizeEpisodeId` is idempotent — it either returns a candidate that is free of `/`,
 * `:` and `%` and so normalises to itself, or it returns its input unchanged — which is what
 * makes the set form equivalent to the scanning form.
 */
export interface PlayedIdLookup {
  raw: Set<string>;
  normalized: Set<string>;
}

export function createPlayedIdLookup(ids: string[]): PlayedIdLookup {
  const raw = new Set<string>();
  const normalized = new Set<string>();
  for (const id of ids) {
    raw.add(id);
    const norm = normalizeEpisodeId(id);
    if (norm) normalized.add(norm);
  }
  return { raw, normalized };
}

export function isPlayedId(lookup: PlayedIdLookup, episodeId: string): boolean {
  if (!episodeId) return false;
  // A stored id identical to the query, matched without normalising either side.
  if (lookup.raw.has(episodeId)) return true;
  const norm = normalizeEpisodeId(episodeId);
  if (norm) return lookup.normalized.has(norm);
  // No normalised form, so the original compared the query's raw id against each stored id's
  // normalised form.
  return lookup.normalized.has(episodeId);
}
