import { AppState, AppStateStatus, Platform } from "react-native";
import { Preferences } from "../storage/preferences";
import { buildCloudSyncPayload, mergeAndApplyCloudSync } from "./syncPayload";
import { ICloudKvsAdapter } from "./adapters/iCloudKvsAdapter";
import { GoogleDriveAdapter } from "./adapters/googleDriveAdapter";
import type { CloudSyncAdapter } from "./adapters/cloudSyncAdapter";

const SYNC_DEBOUNCE_MS = 1500;
const PROGRESS_THROTTLE_MS = 30_000;
const HIGH_FREQUENCY_KEYS = new Set(["pref_episode_progress"]);
const DEVICE_ID = Platform.OS === "ios" ? "ios-device" : "android-device";

export interface CloudSyncStatus {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  adapterName: string | null;
  isEnabled: boolean;
}

type SyncStatusListener = (status: CloudSyncStatus) => void;

let activeAdapter: CloudSyncAdapter | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let changeSubscription: { remove: () => void } | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let isSyncing = false;
let lastProgressSyncAtMs = 0;
let started = false;

const listeners = new Set<SyncStatusListener>();

function getActiveAdapter(): CloudSyncAdapter | null {
  if (Platform.OS === "ios") return ICloudKvsAdapter;
  // Android uses the OS Storage Access Framework (system Save to Drive / Document Picker)
  // for zero-login, verification-free cloud backup.
  return null;
}

function notifyListeners(): void {
  const status = CloudSyncManager.getStatus();
  listeners.forEach((listener) => {
    try {
      listener(status);
    } catch (e) {
      console.warn("[CloudSyncManager] Listener error:", e);
    }
  });
}

export const CloudSyncManager = {
  init(): void {
    if (started) return;
    activeAdapter = getActiveAdapter();
    if (!activeAdapter || !activeAdapter.isAvailable()) return;
    started = true;

    // Listen to local storage changes to trigger debounced push
    changeSubscription = Preferences.onChanged((key) => {
      this.schedulePush(key);
    });

    // Check remote changes on app resume
    appStateSubscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") {
        void this.syncNow();
      }
    });

    // Periodic check for inbound iCloud / Drive updates
    pollTimer = setInterval(() => {
      if (!isSyncing && activeAdapter?.isEnabled()) {
        void this.drainInbound();
      }
    }, 10_000);

    // Initial sync
    void this.syncNow();
  },

  getStatus(): CloudSyncStatus {
    const adapter = activeAdapter || getActiveAdapter();
    return {
      isSyncing,
      lastSyncedAt: adapter?.getLastSyncedAt() ?? null,
      adapterName: adapter ? (adapter.id === "icloud" ? "iCloud" : "Google Drive") : null,
      isEnabled: adapter?.isEnabled() ?? false
    };
  },

  subscribe(listener: SyncStatusListener): () => void {
    listeners.add(listener);
    listener(this.getStatus());
    return () => {
      listeners.delete(listener);
    };
  },

  schedulePush(changedKey?: string): void {
    const adapter = activeAdapter || getActiveAdapter();
    if (!adapter || !adapter.isEnabled()) return;

    if (changedKey && HIGH_FREQUENCY_KEYS.has(changedKey)) {
      const now = Date.now();
      if (now - lastProgressSyncAtMs < PROGRESS_THROTTLE_MS) return;
      lastProgressSyncAtMs = now;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void this.pushCurrentState();
    }, SYNC_DEBOUNCE_MS);
  },

  async drainInbound(): Promise<boolean> {
    const adapter = activeAdapter || getActiveAdapter();
    if (!adapter || !adapter.isEnabled()) return false;

    try {
      const remote = await adapter.drainReceivedPayload();
      if (remote) {
        mergeAndApplyCloudSync(remote, DEVICE_ID, Preferences);
        notifyListeners();
        return true;
      }
    } catch (error) {
      console.warn("[CloudSyncManager] drainInbound failed:", error);
    }
    return false;
  },

  async pushCurrentState(): Promise<boolean> {
    const adapter = activeAdapter || getActiveAdapter();
    if (!adapter || !adapter.isEnabled()) return false;

    try {
      const payload = buildCloudSyncPayload(DEVICE_ID, Preferences);
      const success = await adapter.pushPayload(payload);
      if (success) {
        notifyListeners();
      }
      return success;
    } catch (error) {
      console.warn("[CloudSyncManager] pushCurrentState failed:", error);
      return false;
    }
  },

  async syncNow(): Promise<boolean> {
    const adapter = activeAdapter || getActiveAdapter();
    if (!adapter || !adapter.isEnabled()) return false;
    if (isSyncing) return false;

    isSyncing = true;
    notifyListeners();

    try {
      // 1. Ingest any remote changes first
      await this.drainInbound();

      // 2. Push merged state back up
      const payload = buildCloudSyncPayload(DEVICE_ID, Preferences);
      const success = await adapter.pushPayload(payload);
      return success;
    } catch (error) {
      console.warn("[CloudSyncManager] syncNow failed:", error);
      return false;
    } finally {
      isSyncing = false;
      notifyListeners();
    }
  },

  dispose(): void {
    changeSubscription?.remove();
    appStateSubscription?.remove();
    if (pollTimer) clearInterval(pollTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    changeSubscription = null;
    appStateSubscription = null;
    pollTimer = null;
    debounceTimer = null;
    listeners.clear();
    started = false;
  }
};
