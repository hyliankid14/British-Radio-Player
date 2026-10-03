import { applyManualOrder } from "../utils/reorder.ts";

/**
 * Saved searches mirror the subscribed podcast sort modes, minus "sort by tags"
 * (a saved search has nothing to tag). "Recently updated" means the newest
 * episode the search last matched, the same signal the row shows as "Latest:".
 */
export type SavedSearchSort =
  | "most_recently_updated"
  | "least_recently_updated"
  | "alphabetical"
  | "manual";

export const SAVED_SEARCH_SORT_OPTIONS: ReadonlyArray<readonly [string, SavedSearchSort]> = [
  ["Most recently updated", "most_recently_updated"],
  ["Least recently updated", "least_recently_updated"],
  ["Alphabetical (A-Z)", "alphabetical"],
  ["Manual sort", "manual"]
];

export const DEFAULT_SAVED_SEARCH_SORT: SavedSearchSort = "most_recently_updated";

/** Falls back to the default for an unset or unrecognised stored value. */
export function parseSavedSearchSort(value: unknown): SavedSearchSort {
  const match = SAVED_SEARCH_SORT_OPTIONS.find(([, sort]) => sort === value);
  return match ? match[1] : DEFAULT_SAVED_SEARCH_SORT;
}

export interface SortableSearch {
  id: string;
  name: string;
  latestResultDate?: string;
}

function latestResultEpoch(search: SortableSearch): number {
  if (!search.latestResultDate) return 0;
  const parsed = Date.parse(search.latestResultDate);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Sorts without mutating the input. Searches with no (or an unparseable) result
 * date count as 0, so they land last in both recency orders.
 */
export function sortSavedSearches<T extends SortableSearch>(
  searches: T[],
  sort: SavedSearchSort,
  manualOrder: string[]
): T[] {
  if (sort === "alphabetical") {
    return [...searches].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sort === "manual") {
    return applyManualOrder(searches, manualOrder);
  }
  const byLatest = (a: T, b: T) =>
    sort === "least_recently_updated"
      ? latestResultEpoch(a) - latestResultEpoch(b)
      : latestResultEpoch(b) - latestResultEpoch(a);
  return [...searches].sort(byLatest);
}
