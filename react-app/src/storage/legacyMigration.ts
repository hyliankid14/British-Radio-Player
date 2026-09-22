import { NativeAndroid } from "../native/nativeAndroid";
import { Preferences } from "./preferences";

/**
 * One-time migration of user data from the legacy Kotlin application.
 *
 * The React app reuses the Kotlin application ID so Android performs an in-place upgrade and
 * keeps the old `SharedPreferences`. On first launch after upgrading we convert those
 * preferences into the React MMKV store, then set a flag so this never runs again.
 */
export function runLegacyMigration(): boolean {
  if (Preferences.getSetting("pref_native_migrated", false)) return false;
  if (!NativeAndroid.isAvailable()) return false;

  let migrated = false;
  try {
    if (!NativeAndroid.hasLegacyData()) {
      // Nothing to migrate, but remember the check so we do not repeat it every launch.
      Preferences.setSetting("pref_native_migrated", true);
      return false;
    }

    const values = NativeAndroid.readLegacyPreferences();
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        Preferences.setSetting(key, value);
        migrated = true;
      }
    }
  } catch (error) {
    console.warn("Legacy preference migration failed:", error);
    return false;
  }

  Preferences.setSetting("pref_native_migrated", true);
  return migrated;
}
