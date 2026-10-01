import { Preferences, SavedEpisodeEntry } from "../storage/preferences";
import { PodcastApi } from "../api/podcasts";
import { getNetworkStatus } from "../store/networkStore";
import { toSavedEpisodeEntry, useDownloadStore, getDownloadInUseEpisode } from "./downloadStore";
import {
  AUTO_DOWNLOAD_LIMIT_PREF_KEY,
  isAutomaticDownload,
  newestEpisodeIds,
  normaliseAutoDownloadLimit,
  normalizeEpisodeId,
  pickStaleAutomaticDownloads,
  sortEpisodesNewestFirst
} from "./downloadLimits";

let running = false;

/**
 * Downloads the latest episodes of subscribed podcasts (and saved episodes) according to
 * the auto-download settings. Runs only while the app is open; the native worker handles
 * background downloads on Android.
 *
 * The per-podcast limit is a rolling window: the newest `limit` episodes are kept, and
 * automatic downloads that fall out of that window are removed. The window is chosen
 * from every episode of the podcast, including the ones already on the device, so an
 * episode that is already downloaded still occupies its slot rather than being skipped
 * in favour of an older back-catalogue episode.
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
    const isDownloaded = (episodeId: string, candidate?: SavedEpisodeEntry) => {
      const norm = normalizeEpisodeId(episodeId) || episodeId;
      if (handled.has(episodeId) || handled.has(norm)) return true;
      if (downloaded[episodeId] || downloaded[norm]) return true;
      for (const [recId, rec] of Object.entries(downloaded)) {
        if (!rec) continue;
        if (recId === episodeId || recId === norm || normalizeEpisodeId(recId) === norm) return true;
        if (rec.entry?.id && (rec.entry.id === episodeId || normalizeEpisodeId(rec.entry.id) === norm)) return true;
        if (
          candidate &&
          rec.entry?.podcastId &&
          candidate.podcastId &&
          rec.entry.podcastId === candidate.podcastId &&
          rec.entry.title &&
          candidate.title &&
          rec.entry.title.trim().toLowerCase() === candidate.title.trim().toLowerCase()
        ) {
          return true;
        }
      }
      return false;
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
      const normId = normalizeEpisodeId(entry.id) || entry.id;
      if (isDownloaded(normId, entry)) return;
      if (Preferences.isAutoDownloadBlocked(normId)) return;
      const resolved: SavedEpisodeEntry = podcast
        ? {
            ...entry,
            id: normId,
            podcastId: entry.podcastId || podcast.id,
            podcastTitle: entry.podcastTitle || podcast.title,
            imageUrl: entry.imageUrl || podcast.imageUrl || ""
          }
        : { ...entry, id: normId };
      const podcastId = resolved.podcastId;
      if (!podcastId || !resolved.audioUrl) return;
      const used = reserved.get(podcastId) ?? 0;
      if (used >= limit) return;
      reserved.set(podcastId, used + 1);
      handled.add(normId);
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
          if (episodes.length === 0) continue;

          // The rolling window is the newest `limit` episodes, selected over the whole
          // list so an episode already on the device still holds its slot. Filtering the
          // downloaded episodes out first and then slicing would instead pick
          // back-catalogue episodes and evict newer downloads of an existing podcast.
          const windowIds = newestEpisodeIds(episodes, limit);
          const byId = new Map(episodes.map((episode) => [episode.id, episode]));

          // Automatic downloads that have fallen out of the window are no longer part of
          // the rolling window, so remove them (never manual downloads, and never the
          // episode currently streaming).
          const allRecords = Preferences.getDownloadedEntries();
          const inUse = getDownloadInUseEpisode();
          const stale = pickStaleAutomaticDownloads(allRecords, id, windowIds, inUse ? [inUse] : []);
          for (const episodeId of stale) {
            store.remove(episodeId);
            reserved.set(id, Math.max(0, (reserved.get(id) ?? 0) - 1));
          }

          for (const episodeId of windowIds) {
            const episode = byId.get(episodeId);
            if (!episode) continue;
            const entry = toSavedEpisodeEntry(podcast, episode);
            if (isDownloaded(episodeId, entry)) continue;
            enqueue(entry, podcast);
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
      for (const [podcastId, group] of byPodcast.entries()) {
        for (const entry of sortEpisodesNewestFirst(group).slice(0, limit)) {
          const normId = normalizeEpisodeId(entry.id) || entry.id;
          if (isDownloaded(normId, entry)) continue;
          if (Preferences.isAutoDownloadBlocked(normId)) continue;
          let entryToDownload = entry;
          if (!entryToDownload.audioUrl) {
            let episodes = PodcastApi.getEpisodesFromCache(podcastId);
            if (!episodes || episodes.length === 0) {
              const catalog = await PodcastApi.fetchLiveCatalog();
              const p = catalog.find((item) => item.id === podcastId);
              if (p) {
                try {
                  episodes = await PodcastApi.fetchEpisodes(p.rssUrl, p.id);
                } catch {}
              }
            }
            if (episodes && episodes.length > 0) {
              const normId = normalizeEpisodeId(entry.id);
              const matched = episodes.find(
                (e) =>
                  normalizeEpisodeId(e.id) === normId ||
                  e.title.trim().toLowerCase() === entry.title.trim().toLowerCase()
              );
              if (matched && matched.audioUrl) {
                entryToDownload = {
                  ...entry,
                  id: normId || entry.id,
                  audioUrl: matched.audioUrl
                };
                Preferences.addPodcastPlaylistEntry("saved", entryToDownload);
              }
            }
          }
          if (entryToDownload.audioUrl) {
            enqueue(entryToDownload);
          }
        }
      }
    }
  } catch (error) {
    console.warn("Auto-download failed:", error);
  } finally {
    running = false;
  }
}
