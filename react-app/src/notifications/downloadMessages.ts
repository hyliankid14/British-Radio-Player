/**
 * Pure message builders for the download notifications. Kept free of React
 * Native/expo-notifications imports so the wording can be unit tested under the
 * plain Node test runner.
 */

export interface DownloadItemSummary {
  title: string;
  podcastTitle?: string;
  podcastId?: string;
  episodeId?: string;
}

export type DownloadSummaryItem = string | DownloadItemSummary;

function itemTitle(item: DownloadSummaryItem | undefined): string {
  if (!item) return "";
  if (typeof item === "string") return item.trim();
  return (item.title || "").trim();
}

function itemPodcast(item: DownloadSummaryItem | undefined): string | undefined {
  if (!item || typeof item === "string") return undefined;
  const p = item.podcastTitle?.trim();
  return p && p.length > 0 ? p : undefined;
}

function episodeCount(count: number): string {
  return count === 1 ? "1 episode" : `${count} episodes`;
}

/** Body for the notice shown while one or more downloads are in flight. */
export function downloadStartedBody(count: number, titles: DownloadSummaryItem[] = []): string {
  const formatted = titles.map((t) => itemTitle(t)).filter((t) => t.length > 0);
  if (formatted.length === 1) {
    const podcast = itemPodcast(titles[0]);
    if (podcast && podcast.toLowerCase() !== formatted[0].toLowerCase()) {
      return `Downloading "${formatted[0]}" • ${podcast}…`;
    }
    return `Downloading "${formatted[0]}"…`;
  }
  if (count === 1) return "Downloading 1 episode…";
  return `Downloading ${count} episodes…`;
}

export interface DownloadFinishedNotice {
  title: string;
  body: string;
}

function formatSingleSuccess(item: DownloadSummaryItem, withSuffix = false): string {
  const title = itemTitle(item);
  const podcast = itemPodcast(item);
  const suffix = withSuffix ? " downloaded" : "";
  if (!title) {
    return `${episodeCount(1)}${suffix || " downloaded"}`;
  }
  if (podcast && podcast.toLowerCase() !== title.toLowerCase()) {
    return `"${title}" • ${podcast}${suffix}`;
  }
  return `"${title}"${suffix}`;
}

function buildSuccessBody(
  okCount: number,
  items: DownloadSummaryItem[],
  withSuffix = false
): string {
  const known = items.map((i) => itemTitle(i)).filter((t) => t.length > 0);
  const suffix = withSuffix ? " downloaded" : "";

  if (known.length === 0) {
    return `${episodeCount(okCount)}${suffix || " downloaded"}`;
  }

  if (okCount === 1) {
    return formatSingleSuccess(items[0], withSuffix);
  }

  const quoted = known.slice(0, 2).map((t) => `"${t}"`);
  const remainder = okCount - quoted.length;

  if (remainder <= 0) {
    if (quoted.length === 1) {
      return `${quoted[0]}${suffix}`;
    }
    return `${quoted[0]} and ${quoted[1]}${suffix}`;
  }

  const morePart = remainder === 1 ? "1 more" : `${remainder} more`;
  return `${quoted.join(", ")} and ${morePart}${suffix}`;
}

/**
 * Title and body for the summary shown once every in-flight download has settled.
 * Returns null when nothing ran, so no empty notification is posted.
 *
 * `failedTitles` is a list of episode titles that failed; when provided they are
 * named in the notification body so the user knows exactly what to retry.
 * `succeededItems` is a list of episode titles or summary objects that succeeded.
 */
export function downloadFinishedNotice(
  okCount: number,
  failCount: number,
  failedTitles: string[] = [],
  succeededItems: DownloadSummaryItem[] = []
): DownloadFinishedNotice | null {
  if (okCount <= 0 && failCount <= 0) return null;

  const failBody = buildFailBody(failCount, failedTitles);

  if (okCount > 0) {
    const title = okCount === 1 && failCount === 0 ? "Download complete" : "Downloads complete";
    const okPart = buildSuccessBody(okCount, succeededItems, failCount > 0);
    const body = failCount > 0 ? `${okPart} — ${failBody}` : okPart;
    return { title, body };
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
