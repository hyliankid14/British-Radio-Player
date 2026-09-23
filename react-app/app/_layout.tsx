import React, { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
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
import { initWearSync, pushWearState } from "../src/wear/wearSync";
import { syncBackgroundSync } from "../src/background/backgroundSync";
import { runAutoDownload } from "../src/downloads/autoDownload";
import {
  checkSubscriptionsForNewEpisodes,
  initNotificationNavigation
} from "../src/notifications/notifications";
import { Preferences } from "../src/storage/preferences";
import { NativeAndroid } from "../src/native/nativeAndroid";
import { LastFmApi } from "../src/api/lastfm";
import { StationRepository } from "../src/data/stations";
import { formatShowDisplayTitle } from "../src/api/showInfo";

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
  if (key.includes("subscrib") || key.includes("download") || key.includes("notif")) {
    void runAutoDownload();
    void checkSubscriptionsForNewEpisodes();
  }
});

// Configure the native background worker once the store is ready.
void syncBackgroundSync();

export default function RootLayout() {
  const router = useRouter();
  const theme = useAppTheme();
  const isDark = useIsDarkTheme();
  const initStore = usePlayerStore((state) => state.init);

  useEffect(() => {
    async function handleDeepLink(url: string) {
      if (!url) return;
      try {
        const parsed = Linking.parse(url);

        // A Last.fm OAuth redirect carries a one-time token; exchange it once here so
        // the connection succeeds regardless of which screen is open.
        const token = typeof parsed.queryParams?.token === "string" ? parsed.queryParams.token : null;
        if (token) {
          try {
            const session = await LastFmApi.exchangeToken(token);
            Preferences.setLastFmSession(session.username, session.sessionKey);
            Alert.alert("Last.fm connected", `Connected as ${session.username}.`);
          } catch (error) {
            Alert.alert(
              "Last.fm connection failed",
              error instanceof Error ? error.message : "Could not connect to Last.fm."
            );
          }
          return;
        }

        let path = parsed.path || "";
        if (!path.startsWith("/")) path = "/" + path;
        router.navigate({
          pathname: path as any,
          params: parsed.queryParams as any
        });
      } catch (e) {
        console.warn("Failed to navigate to deep link:", url, e);
      }
    }

    const sub = Linking.addEventListener("url", (event) => void handleDeepLink(event.url));
    Linking.getInitialURL().then((url) => {
      if (url) void handleDeepLink(url);
    });

    return () => sub.remove();
  }, [router]);

  // Open the podcast a tapped new-episode notification refers to.
  useEffect(
    () => initNotificationNavigation((url) => router.push(url as any)),
    [router]
  );

  // Run auto-download and the new-episode check while the app is open, and whenever it
  // returns to the foreground.
  useEffect(() => {
    void runAutoDownload();
    void checkSubscriptionsForNewEpisodes();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void runAutoDownload();
        void checkSubscriptionsForNewEpisodes();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    async function start() {
      await setupPlayer();
      await initStore();

      // If the app was launched by the radio alarm, start the chosen station and ramp up.
      const alarm = NativeAndroid.consumeAlarmLaunch();
      if (alarm?.stationId) {
        const station = StationRepository.getById(alarm.stationId);
        if (station) {
          try {
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
        }
      }
    }
    start();
  }, [initStore]);

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
      </Stack>
    </SafeAreaProvider>
  );
}
