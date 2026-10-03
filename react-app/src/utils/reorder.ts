/**
 * Reordering helpers shared by the manually sorted lists in favourites.
 *
 * Both lists persist their manual order as a plain array of ids, so a row that
 * has never been dragged has to sort somewhere predictable. Unknown ids fall to
 * the end, keeping the relative order they already had.
 */
export function applyManualOrder<T extends { id: string }>(
  items: T[],
  manualOrder: string[]
): T[] {
  if (manualOrder.length === 0) return [...items];
  const rank = new Map(manualOrder.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

/** Moves the item at `fromIndex` to `toIndex`, leaving the input untouched. */
export function moveItemToIndex<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  if (fromIndex < 0 || fromIndex >= next.length) return next;
  if (toIndex < 0 || toIndex >= next.length) return next;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
