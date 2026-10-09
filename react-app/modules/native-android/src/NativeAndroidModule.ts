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
  /** Cancels the currently ringing alarm notification. */
  cancelAlarmNotification(): void;
  /** True when the OS permits exact alarms (Android 12+). */
  canScheduleExactAlarms(): boolean;
  /** Requests the runtime POST_NOTIFICATIONS permission. */
  requestNotificationPermission(): boolean;
  /** Returns alarm launch details when launched from the alarm, else null. */
  consumeAlarmLaunch(): string | null;
  /** Alarm launch events emitted when an alarm notification is tapped while the app is running. */
  addListener(
    eventName: "onAlarmLaunch",
    listener: (event: { alarm: string }) => void
  ): { remove(): void };
  /** Checks GitHub releases for a newer APK, returning a JSON string. */
  checkForUpdate(currentVersion: string): Promise<string>;
  /** Downloads the update APK and opens the system installer when complete. */
  downloadAndInstallUpdate(apkUrl: string, apkName: string): void;
  /** Returns the file:// URI of the cached custom station ident PNG, or null. */
  getStationIdentUri(stationId: string): string | null;
  /** Pushes the current station/show/playing state to the home screen widgets. */
  updateWidgetState(
    stationId: string,
    stationTitle: string,
    showLine: string,
    isPlaying: boolean,
    artworkUrl: string
  ): void;
  /** Stores the station catalogue the widget's station picker offers, as JSON. */
  setWidgetCatalogue(stationsJson: string): void;
  /** Returns the queued widget tap as `{"action","stationId"}`, or "" when there was none. */
  consumeWidgetAction(): string;
  /** Widget tap events emitted while the app is running in background or foreground. */
  addListener(
    eventName: "onWidgetAction",
    listener: (event: { action: string }) => void
  ): { remove(): void };
  /** Returns the deep link or target URL when launched from a notification intent, else null. */
  consumeNotificationLaunch(): string | null;
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
  /** Returns episode IDs already notified by the native background worker. */
  getBackgroundNotifiedEpisodeIds(): string[];
  /** Marks an episode as notified so the background worker will not duplicate it. */
  markBackgroundEpisodeNotified(episodeId: string): void;
  /** Notification open events emitted when a notification is tapped while the app is running. */
  addListener(
    eventName: "onNotificationOpen",
    listener: (event: { url: string }) => void
  ): { remove(): void };
  /** Absolute path of the public Podcasts folder used for downloads. */
  getDownloadsFolderPath(): string;
  /** Copies a downloaded temp file into the public Podcasts folder; returns its URI. */
  publishDownload(sourceUri: string, fileName: string, title: string): Promise<string | null>;
  /** Deletes a published episode by URI. */
  deleteDownload(uri: string): boolean;
  /** Deletes every episode in the app's public Podcasts folder; returns the count. */
  clearDownloads(): number;
  /** Opens the public Podcasts downloads folder in the system file manager. */
  openDownloadsFolder(): boolean;
  /** Broadcasts track playback state to third-party Android scrobbler apps (SLS, Scrobble Droid, Last.fm). */
  broadcastScrobble(state: number, artist: string, track: string, album: string, durationSec: number): void;
  /** Saves the last 5 scrobbled tracks as JSON to persistent storage (survives reinstalls). */
  savePersistentScrobbles(json: string): void;
  /** Reads persistent scrobbled tracks from persistent storage (survives reinstalls). */
  readPersistentScrobbles(): string | null;
}

export default requireNativeModule<NativeAndroidModule>('NativeAndroid');
