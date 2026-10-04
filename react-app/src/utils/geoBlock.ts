export const UK_STREAM_PROBE_URL =
  "https://as-hls-uk.live.cf.md.bbci.co.uk/pool_01505109/live/uk/bbc_radio_one/bbc_radio_one.isml/bbc_radio_one-audio%3d320000.norewind.m3u8";

export const NONUK_STREAM_PROBE_URL =
  "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf/bbc_radio_one.m3u8";

export const UK_ONLY_STATION_IDS = new Set([
  "radio5livesportsextra2",
  "radio5livesportsextra3",
  // BBC Sounds exclusive, so BBC publishes no international simulcast feed for it.
  "radio6indieforever"
]);

/** Stations with frequent event-driven rights restrictions outside the UK */
export const RIGHTS_RESTRICTED_STATION_IDS = new Set([
  "radio5live",
  "radio5livesportsextra",
  "radio5livesportsextra2",
  "radio5livesportsextra3"
]);

export interface GeoBlockedStorage {
  getGeoBlocked: () => boolean;
  setGeoBlocked: (val: boolean) => void;
}

let inMemoryGeoBlocked = false;
let storageDelegate: GeoBlockedStorage | null = null;

export function configureGeoBlockedStorage(storage: GeoBlockedStorage | null): void {
  storageDelegate = storage;
}

export function getGeoBlockedState(): boolean {
  return storageDelegate ? storageDelegate.getGeoBlocked() : inMemoryGeoBlocked;
}

export function setGeoBlockedState(val: boolean): void {
  inMemoryGeoBlocked = val;
  if (storageDelegate) {
    storageDelegate.setGeoBlocked(val);
  }
}

let lastProbeTime = 0;
let inFlightProbe: Promise<boolean> | null = null;
const PROBE_CACHE_TTL_MS = 60_000; // Cache for 60 seconds

/**
 * Checks whether a given station is strictly UK-only with no international broadcast streams.
 */
export function isStationUkOnly(stationId: string): boolean {
  return UK_ONLY_STATION_IDS.has(stationId);
}

/**
 * Checks whether a station is a sports station subject to event-driven regional broadcast blackouts.
 */
export function isSportsStation(stationId: string): boolean {
  return RIGHTS_RESTRICTED_STATION_IDS.has(stationId);
}

/**
 * Probes the BBC UK stream endpoint to determine if the client is subject to regional geo-blocking.
 *
 * BBC's UK HLS streams (as-hls-uk) enforce CDN-level geo-fencing and return HTTP 403 Forbidden to
 * non-UK clients (such as those in Canada).
 *
 * @param force If true, bypasses the in-memory cache and forces a fresh network probe.
 * @returns true if the client appears to be outside the UK / geo-blocked, false otherwise.
 */
export async function probeGeoBlock(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && inFlightProbe) {
    return inFlightProbe;
  }
  if (!force && lastProbeTime > 0 && now - lastProbeTime < PROBE_CACHE_TTL_MS) {
    return getGeoBlockedState();
  }
  // A forced probe used to skip the in-flight guard, so two overlapping probes could race
  // and the first to finish would clear `inFlightProbe` while the second was still running.
  if (inFlightProbe) return inFlightProbe;

  inFlightProbe = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      try {
        const res = await fetch(UK_STREAM_PROBE_URL, {
          method: "HEAD",
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        // If the UK stream returns 403 Forbidden, the user is definitively geo-blocked
        if (res.status === 403 || res.status === 401) {
          setGeoBlockedState(true);
          lastProbeTime = Date.now();
          return true;
        }

        // If 200 OK, user is in the UK and has direct access
        if (res.ok) {
          setGeoBlockedState(false);
          lastProbeTime = Date.now();
          return false;
        }
      } catch {
        clearTimeout(timeoutId);
        // If abort/timeout or network error, let's verify if general internet is up
        // by pinging the non-UK manifest endpoint
        try {
          const fallbackRes = await fetch(NONUK_STREAM_PROBE_URL, {
            method: "HEAD",
            signal: AbortSignal.timeout(2000)
          });
          if (fallbackRes.ok) {
            // General internet and non-UK manifest are accessible, but UK stream was unreachable/blocked!
            setGeoBlockedState(true);
            lastProbeTime = Date.now();
            return true;
          }
        } catch {
          // Device may be offline, keep existing preference
        }
      }

      // Stamp the attempt on every exit path, including failure. Leaving `lastProbeTime`
      // unset on failure meant the TTL check never applied to a failing probe, so each
      // NetInfo event while offline started two more requests with 2.5s and 2s timeouts.
      lastProbeTime = Date.now();
      return getGeoBlockedState();
    } finally {
      inFlightProbe = null;
    }
  })();

  return inFlightProbe;
}
