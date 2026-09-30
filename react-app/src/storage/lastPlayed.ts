/**
 * The single authoritative record of what the listener started most recently, shared by the
 * phone, Android Auto and CarPlay. `kind` distinguishes radio from podcast playback so the
 * in-car resume can restart the right thing instead of guessing from a bare station id.
 */
export interface LastPlayed {
  kind: "station" | "episode";
  id: string;
  podcastId: string;
  atMs: number;
}

/**
 * Parses the stored last-played record.
 *
 * Installs that predate this record fall back to the last radio station so their in-car
 * resume is unchanged. Returns null when neither is usable.
 */
export function parseLastPlayed(
  raw: string | undefined,
  legacyStationId: string | undefined
): LastPlayed | null {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<LastPlayed> | null;
      const id = typeof parsed?.id === "string" ? parsed.id.trim() : "";
      if (id) {
        return {
          kind: parsed?.kind === "episode" ? "episode" : "station",
          id,
          podcastId: typeof parsed?.podcastId === "string" ? parsed.podcastId : "",
          atMs: typeof parsed?.atMs === "number" && parsed.atMs > 0 ? parsed.atMs : 0
        };
      }
    } catch {
      // Fall through to the legacy station fallback.
    }
  }
  const legacy = typeof legacyStationId === "string" ? legacyStationId.trim() : "";
  if (legacy) return { kind: "station", id: legacy, podcastId: "", atMs: 0 };
  return null;
}

/** Builds the record to persist, stamping the time when the caller does not supply one. */
export function normalizeLastPlayed(
  record: Omit<LastPlayed, "atMs"> & { atMs?: number },
  nowMs: number = Date.now()
): LastPlayed | null {
  const id = String(record?.id || "").trim();
  if (!id) return null;
  return {
    kind: record.kind === "episode" ? "episode" : "station",
    id,
    podcastId: String(record.podcastId || "").trim(),
    atMs: typeof record.atMs === "number" && record.atMs > 0 ? record.atMs : nowMs
  };
}
