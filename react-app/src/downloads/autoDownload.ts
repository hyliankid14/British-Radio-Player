import { Preferences, SavedEpisodeEntry } from "../storage/preferences";
import { PodcastApi } from "../api/podcasts";
import { getNetworkStatus } from "../store/networkStore";
import { toSavedEpisodeEntry, useDownloadStore } from "./downloadStore";

let running = false;

function episodeEpoch(pubDate?: string): number {
  if (!pubDate) return 0;
  const parsed = Date.parse(pubDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Downloads the latest episodes of subscribed podcasts (and saved episodes) according to
 * the auto-download settings. Runs only while the app is open; the native worker handles
 * background downloads on Android.
 */
export async function runAutoDownload(): Promise<void> {
  if (running) return;

  const autoSubscribed = Boolean(Preferences.getSetting("pref_auto_download", false));
  const autoSaved = Boolean(Preferences.getSetting("pref_auto_download_saved", false));
  if (!autoSubscribed && !autoSaved) return;

  const limit = Math.max(1, Number(Preferences.getSetting("pref_auto_download_limit", 1)) || 1);
  const wifiOnly = Boolean(Preferences.getSetting("pref_download_wifi", true));

  const network = getNetworkStatus();
  if (!network.isOnline) return;
  if (wifiOnly && !network.isWifi) return;

  running = true;
  try {
    const store = useDownloadStore.getState();
    const handled = new Set(Object.keys(store.downloads));

    const enqueue = (entry: SavedEpisodeEntry, podcast?: { id: string; title: string; imageUrl?: string }) => {
      if (handled.has(entry.id)) return;
      if (Preferences.isEpisodeDownloaded(entry.id)) return;
      handled.add(entry.id);
      const resolved: SavedEpisodeEntry = podcast
        ? { ...entry, podcastId: entry.podcastId || podcast.id, podcastTitle: entry.podcastTitle || podcast.title, imageUrl: entry.imageUrl || podcast.imageUrl || "" }
        : entry;
      void store.download(resolved);
    };

    if (autoSubscribed) {
      const subscribedIds = Preferences.getSubscribedPodcasts();
      if (subscribedIds.length > 0) {
        const catalog = await PodcastApi.fetchLiveCatalog();
        for (const id of subscribedIds) {
          const podcast = catalog.find((item) => item.id === id);
          if (!podcast) continue;
          let episodes = PodcastApi.getEpisodesFromCache(id);
          if (!episodes || episodes.length === 0) {
            try {
              episodes = await PodcastApi.fetchEpisodes(podcast.rssUrl, podcast.id);
            } catch {
              continue;
            }
          }
          const latest = [...episodes]
            .sort((a, b) => episodeEpoch(b.pubDate) - episodeEpoch(a.pubDate))
            .slice(0, limit);
          for (const episode of latest) {
            enqueue(toSavedEpisodeEntry(podcast, episode), podcast);
          }
        }
      }
    }

    if (autoSaved) {
      const saved = Preferences.getPodcastPlaylistEntries("saved");
      const newest = [...saved]
        .sort((a, b) => episodeEpoch(b.pubDate) - episodeEpoch(a.pubDate))
        .slice(0, limit);
      for (const entry of newest) enqueue(entry);
    }
  } catch (error) {
    console.warn("Auto-download failed:", error);
  } finally {
    running = false;
  }
}
