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
    const notifyIds = Preferences.getSubscribedPodcasts().filter((id) =>
      Preferences.isPodcastNotificationsEnabled(id)
    );
    const interval = Number(Preferences.getSetting("pref_subscription_refresh", 60)) || 0;
    const wifiOnly = Boolean(Preferences.getSetting("pref_index_wifi_only", false));

    if (notifyIds.length === 0) {
      NativeAndroid.syncBackgroundSubscriptions("[]");
      NativeAndroid.scheduleBackgroundSync(0, wifiOnly);
      return;
    }

    const catalog = await PodcastApi.fetchLiveCatalog();
    const catalogMap = new Map(catalog.map((podcast) => [podcast.id, podcast]));
    const subscriptions = notifyIds.map((id) => {
      const podcast = catalogMap.get(id);
      const meta = Preferences.getPodcastMetadata(id);
      return {
        id,
        title: podcast?.title || meta?.title || "BBC Podcast",
        rssUrl: podcast?.rssUrl || `https://podcasts.files.bbci.co.uk/${id}.rss`
      };
    });

    NativeAndroid.syncBackgroundSubscriptions(JSON.stringify(subscriptions));
    NativeAndroid.scheduleBackgroundSync(interval, wifiOnly);
  } catch (error) {
    console.warn("Background sync configuration failed:", error);
  }
}
