import React, { useEffect, useState, useRef, useCallback } from "react";
import { Stack, useRouter, useRootNavigationState } from "expo-router";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import TrackPlayer from "react-native-track-player";
import { Alert, AppState, LogBox } from "react-native";
import { setupPlayer, playbackService } from "../src/audio/trackPlayerService";
import { usePlayerStore } from "../src/store/playerStore";
import { initAutoSync } from "../src/auto/autoSync";
import { runLegacyMigration } from "../src/storage/legacyMigration";
import { useAppTheme, useIsDarkTheme } from "../src/theme/colors";
import { AnalyticsConsentDialog } from "../src/components/AnalyticsConsentDialog";
import {
  markAnalyticsPromptShown,
  setAnalyticsEnabled,
  shouldShowAnalyticsPrompt
} from "../src/analytics/analytics";
import { initWearSync, pushWearState } from "../src/wear/wearSync";
import { syncBackgroundSync } from "../src/background/backgroundSync";
import { registerBackgroundTask } from "../src/background/backgroundTask";
import { runAutoDownload } from "../src/downloads/autoDownload";
import {
  checkForNewPodcasts,
  checkSubscriptionsForNewEpisodes,
  checkSavedSearchesForNewEpisodes,
  initNotificationNavigation
} from "../src/notifications/notifications";
import { resolveAppNavigation } from "../src/utils/navigationUtils";
import { Preferences } from "../src/storage/preferences";
import { NativeAndroid, AlarmLaunch } from "../src/native/nativeAndroid";
import { StationRepository } from "../src/data/stations";
import { formatShowDisplayTitle } from "../src/api/showInfo";
import { RadioAlarm } from "../src/audio/radioAlarm";

LogBox.ignoreAllLogs();

// Register playback service
TrackPlayer.registerPlaybackService(() => playbackService);

// Convert any data left behind by the legacy Kotlin build before anything reads preferences.
runLegacyMigration();

// Keep the native Android Auto service in sync with the app's catalogue and state.
initAutoSync();

// Sync favourites, subscriptions and progress with the Wear OS companion.
initWearSync();

// Re-push to the watch whenever preferences change, and reconfigure background sync when
// subscription or refresh settings change.
let backgroundSyncTimer: ReturnType<typeof setTimeout> | null = null;
Preferences.onChanged((key) => {
  pushWearState();
  if (key.includes("subscrib") || key.includes("refresh") || key.includes("wifi") || key.includes("notif")) {
    if (backgroundSyncTimer) clearTimeout(backgroundSyncTimer);
    backgroundSyncTimer = setTimeout(() => void syncBackgroundSync(), 1500);
  }
  if (key.includes("refresh")) {
    void registerBackgroundTask();
  }
  if (key.includes("subscrib") || key.includes("download") || key.includes("notif") || key.includes("search")) {
    void runAutoDownload();
    void checkSubscriptionsForNewEpisodes();
    void checkForNewPodcasts();
    void checkSavedSearchesForNewEpisodes();
  }
});

// Configure the native background worker once the store is ready.
void syncBackgroundSync();

export default function RootLayout() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const theme = useAppTheme();
  const isDark = useIsDarkTheme();
  const initStore = usePlayerStore((state) => state.init);
  const [showAnalyticsConsent, setShowAnalyticsConsent] = useState(false);
  const pendingNavigationRef = useRef<string | null>(null);

  const navigateToTarget = useCallback(
    (targetUrl: string) => {
      if (!targetUrl) return;
      const target = resolveAppNavigation(targetUrl);
      if (!target) return;

      // If root navigation is not mounted yet, queue for mount
      if (!rootNavigationState?.key) {
        pendingNavigationRef.current = targetUrl;
        return;
      }

      setTimeout(() => {
        try {
          if (target.pathname.startsWith("/modal/")) {
            router.push({
              pathname: target.pathname as any,
              params: target.params as any
            });
          } else {
            router.navigate({
              pathname: target.pathname as any,
              params: target.params as any
            });
          }
        } catch (e) {
          console.warn("Failed to navigate to target:", targetUrl, e);
        }
      }, 50);
    },
    [router, rootNavigationState?.key]
  );

  // Drain pending navigation when root navigator is mounted
  useEffect(() => {
    if (rootNavigationState?.key && pendingNavigationRef.current) {
      const url = pendingNavigationRef.current;
      const timer = setTimeout(() => {
        pendingNavigationRef.current = null;
        navigateToTarget(url);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [rootNavigationState?.key, navigateToTarget]);

  // Deep linking (e.g. bbcradioplayer://...)
  useEffect(() => {
    const sub = Linking.addEventListener("url", (event) => {
      if (event.url) navigateToTarget(event.url);
    });
    Linking.getInitialURL().then((url) => {
      if (url) navigateToTarget(url);
    });
    return () => sub.remove();
  }, [navigateToTarget]);

  // Handles alarm playback on both Android and iOS
  const handleAlarmPlayback = useCallback(async (alarm: AlarmLaunch | null) => {
    if (!alarm?.stationId) return;
    const station = StationRepository.getById(alarm.stationId);
    if (!station) return;
    try {
      NativeAndroid.cancelAlarmNotification();
      await usePlayerStore.getState().playStation(station);
      if (alarm.ramp) {
        const steps = 15;
        const target = Math.min(1, Math.max(0.05, alarm.volume / 10));
        for (let step = 1; step <= steps; step++) {
          await TrackPlayer.setVolume((target * step) / steps);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } else {
        await TrackPlayer.setVolume(Math.min(1, Math.max(0.05, alarm.volume / 10)));
      }
    } catch (error) {
      console.warn("Alarm playback failed:", error);
    }
  }, []);

  // Open the podcast, search result, or alarm a notification refers to (Expo Notifications)
  useEffect(() => {
    return initNotificationNavigation(
      (url) => {
        navigateToTarget(url);
      },
      (alarm) => {
        void handleAlarmPlayback(alarm);
      }
    );
  }, [navigateToTarget, handleAlarmPlayback]);

  // Listen for native Android notification taps while app is running/backgrounded
  useEffect(() => {
    return NativeAndroid.addNotificationOpenListener((url) => {
      if (url) navigateToTarget(url);
    });
  }, [navigateToTarget]);

  // Listen for native Android alarm notification launches while app is running/backgrounded
  useEffect(() => {
    return NativeAndroid.addAlarmLaunchListener((alarm) => {
      void handleAlarmPlayback(alarm);
    });
  }, [handleAlarmPlayback]);

  // Show the analytics opt-in dialog on first launch (after the UI has settled).
  useEffect(() => {
    if (!shouldShowAnalyticsPrompt()) return;
    const timer = setTimeout(() => setShowAnalyticsConsent(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  // Run auto-download, new-episode check, and saved-search check while the app is open,
  // and whenever it returns to the foreground.
  useEffect(() => {
    void runAutoDownload();
    void checkSubscriptionsForNewEpisodes();
    void checkForNewPodcasts();
    void checkSavedSearchesForNewEpisodes();
    void registerBackgroundTask();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        const alarm = NativeAndroid.consumeAlarmLaunch();
        if (alarm) {
          void handleAlarmPlayback(alarm);
        }
        const notifUrl = NativeAndroid.consumeNotificationLaunch();
        if (notifUrl) {
          navigateToTarget(notifUrl);
        }
        void runAutoDownload();
        void checkSubscriptionsForNewEpisodes();
        void checkForNewPodcasts();
        void checkSavedSearchesForNewEpisodes();
      }
    });
    return () => subscription.remove();
  }, [navigateToTarget, handleAlarmPlayback]);

  useEffect(() => {
    async function start() {
      await setupPlayer();
      await initStore();

      // Ensure radio alarm is scheduled from preferences (especially on iOS)
      void RadioAlarm.scheduleFromPreferences();

      // If the app was launched by the radio alarm, start the chosen station and ramp up.
      const alarm = NativeAndroid.consumeAlarmLaunch();
      if (alarm) {
        void handleAlarmPlayback(alarm);
      }

      // If the app was launched by a tapped notification via native Intent:
      const notifUrl = NativeAndroid.consumeNotificationLaunch();
      if (notifUrl) {
        navigateToTarget(notifUrl);
      }
    }
    start();
  }, [initStore, navigateToTarget, handleAlarmPlayback]);

  // Keep the home screen widget in sync with playback state.
  useEffect(() => {
    const push = (state: ReturnType<typeof usePlayerStore.getState>) => {
      const title =
        state.currentStation?.title ?? state.currentPodcast?.title ?? "British Radio Player";
      const show = state.currentShow
        ? formatShowDisplayTitle(state.currentShow)
        : state.currentEpisode?.title ?? "";
      NativeAndroid.updateWidgetState(title, show, state.isPlaying);
    };
    push(usePlayerStore.getState());
    return usePlayerStore.subscribe(push);
  }, []);

  // Toggle playback when launched from the widget's play/pause button.
  useEffect(() => {
    if (NativeAndroid.consumeWidgetToggle()) {
      void usePlayerStore.getState().togglePlayPause();
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background }
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="lastfm-auth" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal/now-playing"
          options={{
            presentation: "modal",
            headerShown: false,
            gestureEnabled: true
          }}
        />
        <Stack.Screen
          name="modal/podcast-detail"
          options={{
            presentation: "modal",
            headerShown: false,
            gestureEnabled: true
          }}
        />
        <Stack.Screen
          name="modal/episode-detail"
          options={{
            presentation: "modal",
            headerShown: false
          }}
        />
        <Stack.Screen
          name="modal/playlist-detail"
          options={{
            presentation: "modal",
            headerShown: false,
            gestureEnabled: true
          }}
        />
        <Stack.Screen
          name="modal/schedule"
          options={{
            presentation: "modal",
            headerShown: false,
            gestureEnabled: true
          }}
        />
        <Stack.Screen
          name="modal/settings-detail"
          options={{ presentation: "card", headerShown: false }}
        />
        <Stack.Screen
          name="modal/podcast-search"
          options={{ presentation: "card", headerShown: false }}
        />
      </Stack>
      <AnalyticsConsentDialog
        visible={showAnalyticsConsent}
        onApprove={() => {
          setAnalyticsEnabled(true);
          markAnalyticsPromptShown();
          setShowAnalyticsConsent(false);
        }}
        onDecline={() => {
          setAnalyticsEnabled(false);
          markAnalyticsPromptShown();
          setShowAnalyticsConsent(false);
        }}
      />
    </SafeAreaProvider>
  );
}
