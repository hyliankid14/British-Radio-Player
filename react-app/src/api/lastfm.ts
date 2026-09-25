import * as Linking from "expo-linking";
import { Preferences } from "../storage/preferences";

const API_URL = "https://ws.audioscrobbler.com/2.0/";
const API_KEY = process.env.EXPO_PUBLIC_LASTFM_API_KEY || "";
const API_SECRET = process.env.EXPO_PUBLIC_LASTFM_API_SECRET || "";
export const LASTFM_CALLBACK = "bbcradioplayer://lastfm-auth";

import SparkMD5 from "spark-md5";

function signature(params: Record<string, string>): string {
  const input = Object.keys(params)
    .filter((key) => key !== "format" && key !== "callback")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("") + API_SECRET;
  return SparkMD5.hash(input);
}

async function request(method: string, params: Record<string, string>, post = false): Promise<any> {
  const signed: Record<string, string> = { method, api_key: API_KEY, ...params };
  signed.api_sig = signature(signed);
  signed.format = "json";
  const body = Object.entries(signed)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const response = await fetch(post ? API_URL : `${API_URL}?${body}`, {
    method: post ? "POST" : "GET",
    headers: {
      "User-Agent": "BritishRadioPlayer/1.0",
      ...(post ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : {})
    },
    body: post ? body : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || (data && typeof data === "object" && "error" in data)) {
    const errorMsg = data?.message || `Last.fm request failed (${response.status})`;
    console.warn(`[LastFmApi] ${method} failed (${data?.error || response.status}): ${errorMsg}`);
    throw new Error(errorMsg);
  }
  return data;
}

const inFlightExchanges = new Map<string, Promise<{ username: string; sessionKey: string }>>();

export const LastFmApi = {
  isConfigured: () => Boolean(API_KEY && API_SECRET),
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
      }, true);
      console.log(`[LastFmApi] Now playing updated: ${artist} - ${track}`);
    } catch (err) {
      console.warn(`[LastFmApi] Failed to update now playing:`, err);
      throw err;
    }
  },
  async scrobble(artist: string, track: string, timestampSec: number, album?: string, durationSec?: number, stationName?: string): Promise<boolean> {
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
      }, true);

      const ignored = result?.scrobbles?.["@attr"]?.ignored;
      if (ignored && Number(ignored) > 0) {
        const ignoredMsg = result?.scrobbles?.scrobble?.ignoredMessage?.["#text"] || "Track ignored by Last.fm";
        console.warn(`[LastFmApi] Scrobble ignored by Last.fm (${ignoredMsg}): ${artist} - ${track}`);
        return false;
      }

      console.log(`[LastFmApi] Successfully scrobbled: ${artist} - ${track}`);
      Preferences.addLastFmRecentScrobble({
        artist,
        track,
        stationName: stationName || album,
        timestampMs: timestampSec * 1000
      });
      return true;
    } catch (err) {
      console.warn(`[LastFmApi] Failed to scrobble ${artist} - ${track}:`, err);
      throw err;
    }
  }
};
