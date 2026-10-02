export interface PodcastRatingSummary {
  average: number;
  count: number;
  mine?: number;
}

/**
 * Calculates the updated rating summary immediately when a user submits a rating.
 * If the user has already rated this podcast, their previous rating is replaced
 * without increasing the total count. If this is their first rating, the count
 * is incremented.
 */
export function calculateUpdatedRating(
  current: { average?: number; count?: number; mine?: number } | undefined,
  newRating: number
): { average: number; count: number; mine: number } {
  const clampedRating = Math.max(1, Math.min(5, Math.round(newRating)));
  const count = Math.max(0, Number(current?.count) || 0);
  const avg = Math.max(0, Number(current?.average) || 0);
  const prevMine =
    current?.mine != null && current.mine > 0 ? Math.max(1, Math.min(5, Math.round(current.mine))) : undefined;

  let newCount: number;
  let newAvg: number;

  if (prevMine !== undefined && count > 0) {
    newCount = count;
    const total = avg * count - prevMine + clampedRating;
    newAvg = total / newCount;
  } else {
    newCount = count + 1;
    const total = avg * count + clampedRating;
    newAvg = total / newCount;
  }

  const roundedAvg = Math.max(1, Math.min(5, Math.round(newAvg * 10) / 10));

  return {
    average: roundedAvg,
    count: newCount,
    mine: clampedRating
  };
}

/**
 * Formats a rating value for display:
 * If the value is a whole number (e.g. 5, 4.0), it displays without decimal places ("5", "4").
 * If it has a non-zero decimal part (e.g. 4.5, 3.2), it displays with one decimal place ("4.5", "3.2").
 */
export function formatRatingValue(val: number): string {
  if (typeof val !== "number" || Number.isNaN(val)) return "0";
  const rounded = Math.round(val * 10) / 10;
  if (rounded % 1 === 0) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1);
}
