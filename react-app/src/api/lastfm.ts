import * as Linking from "expo-linking";
import { Preferences } from "../storage/preferences";

const API_URL = "https://ws.audioscrobbler.com/2.0/";
const API_KEY = process.env.EXPO_PUBLIC_LASTFM_API_KEY || "";
const API_SECRET = process.env.EXPO_PUBLIC_LASTFM_API_SECRET || "";
export const LASTFM_CALLBACK = Linking.createURL("lastfm-auth");

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
    headers: post ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: post ? body : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMsg = data?.message || `Last.fm request failed (${response.status})`;
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
  async updateNowPlaying(artist: string, track: string, durationSec?: number): Promise<void> {
    const sessionKey = Preferences.getLastFm().sessionKey;
    if (!sessionKey) return;
    await request("track.updateNowPlaying", {
      artist, track, sk: sessionKey,
      ...(durationSec ? { duration: String(durationSec) } : {})
    }, true);
  },
  async scrobble(artist: string, track: string, timestampSec: number): Promise<void> {
    const sessionKey = Preferences.getLastFm().sessionKey;
    if (!sessionKey) return;
    await request("track.scrobble", {
      artist, track, sk: sessionKey, timestamp: String(timestampSec)
    }, true);
    Preferences.setLastFmLastScrobbled(`${artist} - ${track}`);
  }
};
