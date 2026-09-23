import { PI_BASE_URL } from "../api/podcasts";

export interface IndexStatus {
  /** ISO timestamp from `podcast-index-meta.json`. */
  generatedAt: string;
  podcastCount: number;
  episodeCount: number;
  /** ISO timestamp from the popular-podcasts snapshot. */
  popularGeneratedAt: string;
}

/**
 * Reads live index metadata from the cloud index:
 *  - `podcast-index-meta.json` → generated_at / podcast_count / episode_count
 *  - `popular-podcasts.json`   → generated_at (most popular snapshot)
 */
export async function fetchIndexStatus(): Promise<IndexStatus | null> {
  try {
    const [metaRes, popularRes] = await Promise.all([
      fetch(`${PI_BASE_URL}/data/podcast-index-meta.json`, { headers: { Accept: "application/json" } }),
      fetch(`${PI_BASE_URL}/data/popular-podcasts.json`, { headers: { Accept: "application/json" } })
    ]);

    let generatedAt = "";
    let podcastCount = 0;
    let episodeCount = 0;
    let popularGeneratedAt = "";

    if (metaRes.ok) {
      const meta = await metaRes.json();
      generatedAt = String(meta?.generated_at ?? "");
      podcastCount = Number(meta?.podcast_count) || 0;
      episodeCount = Number(meta?.episode_count) || 0;
    }
    if (popularRes.ok) {
      const popular = await popularRes.json();
      popularGeneratedAt = String(popular?.generated_at ?? "");
    }

    if (!generatedAt && podcastCount === 0 && episodeCount === 0) return null;
    return { generatedAt, podcastCount, episodeCount, popularGeneratedAt };
  } catch (error) {
    console.warn("Failed to fetch index status:", error);
    return null;
  }
}
