import { Directory, File, Paths } from "expo-file-system";
import { Platform, Settings } from "react-native";

/** A mutation performed natively in the car, drained by the React layer. */
export interface CarPlayMutation {
  type: string;
  payload: string;
}

const CARPLAY_DIRECTORY = "carplay";
const SNAPSHOT_FILE = "snapshot.json";
const MUTATIONS_FILE = "mutations.json";
/**
 * Bumped on every snapshot push. A tiny value in `NSUserDefaults` (rather than the
 * snapshot itself) so the native side can watch `NSUserDefaultsDidChangeNotification`
 * without pulling multi-megabyte state through the React Native `Settings` bridge.
 */
const REVISION_KEY = "carplay_snapshot_revision";
/** Written by the phone player so the CarPlay scene pauses instead of doubling up. */
const PHONE_PLAYBACK_KEY = "carplay_phone_playback_active";

let snapshotFile: File | null = null;
let mutationsFile: File | null = null;

function available(): boolean {
  return Platform.OS === "ios";
}

function directory(): Directory | null {
  if (!available()) return null;
  try {
    const dir = new Directory(Paths.cache, CARPLAY_DIRECTORY);
    dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch {
    return null;
  }
}

function fileFor(name: string): File | null {
  const parent = directory();
  if (!parent) return null;
  const file = new File(parent, name);
  try {
    file.create({ intermediates: true, overwrite: true });
  } catch {
    return null;
  }
  return file;
}

function snapshot(): File | null {
  if (!snapshotFile) snapshotFile = fileFor(SNAPSHOT_FILE);
  return snapshotFile;
}

function mutations(): File | null {
  if (!mutationsFile) mutationsFile = fileFor(MUTATIONS_FILE);
  return mutationsFile;
}

/**
 * Bridge between the React state layer and the native CarPlay scene.
 *
 * The React application is the single source of truth for the catalogue (stations,
 * subscriptions, episodes, playlists, history and preferences) and pushes the same
 * snapshot the Android Auto service consumes. The snapshot is written to a file
 * because it can reach a few megabytes; a revision counter in `NSUserDefaults` tells
 * the native side when to re-read it.
 *
 * Every method is a no-op off iOS, so callers never need platform checks.
 */
export const CarPlayBridge = {
  isAvailable(): boolean {
    return available();
  },

  /** Persists the snapshot and bumps the revision counter the native side watches. */
  syncState(json: string): boolean {
    if (!available()) return false;
    const file = snapshot();
    if (!file) return false;
    try {
      file.write(json);
    } catch {
      return false;
    }
    try {
      const current = Number(Settings.get(REVISION_KEY) ?? 0);
      Settings.set({ [REVISION_KEY]: (Number.isFinite(current) ? current : 0) + 1 });
    } catch {
      // The revision counter is an optimisation; the file itself is authoritative.
    }
    return true;
  },

  /** Reads and clears the mutation queue the car appended while the phone was away. */
  drainMutations(): CarPlayMutation[] {
    if (!available()) return [];
    const file = mutations();
    if (!file) return [];
    let parsed: unknown;
    try {
      if (!file.exists) return [];
      parsed = JSON.parse(file.textSync() || "[]");
    } catch {
      return [];
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    // Only rewrite the queue when there is something to clear, so the foreground poll
    // does not touch flash storage on every tick.
    try {
      file.write("[]");
    } catch {
      // Best effort: a repeated drain is idempotent because the mutations are absolute
      // state changes rather than deltas.
    }
    return parsed
      .map((entry) => {
        const record = entry as Record<string, any>;
        const type = String(record?.type || "");
        if (!type) return null;
        return {
          type,
          payload:
            typeof record?.payload === "string"
              ? record.payload
              : JSON.stringify(record?.payload ?? {})
        };
      })
      .filter((entry): entry is CarPlayMutation => entry !== null);
  },

  /** Tells the car that the phone player has taken over, so the car yields. */
  notifyPhonePlaybackStarted(): boolean {
    if (!available()) return false;
    try {
      Settings.set({ [PHONE_PLAYBACK_KEY]: true });
    } catch {
      return false;
    }
    return true;
  }
};

/** Tells the CarPlay scene that phone playback has started so it can yield. */
export function notifyCarPlayPhonePlaybackStarted(): void {
  if (!CarPlayBridge.isAvailable()) return;
  try {
    CarPlayBridge.notifyPhonePlaybackStarted();
  } catch {
    // The CarPlay scene is not connected.
  }
}

/** Clears the phone playback flag once the phone player stops. */
export function notifyCarPlayPhonePlaybackStopped(): void {
  if (!CarPlayBridge.isAvailable()) return;
  try {
    Settings.set({ [PHONE_PLAYBACK_KEY]: false });
  } catch {
    // The CarPlay scene is not connected.
  }
}
