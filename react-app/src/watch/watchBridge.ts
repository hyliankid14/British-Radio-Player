import { Directory, File, Paths } from "expo-file-system";
import { Platform, Settings } from "react-native";

const WATCH_DIRECTORY = "watch";
const STATE_FILE = "state.json";
const RECEIVED_FILE = "received_state.json";
const OUTBOUND_REVISION_KEY = "watch_snapshot_revision";
const INBOUND_REVISION_KEY = "watch_received_revision";

let lastInboundRevision = 0;

export const WatchBridge = {
  isAvailable(): boolean {
    return Platform.OS === "ios";
  },

  syncState(json: string): boolean {
    if (!this.isAvailable()) return false;
    try {
      const dir = new Directory(Paths.cache, WATCH_DIRECTORY);
      dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, STATE_FILE);
      file.create({ intermediates: true, overwrite: true });
      file.write(json);
      const current = Number(Settings.get(OUTBOUND_REVISION_KEY) ?? 0);
      Settings.set({ [OUTBOUND_REVISION_KEY]: (Number.isFinite(current) ? current : 0) + 1 });
      return true;
    } catch {
      return false;
    }
  },

  drainReceivedState(): string | null {
    if (!this.isAvailable()) return null;
    const current = Number(Settings.get(INBOUND_REVISION_KEY) ?? 0);
    if (current === lastInboundRevision) return null;
    try {
      const dir = new Directory(Paths.cache, WATCH_DIRECTORY);
      const file = new File(dir, RECEIVED_FILE);
      if (!file.exists) return null;
      const content = file.textSync();
      lastInboundRevision = current;
      return content || null;
    } catch {
      return null;
    }
  }
};
