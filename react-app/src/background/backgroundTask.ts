import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { runAutoDownload } from "../downloads/autoDownload";
import { applyBackgroundEpisodeSnapshots } from "./backgroundSync";
import { checkForNewPodcasts, checkSavedSearchesForNewEpisodes, checkSubscriptionsForNewEpisodes } from "../notifications/notifications";
import { Preferences } from "../storage/preferences";

export const BACKGROUND_TASK_NAME = "british-radio-background-sync";

// Defined in the global scope so the task is restored even when the app is relaunched in the
// background. Android syncs with its native worker via episode snapshots, while JS runs
// auto-download, subscription checks, new-podcast alerts, and saved-search checks on both platforms.
TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    await runAutoDownload();
    if (Platform.OS === "android") {
      // Adopt any episode lists the native worker resolved before running JS checks.
      applyBackgroundEpisodeSnapshots();
    }
    await checkSubscriptionsForNewEpisodes(true);
    await checkForNewPodcasts(true);
    await checkSavedSearchesForNewEpisodes(true);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn("Background task failed:", error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registers (or refreshes) the periodic background task using the subscription refresh interval. */
export async function registerBackgroundTask(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    const interval = Number(Preferences.getSetting("pref_subscription_refresh", 60)) || 60;
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: Math.max(15, interval)
    });
  } catch (error) {
    console.warn("Failed to register background task:", error);
  }
}
