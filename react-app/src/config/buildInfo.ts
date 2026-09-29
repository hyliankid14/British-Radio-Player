import Constants from "expo-constants";

import {
  FALLBACK_APP_VERSION,
  debugVersionTag,
  resolveAppVersion
} from "../utils/appVersion";

/**
 * Whether this is a debug build.
 *
 * `__DEV__` is not enough on its own: the generated project bundles JavaScript for the debug
 * variant with `dev=false` (so `debuggableVariants = []` produces a standalone APK), which leaves
 * `__DEV__` false in a sideloaded debug build. The debug scripts and the debug CI workflow
 * therefore also inline `EXPO_PUBLIC_BUILD_VARIANT=debug` at bundle time.
 */
export const IS_DEBUG_BUILD = __DEV__ || process.env.EXPO_PUBLIC_BUILD_VARIANT === "debug";

/** The version this build reports. Debug builds are one patch ahead of the release version. */
export function appVersion(): string {
  return resolveAppVersion(Constants.expoConfig?.version ?? FALLBACK_APP_VERSION, IS_DEBUG_BUILD);
}

/** Analytics and User-Agent version tag, e.g. "2.0.1-debug". */
export function appVersionTag(): string {
  return debugVersionTag(appVersion(), IS_DEBUG_BUILD);
}
