import { create } from "zustand";
import { Directory, File, Paths } from "expo-file-system";
import { Podcast, Episode } from "../api/podcasts";
import { Preferences, SavedEpisodeEntry } from "../storage/preferences";

export type DownloadStatus = "downloading" | "downloaded" | "error";

export interface DownloadEntryState {
  status: DownloadStatus;
  entry: SavedEpisodeEntry;
  localUri?: string;
  progress?: number;
  error?: string;
}

interface DownloadStoreState {
  downloads: Record<string, DownloadEntryState>;
  download: (entry: SavedEpisodeEntry) => Promise<void>;
  remove: (episodeId: string) => void;
  refresh: () => void;
}

const DOWNLOAD_DIRECTORY = "podcast-downloads";

function downloadDirectory(): Directory {
  const directory = new Directory(Paths.document, DOWNLOAD_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

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

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  downloads: storedDownloads(),

  refresh: () => set({ downloads: storedDownloads() }),

  download: async (entry) => {
    if (!entry?.id || !entry.audioUrl) return;
    if (get().downloads[entry.id]?.status === "downloading") return;

    set((state) => ({
      downloads: {
        ...state.downloads,
        [entry.id]: { status: "downloading", entry, progress: 0 }
      }
    }));

    try {
      const destination = new File(downloadDirectory(), `${entry.id}${fileExtension(entry.audioUrl)}`);
      const file = await File.downloadFileAsync(entry.audioUrl, destination, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
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
        }
      });

      Preferences.setDownloadedEntry(entry.id, {
        localUri: file.uri,
        sizeBytes: file.size || undefined,
        downloadedAtMs: Date.now(),
        entry
      });
      // Mirror the episode into the built-in "Downloaded Files" playlist so counts match.
      Preferences.addPodcastPlaylistEntry("downloaded", entry);

      set((state) => ({
        downloads: {
          ...state.downloads,
          [entry.id]: { status: "downloaded", entry, localUri: file.uri, progress: 1 }
        }
      }));
    } catch (error) {
      set((state) => ({
        downloads: {
          ...state.downloads,
          [entry.id]: {
            status: "error",
            entry,
            error: error instanceof Error ? error.message : "Download failed"
          }
        }
      }));
    }
  },

  remove: (episodeId) => {
    const existing = get().downloads[episodeId];
    if (existing?.localUri) {
      try {
        const file = new File(existing.localUri);
        if (file.exists) file.delete();
      } catch {
        // The file may already be gone; the metadata removal below still applies.
      }
    }
    Preferences.removeDownloadedEntry(episodeId);
    Preferences.removePodcastPlaylistEntry("downloaded", episodeId);
    set((state) => {
      const downloads = { ...state.downloads };
      delete downloads[episodeId];
      return { downloads };
    });
  }
}));

/** Returns a playable local URI for a downloaded episode, or undefined when absent. */
export function getDownloadedUri(episodeId: string): string | undefined {
  const state = useDownloadStore.getState().downloads[episodeId];
  if (state?.status !== "downloaded" || !state.localUri) return undefined;
  try {
    if (!new File(state.localUri).exists) return undefined;
  } catch {
    return undefined;
  }
  return state.localUri;
}
