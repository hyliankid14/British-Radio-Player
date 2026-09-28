import { Preferences, SavedEpisodeEntry } from "../storage/preferences";
import { PodcastApi } from "../api/podcasts";
import { getNetworkStatus } from "../store/networkStore";
import { toSavedEpisodeEntry, useDownloadStore } from "./downloadStore";
import { AUTO_DOWNLOAD_LIMIT_PREF_KEY, isAutomaticDownload, normaliseAutoDownloadLimit } from "./downloadLimits";

let running = false;

function episodeEpoch(pubDate?: string): number {
  if (!pubDate) return 0;
  const parsed = Date.parse(pubDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function newestFirst<T extends { pubDate?: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => episodeEpoch(b.pubDate) - episodeEpoch(a.pubDate));
}

/**
 * Downloads the latest episodes of subscribed podcasts (and saved episodes) according to
 * the auto-download settings. Runs only while the app is open; the native worker handles
 * background downloads on Android.
 *
 * The per-podcast limit is a hard cap: automatic downloads already stored for a podcast
 * are counted up-front so this run only claims the headroom that is left, which is what
 * stops a podcast from accumulating more than the configured number of episodes.
 */
export async function runAutoDownload(): Promise<void> {
  if (running) return;

  const autoSubscribed = Boolean(Preferences.getSetting("pref_auto_download", false));
  const autoSaved = Boolean(Preferences.getSetting("pref_auto_download_saved", false));
  if (!autoSubscribed && !autoSaved) return;

  const limit = normaliseAutoDownloadLimit(Preferences.getSetting(AUTO_DOWNLOAD_LIMIT_PREF_KEY, 1));
  const wifiOnly = Boolean(Preferences.getSetting("pref_download_wifi", true));

  const network = getNetworkStatus();
  if (!network.isOnline) return;
  if (wifiOnly && !network.isWifi) return;

  running = true;
  try {
    const store = useDownloadStore.getState();
    const handled = new Set(Object.keys(store.downloads));

    // One parse of the download records, shared by every check below.
    const downloaded = Preferences.getDownloadedEntries();
    const isDownloaded = (episodeId: string) => {
      if (handled.has(episodeId)) return true;
      return !!downloaded[episodeId];
    };

    // Automatic downloads already on the device, per podcast. Reserved as we enqueue so
    // the same podcast cannot be handed the same headroom twice in one run.
    const reserved = new Map<string, number>();
    const reserve = (podcastId: string | undefined) => {
      if (!podcastId) return;
      reserved.set(podcastId, (reserved.get(podcastId) ?? 0) + 1);
    };
    for (const record of Object.values(downloaded)) {
      if (isAutomaticDownload(record)) reserve(record?.entry?.podcastId);
    }
    // Downloads started by an earlier run are still in flight, so they are not in the
    // stored records yet. Without this the next run would hand out the same slots again.
    for (const pending of Object.values(store.downloads)) {
      if (pending.status === "downloading") reserve(pending.entry.podcastId);
    }

    const enqueue = (entry: SavedEpisodeEntry, podcast?: { id: string; title: string; imageUrl?: string }) => {
      if (isDownloaded(entry.id)) return;
      const resolved: SavedEpisodeEntry = podcast
        ? { ...entry, podcastId: entry.podcastId || podcast.id, podcastTitle: entry.podcastTitle || podcast.title, imageUrl: entry.imageUrl || podcast.imageUrl || "" }
        : entry;
      const podcastId = resolved.podcastId;
      if (!podcastId) return;
      const used = reserved.get(podcastId) ?? 0;
      if (used >= limit) return;
      reserved.set(podcastId, used + 1);
      handled.add(entry.id);
      void store.download(resolved, { auto: true });
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
          // Already-downloaded episodes are filtered out before the slice, otherwise the
          // limit would be spent on files that are already on the device.
          const pending = episodes.filter((episode) => !isDownloaded(episode.id));
          for (const episode of newestFirst(pending).slice(0, limit)) {
            enqueue(toSavedEpisodeEntry(podcast, episode), podcast);
          }
        }
      }
    }

    if (autoSaved) {
      // Saved episodes span every podcast, so the per-podcast limit is applied within
      // each podcast rather than across the whole playlist.
      const byPodcast = new Map<string, SavedEpisodeEntry[]>();
      for (const entry of Preferences.getPodcastPlaylistEntries("saved")) {
        if (!entry.podcastId) continue;
        const group = byPodcast.get(entry.podcastId);
        if (group) group.push(entry);
        else byPodcast.set(entry.podcastId, [entry]);
      }
      for (const group of byPodcast.values()) {
        for (const entry of newestFirst(group).slice(0, limit)) {
          enqueue(entry);
        }
      }
    }
  } catch (error) {
    console.warn("Auto-download failed:", error);
  } finally {
    running = false;
  }
}
