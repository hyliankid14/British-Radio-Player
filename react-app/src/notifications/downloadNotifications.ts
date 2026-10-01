import { Platform } from "react-native";
import type * as ExpoNotifications from "expo-notifications";
import {
  ensureNotificationPermissions,
  getNotifications,
  hasNotificationPermission
} from "./notifications";
import {
  DownloadItemSummary,
  DownloadSummaryItem,
  downloadFinishedNotice,
  downloadStartedBody
} from "./downloadMessages";

export type { DownloadItemSummary, DownloadSummaryItem };

type NotificationsModule = typeof ExpoNotifications;

const DOWNLOAD_CHANNEL_ID = "downloads";
const DOWNLOAD_NOTIFICATION_ID = "download_status";

/**
 * Downloads are queued in bursts (a podcast's newest episodes, a whole playlist,
 * the auto-download run). A short window lets one notice cover the burst instead
 * of one notification per file.
 */
const BATCH_WINDOW_MS = 700;

let channelReady = false;
let permissionRequested = false;

/** In-flight downloads across every queue, plus the tallies for the current burst. */
let active = 0;
let succeeded = 0;
let failed = 0;
let startedInBurst = 0;
/** In-flight downloads in the current burst, for the "Downloading" notice. */
let burstItems: DownloadSummaryItem[] = [];
/** Episodes that failed in the current burst, for the failure body. */
let failedTitles: string[] = [];
/** Episodes that succeeded in the current burst, for the success body. */
let succeededItems: DownloadSummaryItem[] = [];
/** A user-started download may prompt for notification permission; automatic ones never do. */
let mayPrompt = false;
let startedTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureDownloadChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== "android" || channelReady) return;
  try {
    await Notifications.setNotificationChannelAsync(DOWNLOAD_CHANNEL_ID, {
      name: "Downloads",
      importance: Notifications.AndroidImportance.DEFAULT
    });
    channelReady = true;
  } catch {
    // Channel creation is best-effort; a fallback channel is used automatically.
  }
}

/**
 * Resolves whether a notification may be posted. User-started downloads ask for
 * permission once per session; automatic downloads stay silent so they never
 * interrupt with a permission prompt.
 */
async function ensurePermission(): Promise<boolean> {
  if (await hasNotificationPermission()) return true;
  if (!mayPrompt || permissionRequested) return false;
  permissionRequested = true;
  return ensureNotificationPermissions();
}

async function post(title: string, body: string, data?: Record<string, any>): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  if (!(await ensurePermission())) return;
  try {
    await ensureDownloadChannel(Notifications);
    await Notifications.scheduleNotificationAsync({
      identifier: DOWNLOAD_NOTIFICATION_ID,
      content: {
        title,
        body,
        sound: false,
        data: data || { url: "/downloads" }
      },
      trigger:
        Platform.OS === "android"
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              channelId: DOWNLOAD_CHANNEL_ID
            }
          : null
    });
  } catch {
    // A download must never fail because its notification could not be posted.
  }
}

/**
 * Records that a download has been queued. A single aggregated "downloading"
 * notice is posted shortly after the first of a burst; later calls just extend it.
 * `item` is included in the notice when only one episode is being downloaded.
 */
export function notifyDownloadStarted(auto: boolean, item?: DownloadSummaryItem): void {
  active += 1;
  startedInBurst += 1;
  if (item) burstItems.push(item);
  if (!auto) mayPrompt = true;
  if (startedTimer) return;
  startedTimer = setTimeout(() => {
    startedTimer = null;
    const count = startedInBurst;
    const items = burstItems.slice();
    startedInBurst = 0;
    burstItems = [];
    if (count > 0) void post("Downloading episodes", downloadStartedBody(count, items));
  }, BATCH_WINDOW_MS);
}

/**
 * Records that one in-flight download settled. Once the last one finishes, the
 * burst is summarised in a single notification and the tallies are reset.
 * `item` is collected so its title (and podcast title) can be named in the notice.
 */
export function notifyDownloadFinished(ok: boolean, item?: DownloadSummaryItem): void {
  active = Math.max(0, active - 1);
  if (ok) {
    succeeded += 1;
    if (item) succeededItems.push(item);
  } else {
    failed += 1;
    if (item) {
      const title = typeof item === "string" ? item : item.title;
      if (title) failedTitles.push(title);
    }
  }

  if (active > 0) return;

  if (startedTimer) {
    clearTimeout(startedTimer);
    startedTimer = null;
  }
  startedInBurst = 0;
  burstItems = [];

  const notice = downloadFinishedNotice(succeeded, failed, failedTitles, succeededItems);
  succeeded = 0;
  failed = 0;
  failedTitles = [];
  succeededItems = [];
  if (notice) void post(notice.title, notice.body);
  mayPrompt = false;
}
