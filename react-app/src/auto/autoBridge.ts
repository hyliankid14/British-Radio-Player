import { Platform } from "react-native";

export interface AutoNativeEvent {
  type: string;
  payload: string;
}

interface AutoNativeBridge {
  syncState(json: string): boolean;
  getState(): string;
  drainMutations(): string;
  clearState(): boolean;
  notifyPhonePlaybackStarted(): boolean;
  addListener(
    event: "onAutoEvent",
    listener: (event: AutoNativeEvent) => void
  ): { remove: () => void };
}

let bridge: AutoNativeBridge | null = null;
let loaded = false;

function load(): AutoNativeBridge | null {
  if (loaded) return bridge;
  loaded = true;
  if (Platform.OS !== "android") return null;
  try {
    // The native module only exists on Android; require lazily so other platforms
    // (and Jest) never evaluate it.
    const nativeModule = require("../../modules/android-auto-bridge/src/AndroidAutoBridgeModule");
    bridge = (nativeModule?.default ?? null) as AutoNativeBridge | null;
  } catch {
    bridge = null;
  }
  return bridge;
}

const noopSubscription = { remove: () => {} };

/**
 * Safe facade over the Android Auto native bridge. Every method is a no-op when the
 * native module is unavailable (iOS, web, tests, or a mis-configured build), so callers
 * never need platform checks.
 */
export const AutoBridge = {
  isAvailable(): boolean {
    return load() != null;
  },

  syncState(json: string): boolean {
    return load()?.syncState(json) ?? false;
  },

  getState(): string {
    return load()?.getState() ?? "{}";
  },

  drainMutations(): string {
    return load()?.drainMutations() ?? "[]";
  },

  clearState(): boolean {
    return load()?.clearState() ?? false;
  },

  notifyPhonePlaybackStarted(): boolean {
    return load()?.notifyPhonePlaybackStarted() ?? false;
  },

  onEvent(listener: (event: AutoNativeEvent) => void): { remove: () => void } {
    const nativeModule = load();
    if (!nativeModule) return noopSubscription;
    try {
      return nativeModule.addListener("onAutoEvent", listener);
    } catch {
      return noopSubscription;
    }
  }
};

/** Tells the native Auto player that phone playback has started so it can yield. */
export function notifyNativePhonePlaybackStarted(): void {
  if (!load()) return;
  try {
    AutoBridge.notifyPhonePlaybackStarted();
  } catch {
    // The native service is not running.
  }
}
