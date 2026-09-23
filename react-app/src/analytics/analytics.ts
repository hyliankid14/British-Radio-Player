import Constants from "expo-constants";
import { Preferences } from "../storage/preferences";

const ANALYTICS_BASE_URL = "https://bbc-radio.shai.website";
const ANALYTICS_EVENT_URL = `${ANALYTICS_BASE_URL}/event`;
const PROMPTED_KEY = "pref_analytics_prompted";

/** Whether the user has approved anonymous analytics (defaults to off, like the Kotlin app). */
export function isAnalyticsEnabled(): boolean {
  return Preferences.getSetting<boolean>("pref_analytics", false);
}

export function setAnalyticsEnabled(enabled: boolean): void {
  Preferences.setSetting("pref_analytics", enabled);
}

/** True until the first-launch opt-in dialog has been answered. */
export function shouldShowAnalyticsPrompt(): boolean {
  return !Preferences.getSetting<boolean>(PROMPTED_KEY, false);
}

export function markAnalyticsPromptShown(): void {
  Preferences.setSetting(PROMPTED_KEY, true);
}

function appVersion(): string {
  const version = Constants.expoConfig?.version ?? "unknown";
  if (__DEV__ && !version.endsWith("-debug")) return `${version}-debug`;
  return version;
}

function utcTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function sendEvent(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(ANALYTICS_EVENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `British-Radio-Player/${appVersion()}`
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn("Failed to send analytics event:", error);
  }
}

/** Anonymous station play event, mirroring Kotlin `trackStationPlay`. */
export async function trackStationPlay(stationId: string, stationName?: string): Promise<void> {
  if (!isAnalyticsEnabled() || !stationId) return;
  await sendEvent({
    event: "station_play",
    station_id: stationId,
    ...(stationName ? { station_name: stationName } : {}),
    date: utcTimestamp(),
    app_version: appVersion()
  });
}

/** Anonymous episode play event, mirroring Kotlin `trackEpisodePlay`. */
export async function trackEpisodePlay(
  podcastId: string,
  episodeId: string,
  episodeTitle?: string,
  podcastTitle?: string
): Promise<void> {
  if (!isAnalyticsEnabled() || !podcastId || !episodeId) return;
  await sendEvent({
    event: "episode_play",
    podcast_id: podcastId,
    episode_id: episodeId,
    ...(podcastTitle ? { podcast_title: podcastTitle } : {}),
    ...(episodeTitle ? { episode_title: episodeTitle } : {}),
    date: utcTimestamp(),
    app_version: appVersion()
  });
}
