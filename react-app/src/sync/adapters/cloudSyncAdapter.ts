import type { CloudSyncPayload } from "../syncTypes";

export interface CloudSyncAdapter {
  readonly id: "icloud" | "googledrive";
  isAvailable(): boolean;
  isEnabled(): boolean;
  pushPayload(payload: CloudSyncPayload): Promise<boolean> | boolean;
  drainReceivedPayload(): Promise<CloudSyncPayload | null> | CloudSyncPayload | null;
  getLastSyncedAt(): string | null;
}
