import { NativeAndroid } from "../native/nativeAndroid";
import { Preferences } from "../storage/preferences";
import { PodcastApi } from "../api/podcasts";

/**
 * Keeps the native background worker in sync with the current subscriptions and refresh
 * settings so new episodes trigger notifications even when the app is closed.
 */
export async function syncBackgroundSync(): Promise<void> {
  if (!NativeAndroid.isAvailable()) return;
  try {
    const subscribedIds = Preferences.getSubscribedPodcasts();
    const interval = Number(Preferences.getSetting("pref_subscription_refresh", 60)) || 0;
    const wifiOnly = Boolean(Preferences.getSetting("pref_index_wifi_only", false));

    if (subscribedIds.length === 0) {
      NativeAndroid.syncBackgroundSubscriptions("[]");
      NativeAndroid.scheduleBackgroundSync(interval, wifiOnly);
      return;
    }

    const catalog = await PodcastApi.fetchLiveCatalog();
    const subscriptions = catalog
      .filter((podcast) => subscribedIds.includes(podcast.id))
      .map((podcast) => ({ id: podcast.id, title: podcast.title, rssUrl: podcast.rssUrl }));

    NativeAndroid.syncBackgroundSubscriptions(JSON.stringify(subscriptions));
    NativeAndroid.scheduleBackgroundSync(interval, wifiOnly);
  } catch (error) {
    console.warn("Background sync configuration failed:", error);
  }
}
