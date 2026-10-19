/**
 * Known legacy or secondary feed IDs mapped to their canonical BBC programme PID.
 * For example, "More or Less" had an earlier active RSS feed (p02nrss1) which was
 * superseded by the live OPML catalogue ID (b006qshd).
 */
export const PODCAST_ID_ALIASES: Record<string, string> = {
  p02nrss1: "b006qshd"
};

export function canonicalPodcastId(id: string): string {
  const clean = (id || "").trim();
  return PODCAST_ID_ALIASES[clean] || clean;
}
