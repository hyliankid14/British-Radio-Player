import { create } from "zustand";
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { Podcast, Episode, PodcastApi } from "../api/podcasts";
import { Preferences, SavedEpisodeEntry } from "../storage/preferences";
import { NativeAndroid } from "../native/nativeAndroid";
import { notifyDownloadFinished, notifyDownloadStarted } from "../notifications/downloadNotifications";
import { normalizeBbcAudioUrl } from "../utils/shareLinks";
import {
  AUTO_DOWNLOAD_LIMIT_PREF_KEY,
  MAX_DOWNLOADS_PREF_KEY,
  buildDownloadDisplayName,
  normaliseMaxDownloads,
  normalizeEpisodeId,
  pickDownloadsToRemove,
  pickPerPodcastDownloadsToRemove,
  sanitizeFileName
} from "./downloadLimits";

export type DownloadStatus = "downloading" | "downloaded" | "error";

export interface DownloadEntryState {
  status: DownloadStatus;
  entry: SavedEpisodeEntry;
  localUri?: string;
  progress?: number;
  error?: string;
}

export interface DownloadOptions {
  /** Set by the auto-download run; these are the only files the per-podcast cap prunes. */
  auto?: boolean;
}

interface DownloadStoreState {
  downloads: Record<string, DownloadEntryState>;
  download: (entry: SavedEpisodeEntry, options?: DownloadOptions) => Promise<void>;
  remove: (episodeId: string) => void;
  removeAll: () => number;
  refresh: () => void;
}

const DOWNLOAD_DIRECTORY = "podcast-downloads";

/**
 * The episode whose local file is currently streaming. Housekeeping must never
 * remove it, otherwise playback would stop mid-stream.
 */
let inUseEpisodeId: string | null = null;

/** Declares which episode's download is currently being played, or null when idle. */
export function setDownloadInUseEpisode(episodeId: string | null): void {
  inUseEpisodeId = episodeId || null;
}

/** The episode currently streaming from a local file, if any. */
export function getDownloadInUseEpisode(): string | null {
  return inUseEpisodeId;
}

/** Temp directory used while a file is being fetched (both platforms). */
function cacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, DOWNLOAD_DIRECTORY);
  try {
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
  } catch {
    // Directory may already exist.
  }
  return directory;
}

/** On iOS downloads live in the app Documents folder, exposed via Files app file sharing. */
function documentsDirectory(): Directory {
  const directory = new Directory(Paths.document, DOWNLOAD_DIRECTORY);
  try {
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
  } catch {
    // Directory may already exist.
  }
  return directory;
}

/**
 * User-Agent sent with every episode download request. BBC's media selector (the gateway
 * used by all `ppg:enclosureSecure` and `enclosure` URLs in BBC podcast RSS feeds) can
 * return HTTP 403 when it sees an unrecognised agent such as the default `okhttp/4.x.x`
 * produced by expo-file-system. The v1 native app set this header explicitly; we mirror
 * that behaviour here.
 */
const DOWNLOAD_USER_AGENT = "British Radio Player/2.0 (Android)";

function fileExtension(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const match = clean.match(/\.(mp3|m4a|m4b|aac|mp4|ogg|oga|opus)$/i);
  return match ? match[0].toLowerCase() : ".mp3";
}

function storedDownloads(): Record<string, DownloadEntryState> {
  const downloads: Record<string, DownloadEntryState> = {};
  for (const [id, record] of Object.entries(Preferences.getDownloadedEntries())) {
    if (!record?.localUri) continue;
    const normId = normalizeEpisodeId(id) || id;
    const entry = record.entry ? { ...record.entry, id: normId } : record.entry;
    downloads[normId] = {
      status: "downloaded",
      entry,
      localUri: record.localUri
    };
  }
  return downloads;
}

function deleteFileQuietly(uri?: string): void {
  if (!uri || uri.startsWith("content://")) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The file may already be gone.
  }
}

/** Builds the metadata persisted for an episode, shared by Save and Download actions. */
export function toSavedEpisodeEntry(podcast: Podcast, episode: Episode): SavedEpisodeEntry {
  return {
    id: episode.id,
    title: episode.title,
    description: episode.description,
    imageUrl: episode.imageUrl || podcast.imageUrl,
    audioUrl: episode.audioUrl,
    pubDate: episode.pubDate,
    durationMins: episode.durationMins,
    podcastId: podcast.id,
    podcastTitle: podcast.title
  };
}

/**
 * Deletes the oldest downloads until the global "Maximum downloaded episodes"
 * setting is satisfied. The episode currently streaming is never touched; the
 * next-oldest episode is taken in its place so the cap is still met.
 * Returns the number of downloads removed.
 */
export function enforceMaxDownloads(remove: (episodeId: string) => void): number {
  const max = normaliseMaxDownloads(Preferences.getSetting(MAX_DOWNLOADS_PREF_KEY, 0));
  if (max === 0) return 0;
  const protectedIds = inUseEpisodeId ? [inUseEpisodeId] : [];
  const victims = pickDownloadsToRemove(Preferences.getDownloadedEntries(), max, protectedIds);
  for (const id of victims) remove(id);
  return victims.length;
}

/**
 * Enforces the per-podcast "Download limit per podcast" setting by deleting the
 * oldest automatic downloads of any podcast that has drifted over its cap.
 * Manually requested downloads are never removed. Returns the number deleted.
 *
 * Skipped entirely while automatic downloading is switched off, so a user who has
 * turned it off does not silently lose files to a setting they can no longer see.
 */
export function enforcePerPodcastDownloadLimit(remove: (episodeId: string) => void): number {
  const autoSubscribed = Boolean(Preferences.getSetting("pref_auto_download", false));
  const autoSaved = Boolean(Preferences.getSetting("pref_auto_download_saved", false));
  if (!autoSubscribed && !autoSaved) return 0;

  const limit = Preferences.getSetting(AUTO_DOWNLOAD_LIMIT_PREF_KEY, 1);
  const protectedIds = inUseEpisodeId ? [inUseEpisodeId] : [];
  const victims = pickPerPodcastDownloadsToRemove(Preferences.getDownloadedEntries(), limit, protectedIds);
  for (const id of victims) remove(id);
  return victims.length;
}

async function refreshEpisodeAudioUrl(
  podcastId: string | undefined,
  episodeId: string,
  episodeTitle?: string
): Promise<string | null> {
  if (!podcastId && !episodeId) return null;
  try {
    let pId = podcastId;
    let rssUrl: string | null = null;
    if (pId) {
      const catalog = await PodcastApi.fetchLiveCatalog();
      const p = catalog.find((item) => item.id === pId);
      if (p) rssUrl = p.rssUrl;
    }
    if (!rssUrl && pId) {
      rssUrl = `https://podcasts.files.bbci.co.uk/${pId}.rss`;
    }
    if (!rssUrl) return null;

    const episodes = await PodcastApi.fetchEpisodes(rssUrl, pId || "", true);
    const norm = normalizeEpisodeId(episodeId);
    const titleNorm = episodeTitle?.trim().toLowerCase();
    const matched = episodes.find(
      (e) =>
        (norm && normalizeEpisodeId(e.id) === norm) ||
        (titleNorm && e.title.trim().toLowerCase() === titleNorm)
    );
    return matched?.audioUrl || null;
  } catch (err) {
    console.warn("[Download] Failed to refresh audio URL from feed:", err);
    return null;
  }
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  downloads: storedDownloads(),

  refresh: () => set({ downloads: storedDownloads() }),

  download: async (entry, options) => {
    if (!entry?.id || !entry.audioUrl) return;
    const normId = normalizeEpisodeId(entry.id) || entry.id;
    const activeDownload = get().downloads[normId] || get().downloads[entry.id];
    if (activeDownload?.status === "downloading") return;

    notifyDownloadStarted(options?.auto === true, {
      title: entry.title,
      podcastTitle: entry.podcastTitle,
      podcastId: entry.podcastId,
      episodeId: normId
    });

    const normalizedEntry = { ...entry, id: normId };

    set((state) => ({
      downloads: {
        ...state.downloads,
        [normId]: { status: "downloading", entry: normalizedEntry, progress: 0 }
      }
    }));

    let lastProgressTime = 0;
    const minProgressIntervalMs = options?.auto ? 500 : 100;

    const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
      if (totalBytes <= 0) return;
      const progress = Math.min(1, bytesWritten / totalBytes);
      const now = Date.now();
      if (progress < 1 && now - lastProgressTime < minProgressIntervalMs) return;
      lastProgressTime = now;

      set((state) => {
        const current = state.downloads[normId];
        if (!current || current.status !== "downloading") return state;
        if (progress < 1 && Math.abs((current.progress ?? 0) - progress) < 0.02) return state;
        return {
          downloads: {
            ...state.downloads,
            [normId]: { ...current, progress }
          }
        };
      });
    };

    try {
      let targetUrl = normalizeBbcAudioUrl(entry.audioUrl) || entry.audioUrl;
      let extension = fileExtension(targetUrl);
      const safeId = sanitizeFileName(normId);
      let tempName = `${safeId}${extension}`;
      let localUri: string;

      if (Platform.OS === "android") {
        // Fetch to a temp file, then publish it into the public Podcasts folder so it is
        // visible to (and removable by) the user via the device file manager.
        const temp = new File(cacheDirectory(), tempName);
        deleteFileQuietly(temp.uri);
        let downloaded: File;
        try {
          downloaded = await File.downloadFileAsync(targetUrl, temp, {
            idempotent: true,
            onProgress,
            headers: { "User-Agent": DOWNLOAD_USER_AGENT }
          });
        } catch (downloadErr) {
          console.warn(`[Download] Primary download attempt failed for "${entry.title}", refreshing audio URL:`, downloadErr);
          const freshUrl = await refreshEpisodeAudioUrl(entry.podcastId, normId, entry.title);
          if (freshUrl && freshUrl !== entry.audioUrl) {
            targetUrl = normalizeBbcAudioUrl(freshUrl) || freshUrl;
            extension = fileExtension(targetUrl);
            tempName = `${safeId}${extension}`;
            normalizedEntry.audioUrl = freshUrl;
            if (Preferences.isEpisodeSaved(normId)) {
              Preferences.addPodcastPlaylistEntry("saved", normalizedEntry);
            }
            deleteFileQuietly(temp.uri);
            downloaded = await File.downloadFileAsync(targetUrl, temp, {
              idempotent: true,
              onProgress,
              headers: { "User-Agent": DOWNLOAD_USER_AGENT }
            });
          } else {
            throw downloadErr;
          }
        }
        const displayName = buildDownloadDisplayName(entry.title, normId, extension);
        let published: string | null = null;
        try {
          published = await NativeAndroid.publishDownload(downloaded.uri, displayName, entry.title);
        } catch (pubErr) {
          console.warn("[Download] Failed to publish to MediaStore:", pubErr);
        }

        if (published) {
          deleteFileQuietly(downloaded.uri);
          localUri = published;
        } else {
          // If publishing to public MediaStore fails (e.g. storage permission, OEM MediaStore quirk,
          // or un-recompiled native module), fall back to saving in app-internal documents directory
          // so the file is not discarded and offline playback still works seamlessly.
          console.warn("[Download] MediaStore publish failed, falling back to internal storage for:", normId);
          const internalDest = new File(documentsDirectory(), tempName);
          try {
            deleteFileQuietly(internalDest.uri);
            downloaded.moveSync(internalDest, { overwrite: true });
            localUri = internalDest.uri;
          } catch (moveErr) {
            console.warn("[Download] moveSync fallback failed, trying copySync:", moveErr);
            deleteFileQuietly(internalDest.uri);
            downloaded.copySync(internalDest, { overwrite: true });
            deleteFileQuietly(downloaded.uri);
            localUri = internalDest.uri;
          }
        }
      } else {
        const destination = new File(documentsDirectory(), tempName);
        deleteFileQuietly(destination.uri);
        let file: File;
        try {
          file = await File.downloadFileAsync(targetUrl, destination, {
            idempotent: true,
            onProgress,
            headers: { "User-Agent": DOWNLOAD_USER_AGENT }
          });
        } catch (downloadErr) {
          console.warn(`[Download] Primary download attempt failed for "${entry.title}", refreshing audio URL:`, downloadErr);
          const freshUrl = await refreshEpisodeAudioUrl(entry.podcastId, normId, entry.title);
          if (freshUrl && freshUrl !== entry.audioUrl) {
            targetUrl = normalizeBbcAudioUrl(freshUrl) || freshUrl;
            extension = fileExtension(targetUrl);
            tempName = `${safeId}${extension}`;
            normalizedEntry.audioUrl = freshUrl;
            if (Preferences.isEpisodeSaved(normId)) {
              Preferences.addPodcastPlaylistEntry("saved", normalizedEntry);
            }
            deleteFileQuietly(destination.uri);
            file = await File.downloadFileAsync(targetUrl, destination, {
              idempotent: true,
              onProgress,
              headers: { "User-Agent": DOWNLOAD_USER_AGENT }
            });
          } else {
            throw downloadErr;
          }
        }
        localUri = file.uri;
      }

      Preferences.setDownloadedEntry(normId, {
        localUri,
        downloadedAtMs: Date.now(),
        isAutoDownloaded: options?.auto === true,
        entry: normalizedEntry
      });
      // Mirror the episode into the built-in "Downloaded Files" playlist so counts match.
      Preferences.addPodcastPlaylistEntry("downloaded", normalizedEntry);
      Preferences.clearFailedAutoDownload(normId);

      set((state) => {
        const next = { ...state.downloads };
        if (entry.id !== normId) delete next[entry.id];
        next[normId] = { status: "downloaded", entry: normalizedEntry, localUri, progress: 1 };
        return { downloads: next };
      });

      // Make room straight away so the caps are honoured even before the next
      // app start; the newest downloads are the ones kept.
      const removeOne = (id: string) => get().remove(id);
      enforcePerPodcastDownloadLimit(removeOne);
      enforceMaxDownloads(removeOne);
      notifyDownloadFinished(true, {
        title: entry.title,
        podcastTitle: entry.podcastTitle,
        podcastId: entry.podcastId,
        episodeId: normId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      console.error(
        `[Download] Failed — "${entry.title}" (${normId}): ${message}\n  url: ${entry.audioUrl}`
      );
      if (options?.auto) {
        Preferences.recordFailedAutoDownload(normId);
      }
      set((state) => {
        const next = { ...state.downloads };
        if (entry.id !== normId) delete next[entry.id];
        next[normId] = {
          status: "error",
          entry: normalizedEntry,
          error: message
        };
        return { downloads: next };
      });
      notifyDownloadFinished(false, {
        title: entry.title,
        podcastTitle: entry.podcastTitle,
        podcastId: entry.podcastId,
        episodeId: normId
      });
    }
  },

  remove: (episodeId) => {
    const normId = normalizeEpisodeId(episodeId) || episodeId;
    const existing = get().downloads[normId] || get().downloads[episodeId];
    if (existing?.localUri) {
      if (existing.localUri.startsWith("content://")) {
        NativeAndroid.deleteDownload(existing.localUri);
      } else {
        deleteFileQuietly(existing.localUri);
      }
    }
    deleteFileQuietly(Preferences.getDownloadedEntry(normId)?.localUri);
    deleteFileQuietly(Preferences.getDownloadedEntry(episodeId)?.localUri);
    Preferences.removeDownloadedEntry(episodeId);
    Preferences.removeDownloadedEntry(normId);
    Preferences.removePodcastPlaylistEntry("downloaded", episodeId);
    Preferences.removePodcastPlaylistEntry("downloaded", normId);
    set((state) => {
      const downloads = { ...state.downloads };
      delete downloads[episodeId];
      delete downloads[normId];
      return { downloads };
    });
  },

  /** Deletes every downloaded episode and clears the download records. Returns the count. */
  removeAll: () => {
    const count = Object.keys(get().downloads).length;

    if (Platform.OS === "android") {
      NativeAndroid.clearDownloads();
    }

    // Sweep the storage folders directly so orphaned files are removed too.
    const sweep = (directory: Directory) => {
      try {
        if (!directory.exists) return;
        for (const item of directory.list()) {
          try {
            item.delete();
          } catch {
            // Skip entries that cannot be removed.
          }
        }
      } catch {
        // Ignore folders that cannot be listed.
      }
    };
    try {
      sweep(new Directory(Paths.cache, DOWNLOAD_DIRECTORY));
    } catch {
      // Ignore.
    }
    try {
      sweep(new Directory(Paths.document, DOWNLOAD_DIRECTORY));
    } catch {
      // Ignore.
    }

    Preferences.clearDownloadedEntries();
    Preferences.clearPodcastPlaylistEntries("downloaded");
    set({ downloads: {} });
    return count;
  }
}));

/** Returns a playable local URI for a downloaded episode, or undefined when absent. */
export function getDownloadedUri(episodeId: string): string | undefined {
  const state = useDownloadStore.getState().downloads[episodeId];
  if (state?.status !== "downloaded" || !state.localUri) return undefined;
  if (state.localUri.startsWith("content://")) return state.localUri;
  try {
    if (!new File(state.localUri).exists) return undefined;
  } catch {
    return undefined;
  }
  return state.localUri;
}
