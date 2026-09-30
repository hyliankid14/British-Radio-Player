/**
 * Pure message builders for the download notifications. Kept free of React
 * Native/expo-notifications imports so the wording can be unit tested under the
 * plain Node test runner.
 */

function episodeCount(count: number): string {
  return count === 1 ? "1 episode" : `${count} episodes`;
}

/** Body for the notice shown while one or more downloads are in flight. */
export function downloadStartedBody(count: number, titles: string[] = []): string {
  if (titles.length === 1) return `Downloading "${titles[0]}"…`;
  if (count === 1) return "Downloading 1 episode…";
  return `Downloading ${count} episodes…`;
}

export interface DownloadFinishedNotice {
  title: string;
  body: string;
}

/**
 * Title and body for the summary shown once every in-flight download has settled.
 * Returns null when nothing ran, so no empty notification is posted.
 *
 * `failedTitles` is a list of episode titles that failed; when provided they are
 * named in the notification body so the user knows exactly what to retry.
 */
export function downloadFinishedNotice(
  okCount: number,
  failCount: number,
  failedTitles: string[] = []
): DownloadFinishedNotice | null {
  if (okCount <= 0 && failCount <= 0) return null;

  const failBody = buildFailBody(failCount, failedTitles);

  if (okCount > 0) {
    const okPart = `${episodeCount(okCount)} downloaded`;
    const body = failCount > 0 ? `${okPart} — ${failBody}` : okPart;
    return { title: "Downloads complete", body };
  }

  // All failed.
  return { title: "Download failed", body: failBody };
}

/**
 * Builds the failure portion of the body text.
 *
 * - 1 failure  → "Could not download "Episode Title""
 * - 2 failures → "Could not download "Title A" or "Title B""
 * - 3 failures → "Could not download "Title A", "Title B" or 1 more"
 * - 4+ with titles → "Could not download "Title A", "Title B" or N more"
 * - No titles  → "Could not download N episodes"
 */
function buildFailBody(failCount: number, failedTitles: string[]): string {
  const known = failedTitles.slice(0, 2);

  if (known.length === 0) {
    return `Could not download ${episodeCount(failCount)}`;
  }

  const quoted = known.map((t) => `"${t}"`);
  const remainder = failCount - known.length;

  if (remainder <= 0) {
    if (quoted.length === 1) return `Could not download ${quoted[0]}`;
    return `Could not download ${quoted[0]} or ${quoted[1]}`;
  }

  const morePart = remainder === 1 ? "1 more" : `${remainder} more`;
  return `Could not download ${quoted.join(", ")} or ${morePart}`;
}
