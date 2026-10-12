import * as ScreenOrientation from "expo-screen-orientation";
import { Platform } from "react-native";

/**
 * Locks the device orientation to portrait (top up).
 * Gracefully no-ops on platforms or environments that do not support orientation locking.
 */
export async function lockToPortrait(): Promise<void> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch {
    // Unsupported or rejected by system
  }
}

/**
 * Locks the device orientation to landscape (left or right).
 * Gracefully no-ops on platforms or environments that do not support orientation locking.
 */
export async function lockToLandscape(): Promise<void> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch {
    // Unsupported or rejected by system
  }
}

/**
 * Unlocks orientation to allow sensor-based rotation (e.g. portrait or landscape).
 * Gracefully no-ops on platforms or environments that do not support orientation locking.
 */
export async function unlockOrientation(): Promise<void> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  try {
    await ScreenOrientation.unlockAsync();
  } catch {
    // Unsupported or rejected by system
  }
}
