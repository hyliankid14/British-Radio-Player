// Native bridge for the Android Auto media service (Android only).
import { NativeModule, requireNativeModule } from 'expo';

export type AutoNativeEvent = { type: string; payload: string };

declare class AndroidAutoBridgeModule extends NativeModule<{
  onAutoEvent: (event: AutoNativeEvent) => void;
}> {
  /** Persists the catalogue/preference snapshot produced by JS. */
  syncState(json: string): boolean;
  /** Returns the last snapshot written by JS (empty object when none). */
  getState(): string;
  /** Returns and clears queued native mutations, as a JSON array string. */
  drainMutations(): string;
  /** Clears all persisted Auto state. */
  clearState(): boolean;
  /** Tells the native Auto player to yield because phone playback has started. */
  notifyPhonePlaybackStarted(): boolean;
}

export default requireNativeModule<AndroidAutoBridgeModule>('AndroidAutoBridge');
