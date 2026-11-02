import { Platform } from "react-native";
import { Preferences } from "../../storage/preferences";
import type { CloudSyncAdapter } from "./cloudSyncAdapter";
import type { CloudSyncPayload } from "../syncTypes";

const GDRIVE_ENABLED_KEY = "pref_gdrive_sync_enabled";
const GDRIVE_ACCOUNT_KEY = "pref_gdrive_account_name";
const GDRIVE_TOKEN_KEY = "pref_gdrive_access_token";
const GDRIVE_FILE_ID_KEY = "pref_gdrive_file_id";
const GDRIVE_LAST_SYNCED_KEY = "pref_gdrive_last_synced_at";

const SYNC_FILE_NAME = "bbcradioplayer_sync.json";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

export interface GoogleDriveAuthState {
  enabled: boolean;
  accountName: string | null;
  lastSyncedAt: string | null;
}

async function findSyncFileId(token: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`name = '${SYNC_FILE_NAME}' and trashed = false`);
    const url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { files?: Array<{ id: string }> };
    return data.files?.[0]?.id || null;
  } catch {
    return null;
  }
}

export const GoogleDriveAdapter: CloudSyncAdapter & {
  getAuthState(): GoogleDriveAuthState;
  setAuthorizedSession(accountName: string, accessToken: string): void;
  disconnect(): void;
} = {
  id: "googledrive",

  isAvailable(): boolean {
    return Platform.OS === "android";
  },

  isEnabled(): boolean {
    return this.isAvailable() && Preferences.getSetting<boolean>(GDRIVE_ENABLED_KEY, false);
  },

  getAuthState(): GoogleDriveAuthState {
    const accountName = Preferences.getSetting<string>(GDRIVE_ACCOUNT_KEY, "");
    return {
      enabled: this.isEnabled(),
      accountName: accountName ? accountName : null,
      lastSyncedAt: this.getLastSyncedAt()
    };
  },

  setAuthorizedSession(accountName: string, accessToken: string): void {
    Preferences.setSetting(GDRIVE_ACCOUNT_KEY, accountName);
    Preferences.setSetting(GDRIVE_TOKEN_KEY, accessToken);
    Preferences.setSetting(GDRIVE_ENABLED_KEY, true);
  },

  disconnect(): void {
    Preferences.setSetting(GDRIVE_ENABLED_KEY, false);
    Preferences.removeSetting(GDRIVE_ACCOUNT_KEY);
    Preferences.removeSetting(GDRIVE_TOKEN_KEY);
    Preferences.removeSetting(GDRIVE_FILE_ID_KEY);
  },

  getLastSyncedAt(): string | null {
    const last = Preferences.getSetting<string>(GDRIVE_LAST_SYNCED_KEY, "");
    return last || null;
  },

  async pushPayload(payload: CloudSyncPayload): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const token = Preferences.getSetting<string>(GDRIVE_TOKEN_KEY, "");
    if (!token) return false;

    try {
      let fileId = Preferences.getSetting<string>(GDRIVE_FILE_ID_KEY, "") || null;
      const jsonContent = JSON.stringify(payload);

      if (!fileId) {
        fileId = await findSyncFileId(token);
      }

      if (fileId) {
        // Update existing file in appDataFolder
        const res = await fetch(`${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: jsonContent
        });
        if (!res.ok) {
          if (res.status === 404) {
            Preferences.removeSetting(GDRIVE_FILE_ID_KEY);
            return this.pushPayload(payload);
          }
          return false;
        }
      } else {
        // Create new file in appDataFolder
        const boundary = "-------314159265358979323846";
        const metadata = JSON.stringify({
          name: SYNC_FILE_NAME,
          parents: ["appDataFolder"]
        });

        const body =
          `--${boundary}\r\n` +
          "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
          `${metadata}\r\n` +
          `--${boundary}\r\n` +
          "Content-Type: application/json\r\n\r\n" +
          `${jsonContent}\r\n` +
          `--${boundary}--`;

        const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`
          },
          body
        });

        if (!res.ok) return false;
        const data = (await res.json()) as { id?: string };
        if (data.id) {
          Preferences.setSetting(GDRIVE_FILE_ID_KEY, data.id);
        }
      }

      const now = new Date().toISOString();
      Preferences.setSetting(GDRIVE_LAST_SYNCED_KEY, now);
      return true;
    } catch (error) {
      console.warn("[GoogleDriveAdapter] pushPayload failed:", error);
      return false;
    }
  },

  async drainReceivedPayload(): Promise<CloudSyncPayload | null> {
    if (!this.isEnabled()) return null;
    const token = Preferences.getSetting<string>(GDRIVE_TOKEN_KEY, "");
    if (!token) return null;

    try {
      let fileId = Preferences.getSetting<string>(GDRIVE_FILE_ID_KEY, "") || null;
      if (!fileId) {
        fileId = await findSyncFileId(token);
        if (fileId) Preferences.setSetting(GDRIVE_FILE_ID_KEY, fileId);
      }
      if (!fileId) return null;

      const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;

      const parsed = JSON.parse(text) as CloudSyncPayload;
      if (parsed && parsed.version === 2 && parsed.data) {
        return parsed;
      }
      return null;
    } catch (error) {
      console.warn("[GoogleDriveAdapter] drainReceivedPayload failed:", error);
      return null;
    }
  }
};
