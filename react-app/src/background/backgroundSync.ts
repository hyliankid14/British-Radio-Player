import { NativeAndroid, type BackgroundEpisodeSnapshot } from "../native/nativeAndroid";
import { Preferences } from "../storage/preferences";
import { PodcastApi, type Episode } from "../api/podcasts";
import { backgroundRefreshInterval, planSubscriptionSync } from "./syncPolicy";

/**
 * Keeps the native background worker in sync with the current subscriptions and refresh
 * settings, so new episodes are fetched — and announced — even when the app is closed.
 *
 * The worker is told about **every** subscription, each carrying a `notify` flag. It used to be
 * told only about the subscriptions whose bell was armed, which meant the default install —
 * where `isPodcastNotificationsEnabled` is false until the user turns a bell on — cancelled the
 * worker outright. Nothing refreshed in the background, so Android Auto served whatever episode
 * lists the phone happened to have in memory and new-episode alerts waited on the app being
 * opened.
 */
export async function syncBackgroundSync(): Promise<void> {
  if (!NativeAndroid.isAvailable()) return;
  try {
    const plan = planSubscriptionSync(
      Preferences.getSubscribedPodcasts(),
      (id) => Preferences.isPodcastNotificationsEnabled(id)
    );
    const interval = backgroundRefreshInterval(
      plan.refreshIds.length,
      Number(Preferences.getSetting("pref_subscription_refresh", 60)) || 0
    );

    // Nothing to refresh, or the user asked for manual-only: cancel the worker.
    if (interval <= 0) {
      NativeAndroid.syncBackgroundSubscriptions("[]");
      NativeAndroid.scheduleBackgroundSync(0, false);
      return;
    }

    const catalog = await PodcastApi.fetchLiveCatalog();
    const catalogMap = new Map(catalog.map((podcast) => [podcast.id, podcast]));
    const notifySet = new Set(plan.notifyIds);
    const subscriptions = plan.refreshIds.map((id) => {
      const podcast = catalogMap.get(id);
      const meta = Preferences.getPodcastMetadata(id);
      return {
        id,
        title: podcast?.title || meta?.title || "BBC Podcast",
        rssUrl: podcast?.rssUrl || `https://podcasts.files.bbci.co.uk/${id}.rss`,
        notify: notifySet.has(id)
      };
    });

    // Feed checks are a few hundred kilobytes per show, against several megabytes for the MP3
    // of the same episode, so "Download on Wi-Fi only" is the wrong gate for them. Deriving it
    // from that preference — the default — restricted the worker to unmetered networks and
    // silently stopped every background check for anyone on mobile data.
    NativeAndroid.syncBackgroundSubscriptions(JSON.stringify(subscriptions));
    NativeAndroid.scheduleBackgroundSync(interval, false);
  } catch (error) {
    console.warn("Background sync configuration failed:", error);
  }
}

/**
 * Adoption is a full parse of every snapshot the worker holds, and it is offered before every
 * in-car sync. Remembering the worker's revision makes the steady-state case one cheap read.
 */
let lastAdoptedRevision = 0;

/**
 * Adopts the episode lists the native worker resolved on its last run into the app's caches.
 *
 * The worker parses feeds in its own process and parks the results in its SharedPreferences —
 * it cannot reach the React app's MMKV store. This is the handover, and it is what makes a
 * background refresh visible: without it the work is thrown away and the same feeds are
 * re-downloaded the next time the app, or the car, asks for the subscription list.
 *
 * Idempotent, and cheap when the worker has not run since the last adoption.
 *
 * @returns how many podcasts were adopted
 */
export function applyBackgroundEpisodeSnapshots(): number {
  if (!NativeAndroid.isAvailable()) return 0;
  const revision = NativeAndroid.getBackgroundEpisodeSnapshotRevision();
  if (revision === 0 || revision === lastAdoptedRevision) return 0;

  let snapshots: Record<string, BackgroundEpisodeSnapshot>;
  try {
    snapshots = NativeAndroid.getBackgroundEpisodeSnapshots();
  } catch {
    return 0;
  }
  lastAdoptedRevision = revision;

  let adopted = 0;
  for (const [podcastId, snapshot] of Object.entries(snapshots)) {
    if (!snapshot || !Array.isArray(snapshot.episodes) || snapshot.episodes.length === 0) continue;
    PodcastApi.adoptEpisodes(podcastId, snapshot.episodes as Episode[], snapshot.fetchedAtMs);
    adopted += 1;
  }
  return adopted;
}

/**
 * Forgets the persisted episode lists of shows the user has unsubscribed from.
 *
 * Called once on launch rather than from {@link applyBackgroundEpisodeSnapshots}: it scans
 * every storage key, and the unsubscribe path in `Preferences.setSubscribedPodcasts` already
 * removes the list eagerly, so this only catches historical leftovers.
 */
export function pruneEpisodeSnapshots(): number {
  return Preferences.prunePodcastEpisodeSnapshots();
}
