import Constants from "expo-constants";
import { Platform } from "react-native";
import { NativeAndroid } from "../native/nativeAndroid";
import { Preferences } from "../storage/preferences";

const ANALYTICS_BASE_URL = "https://bbc-radio.shai.website";
const ANALYTICS_EVENT_URL = `${ANALYTICS_BASE_URL}/event`;
const PROMPTED_KEY = "pref_analytics_prompted";

/** Whether the user has approved anonymous analytics (defaults to off, like the Kotlin app). */
export function isAnalyticsEnabled(): boolean {
  if (Preferences.hasSetting("pref_analytics")) {
    return Preferences.getSetting<boolean>("pref_analytics", false);
  }
  // Check if legacy Kotlin SharedPreferences had analytics enabled
  if (NativeAndroid.isAvailable()) {
    try {
      const legacy = NativeAndroid.getLegacyAnalyticsEnabled();
      if (typeof legacy === "boolean") {
        Preferences.setSetting("pref_analytics", legacy);
        Preferences.setSetting(PROMPTED_KEY, true);
        return legacy;
      }
    } catch {
      // Ignore
    }
  }
  return false;
}

export function setAnalyticsEnabled(enabled: boolean): void {
  Preferences.setSetting("pref_analytics", enabled);
  if (NativeAndroid.isAvailable()) {
    try {
      NativeAndroid.setNativeAnalyticsEnabled(enabled);
    } catch {
      // Ignore
    }
  }
}

/** True until the first-launch opt-in dialog has been answered. */
export function shouldShowAnalyticsPrompt(): boolean {
  return !Preferences.getSetting<boolean>(PROMPTED_KEY, false);
}

export function markAnalyticsPromptShown(): void {
  Preferences.setSetting(PROMPTED_KEY, true);
}

function appVersion(): string {
  const version = Constants.expoConfig?.version ?? "2.0.0";
  if (__DEV__ && !version.endsWith("-debug")) return `${version}-debug`;
  return version;
}

function utcTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function sendEvent(payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(ANALYTICS_EVENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `British-Radio-Player/${appVersion()}`
      },
      body: JSON.stringify(payload)
    });
    if (__DEV__) {
      console.log(`[Analytics] Sent ${String(payload.event)} -> status ${res.status}`);
    }
  } catch (error) {
    console.warn("Failed to send analytics event:", error);
  }
}

/** Anonymous station play event, mirroring Kotlin `trackStationPlay`. */
export async function trackStationPlay(stationId: string, stationName?: string): Promise<void> {
  const cleanId = (stationId || "").trim();
  if (!isAnalyticsEnabled() || !cleanId) return;
  await sendEvent({
    event: "station_play",
    station_id: cleanId,
    ...(stationName?.trim() ? { station_name: stationName.trim() } : {}),
    date: utcTimestamp(),
    app_version: appVersion(),
    platform: Platform.OS === "ios" ? "ios" : "android"
  });
}

/** Anonymous episode play event, mirroring Kotlin `trackEpisodePlay`. */
export async function trackEpisodePlay(
  podcastId: string,
  episodeId: string,
  episodeTitle?: string,
  podcastTitle?: string
): Promise<void> {
  const cleanPodcastId = (podcastId || "").trim();
  const cleanEpisodeId = (episodeId || "").trim();
  if (!isAnalyticsEnabled() || !cleanPodcastId || !cleanEpisodeId) {
    if (__DEV__) {
      console.log(`[Analytics] Skipping episode_play: enabled=${isAnalyticsEnabled()}, podcastId='${cleanPodcastId}', episodeId='${cleanEpisodeId}'`);
    }
    return;
  }
  await sendEvent({
    event: "episode_play",
    podcast_id: cleanPodcastId,
    episode_id: cleanEpisodeId,
    ...(podcastTitle?.trim() ? { podcast_title: podcastTitle.trim() } : {}),
    ...(episodeTitle?.trim() ? { episode_title: episodeTitle.trim() } : {}),
    date: utcTimestamp(),
    app_version: appVersion(),
    platform: Platform.OS === "ios" ? "ios" : "android"
  });
}
