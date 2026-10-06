import { Preferences } from "../storage/preferences";
import { LASTFM_PROXY_URL } from "../api/lastfm";
import { WatchBridge } from "./watchBridge";

export function pushWatchState(): void {
  if (!WatchBridge.isAvailable()) return;
  try {
    const favourites = Preferences.getFavorites();
    const progressMap: Record<string, number> = {};
    for (const episodeId of Preferences.getPlayedEpisodeIds()) {
      progressMap[episodeId] = 0;
    }
    for (const entry of Preferences.getPodcastHistory()) {
      progressMap[entry.id] = Preferences.getEpisodeProgress(entry.id) * 1000;
    }
    const lastFm = Preferences.getLastFm();

    const payload = {
      favourite_ids: favourites,
      favourite_order: favourites,
      subscribed_podcast_ids: Preferences.getSubscribedPodcasts(),
      played_episode_ids: Preferences.getPlayedEpisodeIds(),
      history_episode_ids: Preferences.getPodcastHistory().map((entry) => entry.id),
      history_meta_json: JSON.stringify(Preferences.getPodcastHistory()),
      episode_progress_json: JSON.stringify(progressMap),
      lastfm_session_key: lastFm.sessionKey,
      lastfm_username: lastFm.username,
      lastfm_proxy_url: LASTFM_PROXY_URL,
      lastfm_direct_enabled: lastFm.direct,
      lastfm_broadcast_enabled: lastFm.broadcast,
      lastfm_scrobble_podcasts: lastFm.podcasts,
      has_subscription_snapshot: true,
      has_episode_snapshot: true
    };
    WatchBridge.syncState(JSON.stringify(payload));
  } catch (error) {
    console.warn("Watch state push failed:", error);
  }
}

export function applyWatchState(rawPayload: string): void {
  try {
    const payload = JSON.parse(rawPayload);
    if (payload?.request) { 
      pushWatchState(); 
      return; 
    }
    if (Array.isArray(payload.favourite_order) && payload.favourite_order.length > 0) {
      Preferences.setFavorites(payload.favourite_order);
    }
    if (payload.has_subscription_snapshot && Array.isArray(payload.subscribed_podcast_ids)) {
      Preferences.setSubscribedPodcasts(payload.subscribed_podcast_ids);
    }
    if (payload.has_episode_snapshot && Array.isArray(payload.played_episode_ids)) {
      for (const episodeId of payload.played_episode_ids) {
        if (!Preferences.isEpisodePlayed(episodeId)) {
          Preferences.markEpisodePlayed(episodeId);
        }
      }
    }
  } catch (error) {
    console.warn("Watch state merge failed:", error);
  }
}

let started = false;

export function initWatchSync(): void {
  if (started) return;
  if (!WatchBridge.isAvailable()) return;
  
  started = true;
  try {
    setInterval(() => {
      const rawPayload = WatchBridge.drainReceivedState();
      if (rawPayload) {
        applyWatchState(rawPayload);
      }
    }, 2000);
    
    pushWatchState();
  } catch { }
}
