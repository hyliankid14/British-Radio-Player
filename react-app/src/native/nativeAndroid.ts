import { Platform } from "react-native";

interface NativeAndroidBridge {
  hasLegacyData(): boolean;
  readLegacyPreferences(): string;
  migrationFlagKey(): string;
  extractPalette(imageUrl: string, isDarkMode: boolean): Promise<string>;
  isVpnActive(): boolean;
  startShakeDetection(): void;
  stopShakeDetection(): void;
  addListener(eventName: "onShake", listener: () => void): { remove(): void };
  scheduleAlarm(
    hour: number,
    minute: number,
    daysMask: number,
    stationId: string | null,
    ramp: boolean,
    volume: number
  ): void;
  cancelAlarm(): void;
  canScheduleExactAlarms(): boolean;
  requestNotificationPermission(): boolean;
  consumeAlarmLaunch(): string | null;
  checkForUpdate(currentVersion: string): Promise<string>;
  downloadAndInstallUpdate(apkUrl: string, apkName: string): void;
  updateWidgetState(stationTitle: string, showTitle: string, isPlaying: boolean): void;
  consumeWidgetToggle(): boolean;
  pushWearState(payloadJson: string): void;
  addListener(
    eventName: "onWearState",
    listener: (event: { payload: string }) => void
  ): { remove(): void };
  syncBackgroundSubscriptions(subscriptionsJson: string): void;
  scheduleBackgroundSync(intervalMinutes: number, wifiOnly: boolean): void;
}

export interface UpdateInfo {
  available: boolean;
  version: string;
  apkName: string;
  apkUrl: string;
}

export interface AlarmLaunch {
  stationId: string | null;
  ramp: boolean;
  volume: number;
}

export interface ArtworkPalette {
  dominant: string;
  subtle: string;
  buttonOutline: string;
  playPause: string;
  icon: string;
  isLight: boolean;
}

let bridge: NativeAndroidBridge | null = null;
let loaded = false;

function load(): NativeAndroidBridge | null {
  if (loaded) return bridge;
  loaded = true;
  if (Platform.OS !== "android") return null;
  try {
    // The native module only exists on Android; require lazily so other platforms
    // (and Jest) never evaluate it.
    const nativeModule = require("../../modules/native-android/src/NativeAndroidModule");
    bridge = (nativeModule?.default ?? null) as NativeAndroidBridge | null;
  } catch {
    bridge = null;
  }
  return bridge;
}

/**
 * Safe facade over the NativeAndroid Expo module. Every method degrades gracefully when the
 * native module is unavailable (iOS, web, tests, or a mis-configured build).
 */
export const NativeAndroid = {
  isAvailable(): boolean {
    return load() != null;
  },

  hasLegacyData(): boolean {
    try {
      return load()?.hasLegacyData() ?? false;
    } catch {
      return false;
    }
  },

  readLegacyPreferences(): Record<string, string | number | boolean> {
    try {
      const raw = load()?.readLegacyPreferences() ?? "{}";
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  },

  migrationFlagKey(): string {
    try {
      return load()?.migrationFlagKey() ?? "pref_native_migrated";
    } catch {
      return "pref_native_migrated";
    }
  },

  /** Extracts the adaptive palette from artwork; resolves to null when unavailable. */
  async extractPalette(imageUrl: string, isDarkMode: boolean): Promise<ArtworkPalette | null> {
    if (!imageUrl) return null;
    try {
      const bridge = load();
      if (!bridge) return null;
      const raw = await bridge.extractPalette(imageUrl, isDarkMode);
      const parsed = JSON.parse(raw || "{}");
      if (!parsed || typeof parsed !== "object" || !parsed.subtle) return null;
      return parsed as ArtworkPalette;
    } catch {
      return null;
    }
  },

  /** True when a VPN transport is active; always false when the native module is absent. */
  isVpnActive(): boolean {
    try {
      return load()?.isVpnActive() ?? false;
    } catch {
      return false;
    }
  },

  /** Starts shake detection and invokes [listener] on each shake; returns a cleanup function. */
  startShakeDetection(listener: () => void): () => void {
    const bridge = load();
    if (!bridge) return () => {};
    try {
      const subscription = bridge.addListener("onShake", listener);
      bridge.startShakeDetection();
      return () => {
        try {
          bridge.stopShakeDetection();
          subscription?.remove?.();
        } catch {
          // Ignore teardown failures.
        }
      };
    } catch {
      return () => {};
    }
  },

  /** Schedules the radio alarm. No-op when the native module is unavailable. */
  scheduleAlarm(
    hour: number,
    minute: number,
    daysMask: number,
    stationId: string | null,
    ramp: boolean,
    volume: number
  ): void {
    try {
      load()?.scheduleAlarm(hour, minute, daysMask, stationId, ramp, volume);
    } catch {
      // Ignore scheduling failures.
    }
  },

  /** Cancels the radio alarm. */
  cancelAlarm(): void {
    try {
      load()?.cancelAlarm();
    } catch {
      // Ignore.
    }
  },

  /** True when exact alarms are permitted; defaults to true off-Android. */
  canScheduleExactAlarms(): boolean {
    try {
      return load()?.canScheduleExactAlarms() ?? true;
    } catch {
      return true;
    }
  },

  /** Requests notification permission, returning whether it is already granted. */
  requestNotificationPermission(): boolean {
    try {
      return load()?.requestNotificationPermission() ?? false;
    } catch {
      return false;
    }
  },

  /** Reads and clears the alarm launch intent details. */
  consumeAlarmLaunch(): AlarmLaunch | null {
    try {
      const raw = load()?.consumeAlarmLaunch();
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        stationId: parsed.stationId ?? null,
        ramp: !!parsed.ramp,
        volume: typeof parsed.volume === "number" ? parsed.volume : 5
      };
    } catch {
      return null;
    }
  },

  /** Checks GitHub releases for a newer APK; resolves to null when unavailable. */
  async checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
    try {
      const bridge = load();
      if (!bridge) return null;
      const raw = await bridge.checkForUpdate(currentVersion);
      const parsed = JSON.parse(raw || "{}");
      if (!parsed || !parsed.version) return null;
      return parsed as UpdateInfo;
    } catch {
      return null;
    }
  },

  /** Downloads and installs the update APK. */
  downloadAndInstallUpdate(apkUrl: string, apkName: string): void {
    try {
      load()?.downloadAndInstallUpdate(apkUrl, apkName);
    } catch {
      // Ignore.
    }
  },

  /** Pushes playback state to the home screen widget. */
  updateWidgetState(stationTitle: string, showTitle: string, isPlaying: boolean): void {
    try {
      load()?.updateWidgetState(stationTitle, showTitle, isPlaying);
    } catch {
      // Ignore.
    }
  },

  /** True when the app was launched by the widget toggle button. */
  consumeWidgetToggle(): boolean {
    try {
      return load()?.consumeWidgetToggle() ?? false;
    } catch {
      return false;
    }
  },

  /** Pushes phone state to the Wear OS companion. */
  pushWearState(payloadJson: string): void {
    try {
      load()?.pushWearState(payloadJson);
    } catch {
      // Ignore.
    }
  },

  /** Subscribes to state received from the Wear OS companion; returns a cleanup function. */
  addWearStateListener(listener: (payload: string) => void): () => void {
    const bridge = load();
    if (!bridge) return () => {};
    try {
      const subscription = bridge.addListener("onWearState", (event) => listener(event.payload));
      return () => subscription?.remove?.();
    } catch {
      return () => {};
    }
  },

  /** Stores the subscription snapshot used by the background worker. */
  syncBackgroundSubscriptions(subscriptionsJson: string): void {
    try {
      load()?.syncBackgroundSubscriptions(subscriptionsJson);
    } catch {
      // Ignore.
    }
  },

  /** Schedules (or cancels) the periodic background new-episode check. */
  scheduleBackgroundSync(intervalMinutes: number, wifiOnly: boolean): void {
    try {
      load()?.scheduleBackgroundSync(intervalMinutes, wifiOnly);
    } catch {
      // Ignore.
    }
  }
};
