import { Preferences, type LastFmScrobbleEntry } from "../storage/preferences";

/**
 * Last.fm requires every authenticated call to carry api_sig, an MD5 over the
 * request parameters plus a shared secret. That secret cannot live in this app:
 * Expo inlines EXPO_PUBLIC_* into the JS bundle, so it is extractable from any
 * build. The signing therefore happens in firstfmProxy, which holds the secret.
 *
 * The API key itself is not secret — Last.fm requires it to be public so the
 * browser auth flow can work — and is the only credential still shipped here.
 */
const PROXY_URL = (process.env.EXPO_PUBLIC_LASTFM_PROXY_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.EXPO_PUBLIC_LASTFM_API_KEY || "";
export const LASTFM_CALLBACK = "bbcradioplayer://lastfm-auth";

/** Normalised proxy base URL, or "" when this build has no proxy configured. */
export const LASTFM_PROXY_URL = PROXY_URL;

async function request(method: string, params: Record<string, string>): Promise<any> {
  if (!PROXY_URL) {
    throw new Error("Last.fm scrobbling is not configured in this build");
  }

  const response = await fetch(`${PROXY_URL}/lastfm/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "BritishRadioPlayer/1.0"
    },
    body: JSON.stringify(params)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMsg = data?.message || `Last.fm request failed (${response.status})`;
    console.warn(`[LastFmApi] ${method} failed (${response.status}): ${errorMsg}`);
    throw withStatus(new Error(errorMsg), response.status);
  }
  // Last.fm reports API-level errors (e.g. an invalid session key) in a body with
  // either a 4xx or a 200 status, and the proxy passes them through. Treat them as
  // failures, and keep the status so the outbox can tell a permanent rejection (bad
  // key, missing route) from a transient one.
  if (data && typeof data === "object" && "error" in data) {
    console.warn(`[LastFmApi] ${method} failed (${data.error}): ${data.message}`);
    throw withStatus(new Error(data.message || `Last.fm error ${data.error}`), 400);
  }
  return data;
}

/** Tags an error with its HTTP status so retry policy can distinguish 4xx from 5xx. */
function withStatus(error: Error, status: number): Error {
  (error as Error & { status?: number }).status = status;
  return error;
}

const inFlightExchanges = new Map<string, Promise<{ username: string; sessionKey: string }>>();

export const LastFmApi = {
  isConfigured: () => Boolean(PROXY_URL && API_KEY),
  authUrl: () => `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(API_KEY)}&cb=${encodeURIComponent(LASTFM_CALLBACK)}`,
  async exchangeToken(token: string): Promise<{ username: string; sessionKey: string }> {
    const existing = inFlightExchanges.get(token);
    if (existing) return existing;

    const exchangePromise = (async () => {
      const result = await request("auth.getSession", { token });
      if (!result.session?.name || !result.session.key) {
        throw new Error(result.message || "Last.fm authentication failed");
      }
      return { username: result.session.name, sessionKey: result.session.key };
    })();

    inFlightExchanges.set(token, exchangePromise);
    try {
      return await exchangePromise;
    } finally {
      setTimeout(() => inFlightExchanges.delete(token), 10000);
    }
  },
  async updateNowPlaying(artist: string, track: string, durationSec?: number, album?: string): Promise<void> {
    const sessionKey = Preferences.getLastFm().sessionKey;
    if (!sessionKey) return;
    try {
      await request("track.updateNowPlaying", {
        artist,
        track,
        sk: sessionKey,
        ...(album ? { album } : {}),
        ...(durationSec && durationSec > 0 ? { duration: String(durationSec) } : {})
      });
      console.log(`[LastFmApi] Now playing updated: ${artist} - ${track}`);
    } catch (err) {
      console.warn(`[LastFmApi] Failed to update now playing:`, err);
      throw err;
    }
  },
  async scrobble(artist: string, track: string, timestampSec: number, album?: string, durationSec?: number): Promise<boolean> {
    const sessionKey = Preferences.getLastFm().sessionKey;
    if (!sessionKey) return false;
    try {
      const result = await request("track.scrobble", {
        artist,
        track,
        sk: sessionKey,
        timestamp: String(timestampSec),
        ...(album ? { album } : {}),
        ...(durationSec && durationSec > 0 ? { duration: String(durationSec) } : {})
      });

      // With format=json Last.fm returns scrobbles.scrobble as an array, so the
      // ignoredMessage path is an array index rather than a bare property.
      const ignored = result?.scrobbles?.["@attr"]?.ignored;
      if (ignored && Number(ignored) > 0) {
        const first = Array.isArray(result?.scrobbles?.scrobble)
          ? result.scrobbles.scrobble[0]
          : result?.scrobbles?.scrobble;
        const rawMessage = first?.ignoredMessage;
        const ignoredMsg =
          (typeof rawMessage === "object" ? rawMessage?.["#text"] : rawMessage) ||
          "Track ignored by Last.fm";
        console.warn(`[LastFmApi] Scrobble ignored by Last.fm (${ignoredMsg}): ${artist} - ${track}`);
        return false;
      }

      console.log(`[LastFmApi] Successfully scrobbled: ${artist} - ${track}`);
      return true;
    } catch (err) {
      console.warn(`[LastFmApi] Failed to scrobble ${artist} - ${track}:`, err);
      throw err;
    }
  },
  async fetchRecentScrobbles(username: string, limit = 5): Promise<LastFmScrobbleEntry[]> {
    if (!username || !API_KEY) return [];
    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks&user=${encodeURIComponent(username)}&api_key=${encodeURIComponent(API_KEY)}&limit=${limit}&format=json`;
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "BritishRadioPlayer/1.0"
        }
      });
      if (!response.ok) return [];
      const data = await response.json().catch(() => null);
      const rawTracks = data?.recenttracks?.track;
      if (!rawTracks) return [];
      const trackList = Array.isArray(rawTracks) ? rawTracks : [rawTracks];
      const entries: LastFmScrobbleEntry[] = [];
      for (const t of trackList) {
        if (t?.["@attr"]?.nowplaying === "true") continue;
        const artist = (typeof t.artist === "object" ? t.artist?.["#text"] || t.artist?.name : t.artist) || "";
        const track = t.name || "";
        const timeSec = Number(t.date?.uts);
        const timestampMs = Number.isFinite(timeSec) && timeSec > 0 ? timeSec * 1000 : 0;
        if (artist && track) {
          entries.push({ artist, track, timestampMs });
        }
        if (entries.length >= limit) break;
      }
      return entries;
    } catch (err) {
      console.warn("[LastFmApi] Failed to fetch recent scrobbles:", err);
      return [];
    }
  }
};
