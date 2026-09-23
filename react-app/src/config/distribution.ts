import { Platform } from "react-native";

export type DistributionChannel = "github" | "play" | "ios";

/**
 * Distribution channel the build targets:
 * - "ios"    → App Store / iOS build
 * - "play"   → Google Play Android build (set EXPO_PUBLIC_DISTRIBUTION_CHANNEL=play)
 * - "github" → Android GitHub release build (default on Android)
 */
export const DISTRIBUTION_CHANNEL: DistributionChannel =
  Platform.OS === "ios"
    ? "ios"
    : process.env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL === "play"
    ? "play"
    : "github";

/** Human-readable distribution label shown on the About page. */
export function distributionLabel(): string {
  if (DISTRIBUTION_CHANNEL === "ios") return "App Store";
  if (DISTRIBUTION_CHANNEL === "play") return "Google Play";
  return "GitHub";
}

/** The GitHub source link is shown on Android builds only. */
export const SHOW_GITHUB_LINK = Platform.OS === "android";

/** In-app GitHub updates are only offered on the Android GitHub distribution. */
export const SHOW_UPDATE_BUTTON = DISTRIBUTION_CHANNEL === "github";
