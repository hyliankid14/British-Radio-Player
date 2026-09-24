import { AppState, AppStateStatus } from "react-native";
import { PodcastApi } from "../api/podcasts";
import { StationRepository } from "../data/stations";
import { Preferences } from "../storage/preferences";
import { usePlayerStore } from "../store/playerStore";
import { AutoBridge, AutoNativeEvent } from "./autoBridge";
import { buildAutoSnapshot } from "./autoSnapshot";

const SYNC_DEBOUNCE_MS = 400;
const PROGRESS_SYNC_MIN_INTERVAL_MS = 30_000;
const EPISODE_PREFETCH_CONCURRENCY = 3;
const MAX_PREFETCH_PODCASTS = 40;

/** Keys written very frequently during playback; syncing on each write is wasteful. */
const HIGH_FREQUENCY_KEYS = new Set(["pref_episode_progress"]);

let initialised = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let changeSubscription: { remove: () => void } | null = null;
let eventSubscription: { remove: () => void } | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let syncing = false;
let syncQueued = false;
let prefetchRunning = false;
let lastProgressSyncAtMs = 0;

/** Pushes the current React state to the native Android Auto service. */
export async function syncAutoState(includePodcastData = true): Promise<void> {
  if (!AutoBridge.isAvailable()) return;
  if (syncing) {
    syncQueued = true;
    return;
  }
  syncing = true;
  try {
    const snapshot = await buildAutoSnapshot(includePodcastData);
    // Lets the native service avoid auto-resuming while the phone is already playing.
    snapshot.phonePlaybackActive = usePlayerStore.getState().isPlaying;
    AutoBridge.syncState(JSON.stringify(snapshot));
  } catch (error) {
    console.warn("Android Auto sync failed:", error);
  } finally {
    syncing = false;
    if (syncQueued) {
      syncQueued = false;
      void syncAutoState(includePodcastData);
    }
  }
}

function scheduleSync(changedKey?: string): void {
  if (!AutoBridge.isAvailable()) return;
  if (changedKey && HIGH_FREQUENCY_KEYS.has(changedKey)) {
    const now = Date.now();
    if (now - lastProgressSyncAtMs < PROGRESS_SYNC_MIN_INTERVAL_MS) return;
    lastProgressSyncAtMs = now;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncAutoState();
  }, SYNC_DEBOUNCE_MS);
}

function parsePayload(event: AutoNativeEvent): Record<string, any> {
  try {
    const parsed = JSON.parse(event.payload || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function handleNativeEvent(event: AutoNativeEvent): void {
  const payload = parsePayload(event);
  switch (event.type) {
    case "favoriteToggled": {
      const stationId = String(payload.stationId || "");
      if (!stationId) break;
      const favorites = Preferences.getFavorites();
      const isFavorite = favorites.includes(stationId);
      if (payload.favorite && !isFavorite) {
        Preferences.setFavorites([...favorites, stationId]);
      } else if (!payload.favorite && isFavorite) {
        Preferences.setFavorites(favorites.filter((id) => id !== stationId));
      }
      usePlayerStore.setState({ favorites: Preferences.getFavorites() });
      break;
    }

    case "subscribeToggled": {
      const podcastId = String(payload.podcastId || "");
      if (!podcastId) break;
      const subscribed = Preferences.getSubscribedPodcasts();
      const isSubscribed = subscribed.includes(podcastId);
      if (payload.subscribed && !isSubscribed) {
        Preferences.setSubscribedPodcasts([...subscribed, podcastId]);
      } else if (!payload.subscribed && isSubscribed) {
        Preferences.setSubscribedPodcasts(subscribed.filter((id) => id !== podcastId));
      }
      break;
    }

    case "savedToggled": {
      // Save/unsave performed from the car's now-playing screen.
      const entry = payload.entry as Record<string, any> | undefined;
      const episodeId = String(entry?.id || payload.episodeId || "");
      if (!episodeId) break;
      if (payload.saved === true && entry) {
        Preferences.addPodcastPlaylistEntry("saved", {
          id: episodeId,
          title: String(entry.title || ""),
          description: String(entry.description || ""),
          imageUrl: String(entry.imageUrl || entry.podcastImageUrl || ""),
          audioUrl: String(entry.audioUrl || ""),
          pubDate: String(entry.pubDate || ""),
          durationMins: Number(entry.durationMins || 0),
          podcastId: String(entry.podcastId || ""),
          podcastTitle: String(entry.podcastTitle || "")
        });
      } else {
        Preferences.removePodcastPlaylistEntry("saved", episodeId);
      }
      break;
    }

    case "episodePlayed": {      const episodeId = String(payload.episodeId || "");
      if (!episodeId) break;
      Preferences.markEpisodePlayed(
        episodeId,
        payload.podcastId ? String(payload.podcastId) : undefined,
        typeof payload.pubDateEpochMs === "number" && payload.pubDateEpochMs > 0
          ? payload.pubDateEpochMs
          : undefined
      );
      break;
    }

    case "episodeProgress": {
      const episodeId = String(payload.episodeId || "");
      const positionMs = Number(payload.positionMs || 0);
      if (episodeId && positionMs > 0) {
        Preferences.setEpisodeProgress(episodeId, positionMs / 1000);
      }
      break;
    }

    case "playbackStarted": {
      // The car has taken over playback: stop the phone player so audio does not overlap.
      const state = usePlayerStore.getState();
      const stationId = String(payload.id || "");
      const station =
        payload.kind === "station" && stationId ? StationRepository.getById(stationId) : undefined;
      void state.stop().then(() => {
        if (station) {
          usePlayerStore.setState({ currentStation: station, isPlaying: false, isBuffering: false });
        }
      });
      break;
    }

    case "playbackStopped":
    case "playbackError":
      break;

    default:
      break;
  }
}

/** Fetches episode feeds for subscribed podcasts so Auto can browse them offline. */
async function prefetchSubscribedEpisodes(): Promise<void> {
  if (prefetchRunning) return;
  prefetchRunning = true;
  try {
    const catalog = await PodcastApi.fetchLiveCatalog().catch(() => []);
    const byId = new Map(catalog.map((podcast) => [podcast.id, podcast]));
    const subscribed = Preferences.getSubscribedPodcasts().slice(0, MAX_PREFETCH_PODCASTS);
    const missing = subscribed.filter((id) => {
      const cached = PodcastApi.getEpisodesFromCache(id);
      const meta = Preferences.getPodcastMetadata(id);
      const catalogPod = byId.get(id);
      const hasTitle = (catalogPod?.title && catalogPod.title !== id) || (meta?.title && meta.title !== id);
      return !cached || cached.length === 0 || !hasTitle;
    });
    if (!missing.length) return;

    for (let i = 0; i < missing.length; i += EPISODE_PREFETCH_CONCURRENCY) {
      const batch = missing.slice(i, i + EPISODE_PREFETCH_CONCURRENCY);
      await Promise.all(
        batch.map(async (podcastId) => {
          const podcast = byId.get(podcastId);
          const rssUrl = podcast?.rssUrl || `https://podcasts.files.bbci.co.uk/${podcastId}.rss`;
          try {
            await PodcastApi.fetchEpisodes(rssUrl, podcastId);
          } catch {
            // Offline or unavailable feed: skip.
          }
        })
      );
    }
    void syncAutoState();
  } finally {
    prefetchRunning = false;
  }
}

/** Applies mutations performed natively from the car (drained on startup). */
function drainNativeMutations(): void {
  if (!AutoBridge.isAvailable()) return;
  let mutations: AutoNativeEvent[] = [];
  try {
    const parsed = JSON.parse(AutoBridge.drainMutations() || "[]");
    if (Array.isArray(parsed)) {
      mutations = parsed.map((entry) => ({
        type: String(entry?.type || ""),
        payload: typeof entry?.payload === "string" ? entry.payload : JSON.stringify(entry?.payload || {})
      }));
    }
  } catch {
    return;
  }
  for (const mutation of mutations) {
    if (mutation.type) handleNativeEvent(mutation);
  }
}

/**
 * Initialises two-way sync with the Android Auto media service. Safe to call more
 * than once; subsequent calls are ignored.
 */
export function initAutoSync(): void {
  if (initialised) return;
  initialised = true;
  if (!AutoBridge.isAvailable()) return;

  drainNativeMutations();

  changeSubscription = Preferences.onChanged((key) => scheduleSync(key));
  eventSubscription = AutoBridge.onEvent(handleNativeEvent);
  appStateSubscription = AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") {
      drainNativeMutations();
      void syncAutoState();
      void prefetchSubscribedEpisodes();
    }
  });

  // Push a stations-only snapshot immediately so the head unit is browsable without
  // waiting for the podcast catalogue, then follow up with the full snapshot.
  void syncAutoState(false).then(() => syncAutoState()).then(() => prefetchSubscribedEpisodes());
}

/** Tears down listeners; intended for tests. */
export function disposeAutoSync(): void {
  changeSubscription?.remove();
  eventSubscription?.remove();
  appStateSubscription?.remove();
  changeSubscription = null;
  eventSubscription = null;
  appStateSubscription = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  initialised = false;
}
