/**
 * Pure message builders for the download notifications. Kept free of React
 * Native/expo-notifications imports so the wording can be unit tested under the
 * plain Node test runner.
 */

function episodeCount(count: number): string {
  return count === 1 ? "1 episode" : `${count} episodes`;
}

/** Body for the notice shown while one or more downloads are in flight. */
export function downloadStartedBody(count: number): string {
  return count === 1 ? "Downloading 1 episode…" : `Downloading ${count} episodes…`;
}

export interface DownloadFinishedNotice {
  title: string;
  body: string;
}

/**
 * Title and body for the summary shown once every in-flight download has settled.
 * Returns null when nothing ran, so no empty notification is posted.
 */
export function downloadFinishedNotice(okCount: number, failCount: number): DownloadFinishedNotice | null {
  if (okCount <= 0 && failCount <= 0) return null;
  if (okCount > 0) {
    const body =
      failCount > 0
        ? `${episodeCount(okCount)} downloaded, ${episodeCount(failCount)} failed`
        : `${episodeCount(okCount)} downloaded`;
    return { title: "Downloads complete", body };
  }
  return { title: "Download failed", body: `Could not download ${episodeCount(failCount)}` };
}
