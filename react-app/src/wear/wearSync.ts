import { NativeAndroid } from "../native/nativeAndroid";
import { Preferences } from "../storage/preferences";

/**
 * Wear OS state sync. Pushes favourites, subscriptions, played ids, history and progress to
 * the companion watch app using the same Data Layer paths as the legacy Kotlin build, and
 * merges state received back from the watch.
 */
export function pushWearState(): void {
  if (!NativeAndroid.isAvailable()) return;
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
      lastfm_direct_enabled: lastFm.direct,
      lastfm_broadcast_enabled: lastFm.broadcast,
      lastfm_scrobble_podcasts: lastFm.podcasts
    };
    NativeAndroid.pushWearState(JSON.stringify(payload));
  } catch (error) {
    console.warn("Wear state push failed:", error);
  }
}

/** Merges state received from the watch into local preferences. */
export function applyWearState(rawPayload: string): void {
  try {
    const payload = JSON.parse(rawPayload);
    if (payload?.request) {
      pushWearState();
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
        if (!Preferences.isEpisodePlayed(episodeId)) Preferences.markEpisodePlayed(episodeId);
      }
      if (payload.episode_progress_json) {
        const progress = JSON.parse(payload.episode_progress_json);
        for (const [episodeId, positionMs] of Object.entries<number>(progress)) {
          if (positionMs > 0 && !Preferences.isEpisodePlayed(episodeId)) {
            Preferences.setEpisodeProgress(episodeId, Math.round(positionMs / 1000));
          }
        }
      }
      if (payload.history_meta_json) {
        const history = JSON.parse(payload.history_meta_json);
        if (Array.isArray(history)) {
          for (const entry of history) {
            if (entry?.id) Preferences.addPodcastHistory(entry);
          }
        }
      }
    }
  } catch (error) {
    console.warn("Wear state merge failed:", error);
  }
}

let started = false;

/** Starts listening for state received from the watch and pushes the initial snapshot. */
export function initWearSync(): void {
  if (started) return;
  started = true;
  try {
    NativeAndroid.addWearStateListener(applyWearState);
    pushWearState();
  } catch {
    // Wear support is optional.
  }
}
