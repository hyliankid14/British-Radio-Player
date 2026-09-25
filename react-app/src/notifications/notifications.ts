import { Platform } from "react-native";
import type * as ExpoNotifications from "expo-notifications";
import { Preferences } from "../storage/preferences";
import { PodcastApi, matchesBooleanSearch } from "../api/podcasts";

type NotificationsModule = typeof ExpoNotifications;

const CHANNEL_ID = "new-episodes";
const LAST_CHECK_KEY = "pref_last_notification_check";
const LAST_SEARCH_CHECK_KEY = "pref_last_search_notification_check";
const lastNotifiedKey = (podcastId: string) => `pref_last_notified_${podcastId}`;
const lastSearchNotifiedKey = (searchId: string) => `pref_last_search_notified_${searchId}`;
const MAX_NOTIFICATIONS_PER_PODCAST = 3;

let moduleRef: NotificationsModule | null = null;
let moduleLoadFailed = false;
let channelReady = false;
let checking = false;
let handlerRegistered = false;

/**
 * Loads expo-notifications lazily so the JS bundle keeps working on native builds
 * that have not yet linked the module.
 */
function getNotifications(): NotificationsModule | null {
  if (moduleRef || moduleLoadFailed) return moduleRef;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    moduleRef = require("expo-notifications") as NotificationsModule;
    if (!handlerRegistered) {
      moduleRef.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true
        })
      });
      handlerRegistered = true;
    }
  } catch (error) {
    moduleLoadFailed = true;
    console.warn("expo-notifications is not available in this build:", error);
  }
  return moduleRef;
}

export function isNotificationModuleAvailable(): boolean {
  return getNotifications() !== null;
}

async function ensureChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== "android" || channelReady) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "New episodes",
      importance: Notifications.AndroidImportance.DEFAULT
    });
    channelReady = true;
  } catch {
    // Channel creation is best-effort; a fallback channel is used automatically.
  }
}

/** Reads current permission state without prompting. */
export async function hasNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  try {
    const status = await Notifications.getPermissionsAsync();
    return (
      status.granted ||
      status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** Requests permission (used when the user enables podcast notifications). */
export async function ensureNotificationPermissions(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  await ensureChannel(Notifications);
  try {
    const current = await Notifications.getPermissionsAsync();
    if (
      current.granted ||
      current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    ) {
      return true;
    }
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true }
    });
    return (
      requested.granted ||
      requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

async function present(
  Notifications: NotificationsModule,
  title: string,
  body: string,
  url: string,
  extraData?: Record<string, any>
): Promise<void> {
  await ensureChannel(Notifications);
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { url, ...extraData } },
    trigger:
      Platform.OS === "android"
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 1,
            channelId: CHANNEL_ID
          }
        : null
  });
}

function episodeEpoch(pubDate?: string): number {
  if (!pubDate) return 0;
  const parsed = Date.parse(pubDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Checks subscribed podcasts with notifications enabled for episodes published since the
 * last check and posts a local notification for each new one. Only notifies when the user
 * has already granted permission, so it never prompts from the background.
 */
export async function checkSubscriptionsForNewEpisodes(force = false): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || checking) return;

  const notifyIds = Preferences.getSubscribedPodcasts().filter((id) =>
    Preferences.isPodcastNotificationsEnabled(id)
  );
  if (notifyIds.length === 0) return;

  const intervalMinutes = Number(Preferences.getSetting("pref_subscription_refresh", 60)) || 0;
  if (!force && intervalMinutes > 0) {
    const lastCheck = Number(Preferences.getSetting(LAST_CHECK_KEY, 0)) || 0;
    if (Date.now() - lastCheck < intervalMinutes * 60_000) return;
  }

  if (!(await hasNotificationPermission())) return;

  checking = true;
  Preferences.setSetting(LAST_CHECK_KEY, Date.now());
  try {
    const catalog = await PodcastApi.fetchLiveCatalog();
    for (const id of notifyIds) {
      const podcast = catalog.find((item) => item.id === id);
      if (!podcast) continue;

      let episodes = PodcastApi.getEpisodesFromCache(id);
      if (!episodes || episodes.length === 0) {
        episodes = await PodcastApi.fetchEpisodes(podcast.rssUrl, podcast.id);
      }
      if (!episodes.length) continue;

      const newestEpoch = episodes.reduce((max, ep) => Math.max(max, episodeEpoch(ep.pubDate)), 0);
      const lastNotified = Number(Preferences.getSetting(lastNotifiedKey(id), 0)) || 0;

      // First observation establishes the baseline without flooding the user.
      if (lastNotified === 0) {
        Preferences.setSetting(lastNotifiedKey(id), newestEpoch || Date.now());
        continue;
      }

      const fresh = episodes
        .filter((ep) => episodeEpoch(ep.pubDate) > lastNotified)
        .sort((a, b) => episodeEpoch(a.pubDate) - episodeEpoch(b.pubDate));

      for (const episode of fresh.slice(-MAX_NOTIFICATIONS_PER_PODCAST)) {
        await present(
          Notifications,
          podcast.title,
          episode.title,
          `/modal/podcast-detail?podcastId=${podcast.id}`,
          { podcastId: podcast.id, episodeId: episode.id }
        );
      }

      if (fresh.length > 0) {
        Preferences.setSetting(
          lastNotifiedKey(id),
          fresh.reduce((max, ep) => Math.max(max, episodeEpoch(ep.pubDate)), lastNotified)
        );
      }
    }
  } catch (error) {
    console.warn("New episode notification check failed:", error);
  } finally {
    checking = false;
  }
}

let checkingSavedSearches = false;

/**
 * Checks saved searches with notifications enabled for new matching episodes
 * and posts a local notification for each new one.
 */
export async function checkSavedSearchesForNewEpisodes(force = false): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || checkingSavedSearches) return;

  const savedSearches = Preferences.getSavedPodcastSearches().filter(
    (s) => s.notificationsEnabled && s.query.trim().length > 0
  );
  if (savedSearches.length === 0) return;

  const intervalMinutes = Number(Preferences.getSetting("pref_subscription_refresh", 60)) || 0;
  if (!force && intervalMinutes > 0) {
    const lastCheck = Number(Preferences.getSetting(LAST_SEARCH_CHECK_KEY, 0)) || 0;
    if (Date.now() - lastCheck < intervalMinutes * 60_000) return;
  }

  if (!(await hasNotificationPermission())) return;

  checkingSavedSearches = true;
  Preferences.setSetting(LAST_SEARCH_CHECK_KEY, Date.now());

  try {
    for (const search of savedSearches) {
      try {
        const rawResults = await PodcastApi.searchEpisodesOnPi(search.query, 100);
        if (!rawResults || rawResults.length === 0) continue;

        const matching = rawResults.filter((episode) =>
          matchesBooleanSearch(search.query, `${episode.title} ${episode.description}`)
        );
        if (matching.length === 0) continue;

        const sorted = matching
          .map((ep) => ({ ...ep, epoch: episodeEpoch(ep.pubDate) }))
          .filter((ep) => ep.epoch > 0)
          .sort((a, b) => a.epoch - b.epoch);

        if (sorted.length === 0) continue;

        const newestEpoch = sorted[sorted.length - 1].epoch;
        const lastNotified = Number(Preferences.getSetting(lastSearchNotifiedKey(search.id), 0)) || 0;

        // First observation establishes baseline without spamming the user
        if (lastNotified === 0) {
          Preferences.setSetting(lastSearchNotifiedKey(search.id), newestEpoch || Date.now());
          const latestPubDate = sorted[sorted.length - 1].pubDate;
          if (latestPubDate && latestPubDate !== search.latestResultDate) {
            Preferences.updatePodcastSearchLatestResult(search.id, latestPubDate);
          }
          continue;
        }

        const fresh = sorted.filter((ep) => ep.epoch > lastNotified);
        if (fresh.length > 0) {
          const title = search.name.trim() || `Saved Search: ${search.query}`;
          const body =
            fresh.length === 1
              ? `New episode match: ${fresh[0].title}`
              : `${fresh.length} new episodes match "${search.query}"`;
          const targetUrl = `/modal/podcast-search?search=${encodeURIComponent(search.query)}&savedSearchId=${encodeURIComponent(search.id)}`;

          await present(Notifications, title, body, targetUrl, {
            search: search.query,
            savedSearchId: search.id
          });

          const maxEpoch = fresh.reduce((max, ep) => Math.max(max, ep.epoch), lastNotified);
          Preferences.setSetting(lastSearchNotifiedKey(search.id), maxEpoch);

          const newestPubDate = fresh[fresh.length - 1].pubDate;
          if (newestPubDate) {
            Preferences.updatePodcastSearchLatestResult(search.id, newestPubDate);
          }
        }
      } catch (err) {
        console.warn(`Saved search check failed for "${search.query}":`, err);
      }
    }
  } catch (error) {
    console.warn("Saved search notification check failed:", error);
  } finally {
    checkingSavedSearches = false;
  }
}

const LAST_NEW_PODCAST_KEY = "pref_last_new_podcast_check";
const SEEN_NEW_PODCASTS_KEY = "pref_seen_new_podcasts";
const MAX_SEEN_PODCASTS = 500;

/**
 * Notifies about newly indexed podcasts when the user has enabled new-podcast
 * notifications. The first run records a baseline without notifying.
 */
export async function checkForNewPodcasts(force = false): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  if (!Preferences.getSetting("pref_n_notifications", false)) return;

  const intervalDays = Math.max(1, Number(Preferences.getSetting("pref_n_interval_days", 1)) || 1);
  const lastCheck = Number(Preferences.getSetting(LAST_NEW_PODCAST_KEY, 0)) || 0;
  if (!force && lastCheck > 0 && Date.now() - lastCheck < intervalDays * 24 * 60 * 60 * 1000) return;

  if (!(await hasNotificationPermission())) return;

  try {
    const entries = await PodcastApi.getNewPodcastsFromPi();
    Preferences.setSetting(LAST_NEW_PODCAST_KEY, Date.now());
    if (entries.length === 0) return;

    const seenRaw = Preferences.getSetting<string>(SEEN_NEW_PODCASTS_KEY, "");
    const seen = new Set(seenRaw ? seenRaw.split(",").filter(Boolean) : []);
    const fresh = entries.filter((entry) => entry.id && !seen.has(entry.id));

    // First observation establishes a baseline so we do not flood on install.
    if (seen.size === 0) {
      entries.forEach((entry) => entry.id && seen.add(entry.id));
      Preferences.setSetting(SEEN_NEW_PODCASTS_KEY, Array.from(seen).slice(-MAX_SEEN_PODCASTS).join(","));
      return;
    }

    for (const entry of fresh.slice(0, 3)) {
      await present(
        Notifications,
        "New podcast on BBC Sounds",
        entry.title,
        `/modal/podcast-detail?podcastId=${entry.id}`,
        { podcastId: entry.id }
      );
    }
    fresh.forEach((entry) => entry.id && seen.add(entry.id));
    Preferences.setSetting(SEEN_NEW_PODCASTS_KEY, Array.from(seen).slice(-MAX_SEEN_PODCASTS).join(","));
  } catch (error) {
    console.warn("New podcast notification check failed:", error);
  }
}

/** Opens the deep link carried by a tapped notification. */
export function initNotificationNavigation(onOpenUrl: (url: string) => void): () => void {
  const Notifications = getNotifications();
  if (!Notifications) return () => {};

  const handledResponseIds = new Set<string>();

  const handleResponse = (response: ExpoNotifications.NotificationResponse | null | undefined) => {
    if (!response) return;
    const identifier = response.notification?.request?.identifier;
    if (identifier) {
      if (handledResponseIds.has(identifier)) return;
      handledResponseIds.add(identifier);
    }

    let data = response.notification?.request?.content?.data as Record<string, any> | string | undefined;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {}
    }
    if (!data || typeof data !== "object") return;

    if (typeof data.url === "string" && data.url) {
      onOpenUrl(data.url);
      return;
    }
    if (typeof data.podcastId === "string" && data.podcastId) {
      onOpenUrl(`/modal/podcast-detail?podcastId=${encodeURIComponent(data.podcastId)}`);
      return;
    }
    if (typeof data.search === "string" && data.search) {
      const savedSearchParam = data.savedSearchId ? `&savedSearchId=${encodeURIComponent(data.savedSearchId)}` : "";
      onOpenUrl(`/modal/podcast-search?search=${encodeURIComponent(data.search)}${savedSearchParam}`);
      return;
    }
  };

  try {
    const last = Notifications.getLastNotificationResponse();
    if (last) handleResponse(last);
  } catch {}

  if (typeof Notifications.getLastNotificationResponseAsync === "function") {
    Notifications.getLastNotificationResponseAsync()
      .then((res) => {
        if (res) handleResponse(res);
      })
      .catch(() => {});
  }

  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  return () => subscription.remove();
}
