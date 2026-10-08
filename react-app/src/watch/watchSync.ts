import { AppState, AppStateStatus } from "react-native";
import { Preferences } from "../storage/preferences.ts";
import { LASTFM_PROXY_URL } from "../api/lastfm.ts";
import { usePlayerStore } from "../store/playerStore.ts";
import { isAnalyticsEnabled } from "../analytics/analytics.ts";
import { WatchBridge } from "./watchBridge.ts";
import { buildWatchPayload, mergeWatchState, WatchPodcastData } from "./watchPayload.ts";
import { PodcastApi } from "../api/podcasts.ts";

const SYNC_DEBOUNCE_MS = 400;
const PROGRESS_SYNC_MIN_INTERVAL_MS = 15_000;
const HIGH_FREQUENCY_KEYS = new Set(["pref_episode_progress"]);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastProgressSyncAtMs = 0;
let changeSubscription: { remove: () => void } | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let playerStoreUnsubscribe: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function scheduleWatchPush(changedKey?: string): void {
  if (!WatchBridge.isAvailable()) return;
  if (changedKey && HIGH_FREQUENCY_KEYS.has(changedKey)) {
    const now = Date.now();
    if (now - lastProgressSyncAtMs < PROGRESS_SYNC_MIN_INTERVAL_MS) return;
    lastProgressSyncAtMs = now;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pushWatchState();
  }, SYNC_DEBOUNCE_MS);
}

export function pushWatchState(): void {
  if (!WatchBridge.isAvailable()) return;
  try {
    const subscribedIds = Preferences.getSubscribedPodcasts();
    const catalog = PodcastApi.getCachedCatalog ? PodcastApi.getCachedCatalog() : [];
    const catalogMap = new Map(catalog.map((p) => [p.id, p]));

    const subscribedPodcasts: WatchPodcastData[] = subscribedIds.map((id) => {
      const cat = catalogMap.get(id);
      const meta = Preferences.getPodcastMetadata(id);
      return {
        id,
        title: cat?.title || (meta?.title && meta.title !== id ? meta.title : id),
        rssUrl: cat?.rssUrl || `https://podcasts.files.bbci.co.uk/${id}.rss`,
        imageUrl: cat?.imageUrl || meta?.imageUrl || ""
      };
    });

    const payload = buildWatchPayload({
      favourites: Preferences.getFavorites(),
      subscribedPodcastIds: subscribedIds,
      subscribedPodcasts,
      playedEpisodeIds: Preferences.getPlayedEpisodeIds(),
      podcastHistory: Preferences.getPodcastHistory(),
      episodeProgressSeconds: (id) => Preferences.getEpisodeProgress(id),
      lastFm: Preferences.getLastFm(),
      lastFmProxyUrl: LASTFM_PROXY_URL,
      scrollMode: Preferences.getSetting("pref_scroll_mode", "all"),
      analyticsEnabled: isAnalyticsEnabled()
    });
    WatchBridge.syncState(JSON.stringify(payload));

    if (catalog.length === 0 && subscribedIds.length > 0) {
      void PodcastApi.fetchLiveCatalog().then(() => {
        pushWatchState();
      });
    }
  } catch (error) {
    console.warn("Watch state push failed:", error);
  }
}

export function applyWatchState(rawPayload: string): void {
  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    const shouldPush = mergeWatchState(parsed, {
      setFavorites: (ids) => {
        Preferences.setFavorites(ids);
        usePlayerStore.setState({ favorites: Preferences.getFavorites() });
      },
      setSubscribedPodcasts: (ids) => Preferences.setSubscribedPodcasts(ids),
      isEpisodePlayed: (id) => Preferences.isEpisodePlayed(id),
      markEpisodePlayed: (id) => Preferences.markEpisodePlayed(id),
      markEpisodeUnplayed: (id) => Preferences.markEpisodeUnplayed(id),
      setEpisodeProgress: (id, s) => Preferences.setEpisodeProgress(id, s),
      removeEpisodeProgress: (id) => Preferences.removeEpisodeProgress(id),
      addPodcastHistory: (e) => Preferences.addPodcastHistory(e)
    });
    if (shouldPush) pushWatchState();
  } catch (error) {
    console.warn("Watch state merge failed:", error);
  }
}

export function initWatchSync(): void {
  if (started) return;
  if (!WatchBridge.isAvailable()) return;
  started = true;
  try {
    changeSubscription = Preferences.onChanged((key) => scheduleWatchPush(key));

    // When phone playback pauses or stops, push fresh progress to watch immediately
    let wasPlaying = usePlayerStore.getState().isPlaying;
    playerStoreUnsubscribe = usePlayerStore.subscribe((state) => {
      if (wasPlaying && !state.isPlaying) {
        pushWatchState();
      }
      wasPlaying = state.isPlaying;
    });

    appStateSubscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") {
        const raw = WatchBridge.drainReceivedState();
        if (raw) applyWatchState(raw);
        pushWatchState();
      } else if (status === "background") {
        pushWatchState();
      }
    });

    pollTimer = setInterval(() => {
      const raw = WatchBridge.drainReceivedState();
      if (raw) applyWatchState(raw);
    }, 1000);

    pushWatchState();
  } catch {
    // WatchConnectivity is optional.
  }
}

export function disposeWatchSync(): void {
  changeSubscription?.remove();
  appStateSubscription?.remove();
  playerStoreUnsubscribe?.();
  if (pollTimer) clearInterval(pollTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  changeSubscription = null;
  appStateSubscription = null;
  playerStoreUnsubscribe = null;
  pollTimer = null;
  debounceTimer = null;
  started = false;
}
