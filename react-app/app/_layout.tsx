import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Stack, useRouter, useNavigationContainerRef } from "expo-router";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import TrackPlayer from "react-native-track-player";
import { Alert, AppState, LogBox, Platform, StatusBar as RNStatusBar, Dimensions } from "react-native";
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
import { initDownloadCleanup, pruneDownloads } from "../src/downloads/downloadCleanup";
import {
  checkForNewPodcasts,
  checkSubscriptionsForNewEpisodes,
  checkSavedSearchesForNewEpisodes,
  initNotificationNavigation
} from "../src/notifications/notifications";
import {
  createLaunchNavigation,
  isFocusedTarget,
  isTargetInState,
  LAUNCH_INTENT_DEDUPE_MS,
  type NavigationStateLike
} from "../src/navigation/launchNavigation";
import { Preferences } from "../src/storage/preferences";
import { readPersistentRecentScrobblesAsync } from "../src/storage/persistentScrobbles";
import { NativeAndroid, AlarmLaunch } from "../src/native/nativeAndroid";
import { StationRepository } from "../src/data/stations";
import { isPlaceholderArtwork } from "../src/api/showInfo";
import { RadioAlarm } from "../src/audio/radioAlarm";
import { probeGeoBlock } from "../src/utils/geoBlock";
import {
  buildWidgetCatalogueJson,
  isSameWidgetState,
  parseWidgetActionUrl,
  resolveWidgetLiveState,
  type WidgetAction,
  type WidgetLiveState
} from "../src/widgets/widgetSync";
import { syncIosWidgetState } from "../src/widgets/widgetIos";

LogBox.ignoreAllLogs();

// Register playback service
TrackPlayer.registerPlaybackService(() => playbackService);

// Run geo-probe on startup to identify regional availability
void probeGeoBlock();

// Convert any data left behind by the legacy Kotlin build before anything reads preferences.
runLegacyMigration();

// Recover persistent Last.fm scrobbles if MMKV is empty (e.g. after reinstall)
void readPersistentRecentScrobblesAsync().then((entries) => {
  if (entries && entries.length > 0 && Preferences.getLastFmRecentScrobbles().length === 0) {
    Preferences.setLastFmRecentScrobbles(entries);
  }
});

// Trim downloads back to the configured maximum and start honouring "Delete when completed".
initDownloadCleanup();

// Keep the native Android Auto service and CarPlay scene in sync with the app's
// catalogue and state.
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
  if (key.includes("subscrib") || key.includes("download") || key.includes("notif") || key.includes("search") || key.includes("sort")) {
    void runAutoDownload();
    void pruneDownloads();
    void checkSubscriptionsForNewEpisodes();
    void checkForNewPodcasts();
    void checkSavedSearchesForNewEpisodes();
  }
});

// Configure the native background worker once the store is ready.
void syncBackgroundSync();

/** Screens a podcast notification opens, which fall back to the subscribed list. */
const LAUNCH_PODCAST_SCREENS = ["/modal/podcast-detail", "/modal/podcast-search"];

/**
 * A widget tap that arrived before the player existed, kept at module scope because the
 * link listener, the startup sequence and the render that flips `playerReady` all need to
 * see the same slot.
 */
let pendingWidgetAction: WidgetAction | null = null;

export default function RootLayout() {
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  const theme = useAppTheme();
  const isDark = useIsDarkTheme();
  const initStore = usePlayerStore((state) => state.init);
  const [showAnalyticsConsent, setShowAnalyticsConsent] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  // A single notification tap surfaces through several launch paths at once (the
  // expo-linking initial URL, the stored expo-notifications response, and the native
  // Android intent). The coordinator collapses them to one screen and keeps re-issuing
  // the push until it lands, because expo-router can drop a navigation issued before
  // the root navigator is mounted — which is exactly the cold-start case.
  //
  // The state has to be read imperatively from the container ref: this layout renders
  // inside expo-router's own `__root` slot navigator, so it never re-renders when a
  // route is pushed onto the stack below it, and the ref always reports the live tree.
  const readNavigationState = useCallback((): NavigationStateLike | null => {
    try {
      return (navigationRef.getRootState?.() as NavigationStateLike | undefined) ?? null;
    } catch {
      return null;
    }
  }, [navigationRef]);

  const launchNavigation = useMemo(
    () =>
      createLaunchNavigation({
        // A podcast or search result opened from a notification has nothing behind it
        // but whichever tab happened to be open, so put the subscribed podcasts list
        // under it: back from the screen then lands on the list the episode came from
        // instead of somewhere unrelated.
        prepare: (target) => {
          if (!LAUNCH_PODCAST_SCREENS.includes(target.pathname)) return;
          try {
            router.navigate({ pathname: "/(tabs)/favourites", params: { category: "Subscribed" } });
          } catch (e) {
            console.warn("Failed to open the subscribed podcasts list:", e);
          }
        },
        apply: (target) => {
          try {
            if (target.pathname.startsWith("/modal/")) {
              router.push({ pathname: target.pathname as any, params: target.params as any });
            } else {
              router.navigate({ pathname: target.pathname as any, params: target.params as any });
            }
          } catch (e) {
            console.warn("Failed to navigate to target:", target, e);
          }
        },
        isApplied: (target) => isTargetInState(readNavigationState(), target),
        isFocused: (target) => isFocusedTarget(readNavigationState(), target)
      }),
    [router, readNavigationState]
  );

  useEffect(() => () => launchNavigation.dispose(), [launchNavigation]);

  const navigateToTarget = useCallback(
    (targetUrl: string, dedupeWindowMs?: number) => {
      launchNavigation.request(targetUrl, dedupeWindowMs);
    },
    [launchNavigation]
  );

  // Play or stop the station a widget was tapped for. Playback lives in the React layer, so
  // a widget tap brings the app forward and the request is drained here.
  const handleWidgetAction = useCallback(async (action: WidgetAction | null) => {
    if (!action || action.action === "open") return;
    if (action.action === "stop") {
      await usePlayerStore.getState().stop();
      return;
    }
    const stationId = action.stationId;
    const station = stationId
      ? StationRepository.getById(stationId)
      : (usePlayerStore.getState().currentStation ?? StationRepository.getAll()[0]);
    if (!station) return;
    try {
      await usePlayerStore.getState().playStation(station);
    } catch (error) {
      console.warn("Widget playback failed:", error);
    }
  }, []);

  // A widget tap that arrived before the player existed, replayed once setup finishes.
  useEffect(() => {
    if (!pendingWidgetAction) return;
    const action = pendingWidgetAction;
    pendingWidgetAction = null;
    void handleWidgetAction(action);
  }, [handleWidgetAction, playerReady]);

  // Deep linking (e.g. bbcradioplayer://...)
  useEffect(() => {
    const route = (url: string) => {
      const action = parseWidgetActionUrl(url);
      if (!action) {
        navigateToTarget(url);
        return;
      }
      if (!playerReady) {
        pendingWidgetAction = action;
        return;
      }
      void handleWidgetAction(action);
    };
    const sub = Linking.addEventListener("url", (event) => {
      if (event.url) route(event.url);
    });
    Linking.getInitialURL().then((url) => {
      if (url) route(url);
    });
    return () => sub.remove();
  }, [navigateToTarget, handleWidgetAction, playerReady]);

  // Handles alarm playback on both Android and iOS
  const handleAlarmPlayback = useCallback(async (alarm: AlarmLaunch | null) => {
    if (!alarm?.stationId) return;
    const station = StationRepository.getById(alarm.stationId);
    if (!station) return;
    try {
      // Hand playback over from the native alarm service to the in-app player.
      NativeAndroid.stopAlarmPlayback();
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

  // Listen for native Android widget taps while app is running/backgrounded
  useEffect(() => {
    return NativeAndroid.addWidgetActionListener((action) => {
      void handleWidgetAction(action);
    });
  }, [handleWidgetAction]);

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
        const widgetAction = NativeAndroid.consumeWidgetAction();
        if (widgetAction) {
          void handleWidgetAction(widgetAction);
        }
        const alarm = NativeAndroid.consumeAlarmLaunch();
        if (alarm) {
          void handleAlarmPlayback(alarm);
        }
        const notifUrl = NativeAndroid.consumeNotificationLaunch();
        if (notifUrl) {
          navigateToTarget(notifUrl);
        }
        void runAutoDownload();
        void pruneDownloads();
        void checkSubscriptionsForNewEpisodes();
        void checkForNewPodcasts();
        void checkSavedSearchesForNewEpisodes();
      }
    });
    return () => subscription.remove();
  }, [navigateToTarget, handleAlarmPlayback, handleWidgetAction]);

  useEffect(() => {
    async function start() {
      await setupPlayer();
      await initStore();

      // Ensure radio alarm is scheduled from preferences (especially on iOS)
      void RadioAlarm.scheduleFromPreferences();

      // Hand the widget station pickers the station list. The Android picker is a native
      // screen the launcher shows while a widget is added, so it cannot ask the React layer.
      NativeAndroid.setWidgetCatalogue(buildWidgetCatalogueJson(StationRepository.getAll()));

            // A widget tap queues its request natively and brings the app forward; drain it
      // here, once the player exists, rather than at mount.
      void handleWidgetAction(NativeAndroid.consumeWidgetAction());

      // Unblocks a widget tap that arrived through the link listener during startup.
      setPlayerReady(true);

      // If the app was launched by the radio alarm, start the chosen station and ramp up.
      const alarm = NativeAndroid.consumeAlarmLaunch();
      if (alarm) {
        void handleAlarmPlayback(alarm);
      }

      // If the app was launched by a tapped notification via native Intent:
      const notifUrl = NativeAndroid.consumeNotificationLaunch();
      if (notifUrl) {
        // Player and store setup delay this until well past the normal dedupe window,
        // so widen it: this is the same tap the deep-link and response listeners have
        // already routed, and navigating again would stack a duplicate screen.
        navigateToTarget(notifUrl, LAUNCH_INTENT_DEDUPE_MS);
      }
    }
    start();
  }, [initStore, navigateToTarget, handleAlarmPlayback, handleWidgetAction]);

  // Keep the home screen widgets in sync. Android renders from its own shared preferences,
  // iOS from the App Group container the widget extension reads, so both get the same push.
  useEffect(() => {
    // The store notifies far more often than a widget can show anything new (playback
    // position ticks several times a second), and every push costs a redraw on Android and a
    // timeline reload on iOS. Only push what the widgets actually render.
    let last: WidgetLiveState | null = null;
    const push = (state: ReturnType<typeof usePlayerStore.getState>) => {
      const live = resolveWidgetLiveState({
        stationId: state.currentStation?.id,
        stationTitle: state.currentStation?.title,
        stationLogoUrl: state.currentStation?.logoUrl,
        show: state.currentShow,
        isPlaying: state.isPlaying,
        isPlaceholderArtwork
      });
      if (last && isSameWidgetState(last, live)) return;
      last = live;
      NativeAndroid.updateWidgetState(
        live.stationId,
        live.stationTitle,
        live.showLine,
        live.isPlaying,
        live.artworkUrl
      );
      void syncIosWidgetState(live);
    };
    push(usePlayerStore.getState());
    return usePlayerStore.subscribe(push);
  }, []);

  const initialMetrics = useMemo(
    () => ({
      insets: {
        top: Math.max(
          initialWindowMetrics?.insets?.top ?? 0,
          Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 0) : 0
        ),
        bottom: initialWindowMetrics?.insets?.bottom ?? 0,
        left: initialWindowMetrics?.insets?.left ?? 0,
        right: initialWindowMetrics?.insets?.right ?? 0
      },
      frame: initialWindowMetrics?.frame ?? {
        x: 0,
        y: 0,
        width: Dimensions.get("window").width,
        height: Dimensions.get("window").height
      }
    }),
    []
  );

  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
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
          name="widget/[action]"
          options={{ headerShown: false, animation: "none" }}
        />
        <Stack.Screen
          name="widget/index"
          options={{ headerShown: false, animation: "none" }}
        />
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
            gestureEnabled: true,
            animation: "none"
          }}
        />
        <Stack.Screen
          name="modal/episode-detail"
          options={{
            presentation: "modal",
            headerShown: false,
            animation: "none"
          }}
        />
        <Stack.Screen
          name="modal/playlist-detail"
          options={{
            presentation: "modal",
            headerShown: false,
            gestureEnabled: true,
            animation: "none"
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
