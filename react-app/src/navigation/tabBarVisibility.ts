/**
 * The main navigation belongs to the four top-level tabs. Drill-downs — episode and
 * podcast detail, playlist detail, search, schedule, now playing — are pushed onto the
 * root stack, which leaves the `(tabs)` group in the route segments, so the tab bar has
 * to collapse for them.
 */
export function isTopLevelTabRoute(segments: readonly string[]): boolean {
  return segments[0] === "(tabs)";
}
