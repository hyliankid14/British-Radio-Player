// Native Android helpers (Android only).
import { NativeModule, requireNativeModule } from 'expo';

declare class NativeAndroidModule extends NativeModule<{}> {
  /** True when the legacy Kotlin app left preference data behind on this device. */
  hasLegacyData(): boolean;
  /** Legacy preferences converted into the React MMKV key/value shape, as a JSON string. */
  readLegacyPreferences(): string;
  /** The MMKV key that marks the migration as complete. */
  migrationFlagKey(): string;
  /** Extracts the adaptive Now Playing palette from artwork, as a JSON string. */
  extractPalette(imageUrl: string, isDarkMode: boolean): Promise<string>;
  /** True when any active network uses the VPN transport. */
  isVpnActive(): boolean;
  /** Begins accelerometer shake detection, emitting `onShake` events. */
  startShakeDetection(): void;
  /** Stops accelerometer shake detection. */
  stopShakeDetection(): void;
  /** Shake events emitted by the accelerometer. */
  addListener(eventName: "onShake", listener: () => void): { remove(): void };
  /** Schedules (or reschedules) the exact radio alarm. */
  scheduleAlarm(
    hour: number,
    minute: number,
    daysMask: number,
    stationId: string | null,
    ramp: boolean,
    volume: number
  ): void;
  /** Cancels any pending radio alarm. */
  cancelAlarm(): void;
  /** True when the OS permits exact alarms (Android 12+). */
  canScheduleExactAlarms(): boolean;
  /** Requests the runtime POST_NOTIFICATIONS permission. */
  requestNotificationPermission(): boolean;
  /** Returns alarm launch details when launched from the alarm, else null. */
  consumeAlarmLaunch(): string | null;
  /** Checks GitHub releases for a newer APK, returning a JSON string. */
  checkForUpdate(currentVersion: string): Promise<string>;
  /** Downloads the update APK and opens the system installer when complete. */
  downloadAndInstallUpdate(apkUrl: string, apkName: string): void;
  /** Pushes the current station/show/playing state to the home screen widget. */
  updateWidgetState(stationTitle: string, showTitle: string, isPlaying: boolean): void;
  /** True when the app was launched by the widget's play/pause button. */
  consumeWidgetToggle(): boolean;
  /** Pushes phone state to the Wear OS companion. */
  pushWearState(payloadJson: string): void;
  /** Wear OS state events forwarded from the watch. */
  addListener(
    eventName: "onWearState",
    listener: (event: { payload: string }) => void
  ): { remove(): void };
  /** Stores the subscription snapshot used by the background worker. */
  syncBackgroundSubscriptions(subscriptionsJson: string): void;
  /** Schedules (or cancels, when intervalMinutes is 0) the periodic new-episode check. */
  scheduleBackgroundSync(intervalMinutes: number, wifiOnly: boolean): void;
}

export default requireNativeModule<NativeAndroidModule>('NativeAndroid');
