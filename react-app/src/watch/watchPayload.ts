/**
 * Pure functions for building and merging Apple Watch sync payloads.
 *
 * Extracted from watchSync.ts so the logic can be unit-tested without
 * loading native dependencies (MMKV, expo-file-system, react-native).
 * This mirrors the pattern used by preferences.test.ts.
 */

export interface LastFmConfig {
  sessionKey: string;
  username: string;
  direct: boolean;
  broadcast: boolean;
  podcasts: boolean;
}

export interface PodcastHistoryEntry {
  id: string;
}

export interface WatchPodcastData {
  id: string;
  title: string;
  rssUrl: string;
  imageUrl: string;
}

export interface WatchStatePayload {
  favourite_ids: string[];
  favourite_order: string[];
  subscribed_podcast_ids: string[];
  subscribed_podcasts_json?: string;
  played_episode_ids: string[];
  history_episode_ids: string[];
  history_meta_json: string;
  episode_progress_json: string;
  lastfm_session_key: string;
  lastfm_username: string;
  lastfm_proxy_url: string;
  lastfm_direct_enabled: boolean;
  lastfm_broadcast_enabled: boolean;
  lastfm_scrobble_podcasts: boolean;
  has_subscription_snapshot: true;
  has_episode_snapshot: true;
  scroll_mode: string;
  analytics_enabled?: boolean;
}

/** Builds the full sync payload from raw preference data. */
export function buildWatchPayload(opts: {
  favourites: string[];
  subscribedPodcastIds: string[];
  subscribedPodcasts?: WatchPodcastData[];
  playedEpisodeIds: string[];
  podcastHistory: PodcastHistoryEntry[];
  episodeProgressSeconds: (id: string) => number;
  lastFm: LastFmConfig;
  lastFmProxyUrl: string;
  scrollMode?: string;
  analyticsEnabled?: boolean;
}): WatchStatePayload {
  const progressMap: Record<string, number> = {};
  for (const episodeId of opts.playedEpisodeIds) {
    progressMap[episodeId] = 0;
  }
  for (const entry of opts.podcastHistory) {
    progressMap[entry.id] = opts.episodeProgressSeconds(entry.id) * 1000;
  }

  return {
    favourite_ids: opts.favourites,
    favourite_order: opts.favourites,
    subscribed_podcast_ids: opts.subscribedPodcastIds,
    subscribed_podcasts_json: opts.subscribedPodcasts ? JSON.stringify(opts.subscribedPodcasts) : undefined,
    played_episode_ids: opts.playedEpisodeIds,
    history_episode_ids: opts.podcastHistory.map((e) => e.id),
    history_meta_json: JSON.stringify(opts.podcastHistory),
    episode_progress_json: JSON.stringify(progressMap),
    lastfm_session_key: opts.lastFm.sessionKey,
    lastfm_username: opts.lastFm.username,
    lastfm_proxy_url: opts.lastFmProxyUrl,
    lastfm_direct_enabled: opts.lastFm.direct,
    lastfm_broadcast_enabled: opts.lastFm.broadcast,
    lastfm_scrobble_podcasts: opts.lastFm.podcasts,
    has_subscription_snapshot: true,
    has_episode_snapshot: true,
    scroll_mode: opts.scrollMode ?? "all",
    analytics_enabled: opts.analyticsEnabled
  };
}

export interface WatchStateSink {
  setFavorites(ids: string[]): void;
  setSubscribedPodcasts(ids: string[]): void;
  isEpisodePlayed(id: string): boolean;
  markEpisodePlayed(id: string): void;
  markEpisodeUnplayed?(id: string): void;
  setEpisodeProgress(id: string, seconds: number): void;
  removeEpisodeProgress?(id: string): void;
  addPodcastHistory(entry: PodcastHistoryEntry): void;
}

/**
 * Merges an incoming watch state payload into the phone's preference store.
 * Returns true if a phone-side push should be triggered (request handshake).
 */
export function mergeWatchState(raw: unknown, sink: WatchStateSink): boolean {
  if (!raw || typeof raw !== "object") return false;
  const payload = raw as Record<string, unknown>;

  if (payload.request === true) return true; // caller should push current state

  const favOrder = Array.isArray(payload.favourite_order)
    ? (payload.favourite_order as string[])
    : Array.isArray(payload.favourite_ids)
      ? (payload.favourite_ids as string[])
      : null;

  if (favOrder !== null) {
    sink.setFavorites(favOrder);
  }

  if (payload.has_subscription_snapshot === true && Array.isArray(payload.subscribed_podcast_ids)) {
    sink.setSubscribedPodcasts(payload.subscribed_podcast_ids as string[]);
  }

  if (
    payload.has_episode_snapshot === true ||
    Array.isArray(payload.played_episode_ids) ||
    Array.isArray(payload.unplayed_episode_ids) ||
    typeof payload.episode_progress_json === "string"
  ) {
    if (Array.isArray(payload.played_episode_ids)) {
      for (const episodeId of payload.played_episode_ids as string[]) {
        if (!sink.isEpisodePlayed(episodeId)) sink.markEpisodePlayed(episodeId);
      }
    }

    if (Array.isArray(payload.unplayed_episode_ids)) {
      for (const episodeId of payload.unplayed_episode_ids as string[]) {
        sink.markEpisodeUnplayed?.(episodeId);
      }
    }

    if (typeof payload.episode_progress_json === "string") {
      try {
        const progress = JSON.parse(payload.episode_progress_json) as Record<string, number>;
        if (progress && typeof progress === "object") {
          for (const [id, posMs] of Object.entries(progress)) {
            if (posMs > 0 && !sink.isEpisodePlayed(id)) {
              sink.setEpisodeProgress(id, Math.round(posMs / 1000));
            } else if (posMs <= 0) {
              sink.removeEpisodeProgress?.(id);
            }
          }
        }
      } catch {
        // Ignore malformed progress JSON
      }
    }

    if (typeof payload.history_meta_json === "string") {
      try {
        const history = JSON.parse(payload.history_meta_json) as unknown[];
        if (Array.isArray(history)) {
          for (const entry of history) {
            if (entry && typeof entry === "object" && "id" in entry) {
              sink.addPodcastHistory(entry as PodcastHistoryEntry);
            }
          }
        }
      } catch {
        // Ignore malformed history JSON
      }
    }
  }

  return false;
}
