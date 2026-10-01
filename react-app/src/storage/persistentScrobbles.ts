import { File, Paths } from "expo-file-system";
import { NativeAndroid } from "../native/nativeAndroid";
import type { LastFmScrobbleEntry } from "./preferences";

const PERSISTENT_SCROBBLES_FILE = ".lastfm_recent_scrobbles.json";

function sanitizeScrobbles(list: unknown[]): LastFmScrobbleEntry[] {
  return list
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      artist: String(item.artist || "").trim(),
      track: String(item.track || "").trim(),
      stationName: typeof item.stationName === "string" ? item.stationName : undefined,
      timestampMs: typeof item.timestampMs === "number" && Number.isFinite(item.timestampMs) ? item.timestampMs : 0
    }))
    .filter((entry) => entry.artist.length > 0 && entry.track.length > 0)
    .slice(0, 5);
}

/**
 * Persists the last 5 scrobbled tracks across uninstalls, reinstalls and updates.
 *
 * Saves to Android external public storage (survives app uninstall),
 * Android SharedPreferences (backed up by Android Auto Backup / Cloud Backup),
 * and the app documents directory.
 */
export function savePersistentRecentScrobbles(entries: LastFmScrobbleEntry[]): void {
  const top5 = entries.slice(0, 5);
  const json = JSON.stringify(top5);

  // 1. Android public storage & Auto Backup SharedPreferences
  try {
    NativeAndroid.savePersistentScrobbles(json);
  } catch {
    // Ignore off Android
  }

  // 2. Documents file (iOS & fallback)
  try {
    const file = new File(Paths.document, PERSISTENT_SCROBBLES_FILE);
    file.create({ intermediates: true, overwrite: true });
    file.write(json);
  } catch {
    // Ignore file write errors
  }
}

/**
 * Reads persistent scrobbled tracks synchronously (via NativeAndroid public storage & Auto Backup).
 */
export function readPersistentRecentScrobbles(): LastFmScrobbleEntry[] | null {
  try {
    const raw = NativeAndroid.readPersistentScrobbles();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sanitized = sanitizeScrobbles(parsed);
        if (sanitized.length > 0) return sanitized;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Reads persistent scrobbled tracks asynchronously, checking NativeAndroid first then Documents file.
 */
export async function readPersistentRecentScrobblesAsync(): Promise<LastFmScrobbleEntry[] | null> {
  const syncResult = readPersistentRecentScrobbles();
  if (syncResult && syncResult.length > 0) return syncResult;

  try {
    const file = new File(Paths.document, PERSISTENT_SCROBBLES_FILE);
    if (file.exists) {
      const text = await file.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sanitized = sanitizeScrobbles(parsed);
          if (sanitized.length > 0) return sanitized;
        }
      }
    }
  } catch {
    // Ignore
  }

  return null;
}
