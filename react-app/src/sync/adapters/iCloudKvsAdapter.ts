import { Directory, File, Paths } from "expo-file-system";
import { Platform, Settings } from "react-native";
import { Preferences } from "../../storage/preferences";
import type { CloudSyncAdapter } from "./cloudSyncAdapter";
import type { CloudSyncPayload } from "../syncTypes";

const CLOUD_DIRECTORY = "cloud";
const OUTBOUND_FILE = "cloud_outbound.json";
const RECEIVED_FILE = "cloud_received.json";
const OUTBOUND_REVISION_KEY = "cloud_snapshot_outbound_revision";
const INBOUND_REVISION_KEY = "cloud_snapshot_inbound_revision";
const LAST_SYNCED_KEY = "cloud_last_synced_at";
const LAST_SYNCED_PREF_KEY = "pref_icloud_last_synced_at";

let lastProcessedInboundRevision = -1;

export const ICloudKvsAdapter: CloudSyncAdapter = {
  id: "icloud",

  isAvailable(): boolean {
    return Platform.OS === "ios";
  },

  isEnabled(): boolean {
    return this.isAvailable();
  },

  pushPayload(payload: CloudSyncPayload): boolean {
    if (!this.isAvailable()) return false;
    try {
      const dir = new Directory(Paths.cache, CLOUD_DIRECTORY);
      dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, OUTBOUND_FILE);
      file.create({ intermediates: true, overwrite: true });
      file.write(JSON.stringify(payload));

      const now = new Date().toISOString();
      Preferences.setSetting(LAST_SYNCED_PREF_KEY, now);

      const current = Number(Settings.get(OUTBOUND_REVISION_KEY) ?? 0);
      Settings.set({
        [OUTBOUND_REVISION_KEY]: (Number.isFinite(current) ? current : 0) + 1,
        [LAST_SYNCED_KEY]: now
      });
      return true;
    } catch (error) {
      console.warn("[ICloudKvsAdapter] pushPayload failed:", error);
      return false;
    }
  },

  drainReceivedPayload(): CloudSyncPayload | null {
    if (!this.isAvailable()) return null;
    try {
      const currentInbound = Number(Settings.get(INBOUND_REVISION_KEY) ?? 0);
      if (currentInbound <= 0 || currentInbound === lastProcessedInboundRevision) {
        return null;
      }

      const dir = new Directory(Paths.cache, CLOUD_DIRECTORY);
      const file = new File(dir, RECEIVED_FILE);
      if (!file.exists) return null;

      const content = file.textSync();
      if (!content || content.trim().length === 0) return null;

      const parsed = JSON.parse(content) as CloudSyncPayload;
      if (parsed && parsed.version === 2 && parsed.data) {
        lastProcessedInboundRevision = currentInbound;
        const now = new Date().toISOString();
        Preferences.setSetting(LAST_SYNCED_PREF_KEY, now);
        Settings.set({ [LAST_SYNCED_KEY]: now });
        return parsed;
      }
      return null;
    } catch (error) {
      console.warn("[ICloudKvsAdapter] drainReceivedPayload failed:", error);
      return null;
    }
  },

  getLastSyncedAt(): string | null {
    if (!this.isAvailable()) return null;
    const pref = Preferences.getSetting<string>(LAST_SYNCED_PREF_KEY, "");
    if (pref) return pref;
    const value = Settings.get(LAST_SYNCED_KEY);
    return typeof value === "string" && value.length > 0 ? value : null;
  }
};
