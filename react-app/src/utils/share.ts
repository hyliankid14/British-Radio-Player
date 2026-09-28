import { Share } from "react-native";
import {
  buildEpisodeShareMessage,
  buildEpisodeShareUrl,
  buildPodcastShareMessage,
  buildPodcastShareUrl,
  summarizeText,
  type ShareableEpisode,
  type ShareablePodcast
} from "./shareLinks";
import { shortenUrl } from "./urlShortener";

/** Shares a podcast as a web player link the recipient can open in a browser. */
export async function sharePodcast(podcast: ShareablePodcast): Promise<void> {
  const summary = summarizeText(podcast.description);
  const url = await shortenUrl(buildPodcastShareUrl(podcast, summary));
  await Share.share({
    title: podcast.title,
    message: buildPodcastShareMessage(podcast.title, summary, url)
  });
}

/** Shares an episode as a web player link that carries inline audio metadata. */
export async function shareEpisode(
  episode: ShareableEpisode,
  podcastTitle?: string
): Promise<void> {
  const summary = summarizeText(episode.description);
  const url = await shortenUrl(buildEpisodeShareUrl(episode, podcastTitle, summary));
  await Share.share({
    title: episode.title,
    message: buildEpisodeShareMessage(episode.title, podcastTitle ?? "", summary, url)
  });
}
