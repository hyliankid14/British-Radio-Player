import { create } from "zustand";
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { Podcast, Episode } from "../api/podcasts";
import { Preferences, SavedEpisodeEntry } from "../storage/preferences";
import { NativeAndroid } from "../native/nativeAndroid";
import { notifyDownloadFinished, notifyDownloadStarted } from "../notifications/downloadNotifications";
import {
  AUTO_DOWNLOAD_LIMIT_PREF_KEY,
  MAX_DOWNLOADS_PREF_KEY,
  normaliseMaxDownloads,
  pickDownloadsToRemove,
  pickPerPodcastDownloadsToRemove
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
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

/** On iOS downloads live in the app Documents folder, exposed via Files app file sharing. */
function documentsDirectory(): Directory {
  const directory = new Directory(Paths.document, DOWNLOAD_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
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
    downloads[id] = {
      status: "downloaded",
      entry: record.entry,
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

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  downloads: storedDownloads(),

  refresh: () => set({ downloads: storedDownloads() }),

  download: async (entry, options) => {
    if (!entry?.id || !entry.audioUrl) return;
    if (get().downloads[entry.id]?.status === "downloading") return;

    notifyDownloadStarted(options?.auto === true, entry.title);

    set((state) => ({
      downloads: {
        ...state.downloads,
        [entry.id]: { status: "downloading", entry, progress: 0 }
      }
    }));

    const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
      if (totalBytes <= 0) return;
      const progress = Math.min(1, bytesWritten / totalBytes);
      set((state) => {
        const current = state.downloads[entry.id];
        if (!current || current.status !== "downloading") return state;
        if (Math.abs((current.progress ?? 0) - progress) < 0.02) return state;
        return {
          downloads: {
            ...state.downloads,
            [entry.id]: { ...current, progress }
          }
        };
      });
    };

    try {
      const extension = fileExtension(entry.audioUrl);
      const tempName = `${entry.id}${extension}`;
      let localUri: string;

      if (Platform.OS === "android") {
        // Fetch to a temp file, then publish it into the public Podcasts folder so it is
        // visible to (and removable by) the user via the device file manager.
        const temp = new File(cacheDirectory(), tempName);
        if (temp.exists) temp.delete();
        const downloaded = await File.downloadFileAsync(entry.audioUrl, temp, {
          idempotent: true,
          onProgress,
          headers: { "User-Agent": DOWNLOAD_USER_AGENT }
        });
        const displayName = `${entry.title || entry.id} - ${entry.id}${extension}`;
        const published = await NativeAndroid.publishDownload(downloaded.uri, displayName, entry.title);
        deleteFileQuietly(downloaded.uri);
        if (!published) throw new Error("Could not save to the Podcasts folder");
        localUri = published;
      } else {
        const destination = new File(documentsDirectory(), tempName);
        const file = await File.downloadFileAsync(entry.audioUrl, destination, {
          idempotent: true,
          onProgress,
          headers: { "User-Agent": DOWNLOAD_USER_AGENT }
        });
        localUri = file.uri;
      }

      Preferences.setDownloadedEntry(entry.id, {
        localUri,
        downloadedAtMs: Date.now(),
        isAutoDownloaded: options?.auto === true,
        entry
      });
      // Mirror the episode into the built-in "Downloaded Files" playlist so counts match.
      Preferences.addPodcastPlaylistEntry("downloaded", entry);

      set((state) => ({
        downloads: {
          ...state.downloads,
          [entry.id]: { status: "downloaded", entry, localUri, progress: 1 }
        }
      }));

      // Make room straight away so the caps are honoured even before the next
      // app start; the newest downloads are the ones kept.
      const removeOne = (id: string) => get().remove(id);
      enforcePerPodcastDownloadLimit(removeOne);
      enforceMaxDownloads(removeOne);
      notifyDownloadFinished(true, entry.title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      console.error(
        `[Download] Failed — "${entry.title}" (${entry.id}): ${message}\n  url: ${entry.audioUrl}`
      );
      set((state) => ({
        downloads: {
          ...state.downloads,
          [entry.id]: {
            status: "error",
            entry,
            error: message
          }
        }
      }));
      notifyDownloadFinished(false, entry.title);
    }
  },

  remove: (episodeId) => {
    const existing = get().downloads[episodeId];
    if (existing?.localUri) {
      if (existing.localUri.startsWith("content://")) {
        NativeAndroid.deleteDownload(existing.localUri);
      } else {
        deleteFileQuietly(existing.localUri);
      }
    }
    deleteFileQuietly(Preferences.getDownloadedEntry(episodeId)?.localUri);
    Preferences.removeDownloadedEntry(episodeId);
    Preferences.removePodcastPlaylistEntry("downloaded", episodeId);
    set((state) => {
      const downloads = { ...state.downloads };
      delete downloads[episodeId];
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
