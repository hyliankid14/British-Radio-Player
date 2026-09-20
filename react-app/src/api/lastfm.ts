import * as Linking from "expo-linking";
import { Preferences } from "../storage/preferences";

const API_URL = "https://ws.audioscrobbler.com/2.0/";
const API_KEY = process.env.EXPO_PUBLIC_LASTFM_API_KEY || "";
const API_SECRET = process.env.EXPO_PUBLIC_LASTFM_API_SECRET || "";
export const LASTFM_CALLBACK = Linking.createURL("lastfm-auth");

function md5(input: string): string {
  const bytes = unescape(encodeURIComponent(input)).split("").map((character) => character.charCodeAt(0));
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
  }
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (bitLength % 32));
  words[(((bitLength + 64) >>> 9) << 4) + 14] = bitLength;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const rotate = (value: number, amount: number) => (value << amount) | (value >>> (32 - amount));
  const add = (x: number, y: number) => (x + y) | 0;
  const ff = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const gg = (x: number, y: number, z: number) => (x & z) | (y & ~z);
  const hh = (x: number, y: number, z: number) => x ^ y ^ z;
  const ii = (x: number, y: number, z: number) => y ^ (x | ~z);
  const step = (
    fn: (x: number, y: number, z: number) => number,
    current: number,
    x: number,
    shift: number,
    constant: number,
    value: number
  ) => add(rotate(add(add(current, fn(b, c, d)), add(x, constant)), shift), value);

  for (let offset = 0; offset < words.length; offset += 16) {
    const oldA = a;
    const oldB = b;
    const oldC = c;
    const oldD = d;
    a = step(ff, a, words[offset], 7, -680876936, b);
    d = step(ff, d, words[offset + 1], 12, -389564586, a);
    c = step(ff, c, words[offset + 2], 17, 606105819, d);
    b = step(ff, b, words[offset + 3], 22, -1044525330, c);
    a = step(ff, a, words[offset + 4], 7, -176418897, b);
    d = step(ff, d, words[offset + 5], 12, 1200080426, a);
    c = step(ff, c, words[offset + 6], 17, -1473231341, d);
    b = step(ff, b, words[offset + 7], 22, -45705983, c);
    a = step(ff, a, words[offset + 8], 7, 1770035416, b);
    d = step(ff, d, words[offset + 9], 12, -1958414417, a);
    c = step(ff, c, words[offset + 10], 17, -42063, d);
    b = step(ff, b, words[offset + 11], 22, -1990404162, c);
    a = step(ff, a, words[offset + 12], 7, 1804603682, b);
    d = step(ff, d, words[offset + 13], 12, -40341101, a);
    c = step(ff, c, words[offset + 14], 17, -1502002290, d);
    b = step(ff, b, words[offset + 15], 22, 1236535329, c);
    a = step(gg, a, words[offset + 1], 5, -165796510, b);
    d = step(gg, d, words[offset + 6], 9, -1069501632, a);
    c = step(gg, c, words[offset + 11], 14, 643717713, d);
    b = step(gg, b, words[offset], 20, -373897302, c);
    a = step(gg, a, words[offset + 5], 5, -701558691, b);
    d = step(gg, d, words[offset + 10], 9, 38016083, a);
    c = step(gg, c, words[offset + 15], 14, -660478335, d);
    b = step(gg, b, words[offset + 4], 20, -405537848, c);
    a = step(gg, a, words[offset + 9], 5, 568446438, b);
    d = step(gg, d, words[offset + 14], 9, -1019803690, a);
    c = step(gg, c, words[offset + 3], 14, -187363961, d);
    b = step(gg, b, words[offset + 8], 20, 1163531501, c);
    a = step(gg, a, words[offset + 13], 5, -1444681467, b);
    d = step(gg, d, words[offset + 2], 9, -51403784, a);
    c = step(gg, c, words[offset + 7], 14, 1735328473, d);
    b = step(gg, b, words[offset + 12], 20, -1926607734, c);
    a = step(hh, a, words[offset + 5], 4, -378558, b);
    d = step(hh, d, words[offset + 8], 11, -2022574463, a);
    c = step(hh, c, words[offset + 11], 16, 1839030562, d);
    b = step(hh, b, words[offset + 14], 23, -35309556, c);
    a = step(hh, a, words[offset + 1], 4, -1530992060, b);
    d = step(hh, d, words[offset + 4], 11, 1272893353, a);
    c = step(hh, c, words[offset + 7], 16, -155497632, d);
    b = step(hh, b, words[offset + 10], 23, -1094730640, c);
    a = step(hh, a, words[offset + 13], 4, 681279174, b);
    d = step(hh, d, words[offset], 11, -358537222, a);
    c = step(hh, c, words[offset + 3], 16, -722521979, d);
    b = step(hh, b, words[offset + 6], 23, 76029189, c);
    a = step(hh, a, words[offset + 9], 4, -640364487, b);
    d = step(hh, d, words[offset + 12], 11, -421815835, a);
    c = step(hh, c, words[offset + 15], 16, 530742520, d);
    b = step(hh, b, words[offset + 2], 23, -995338651, c);
    a = step(ii, a, words[offset], 6, -198630844, b);
    d = step(ii, d, words[offset + 7], 10, 1126891415, a);
    c = step(ii, c, words[offset + 14], 15, -1416354905, d);
    b = step(ii, b, words[offset + 5], 21, -57434055, c);
    a = step(ii, a, words[offset + 12], 6, 1700485571, b);
    d = step(ii, d, words[offset + 3], 10, -1894986606, a);
    c = step(ii, c, words[offset + 10], 15, -1051523, d);
    b = step(ii, b, words[offset + 1], 21, -2054922799, c);
    a = add(a, oldA);
    b = add(b, oldB);
    c = add(c, oldC);
    d = add(d, oldD);
  }

  return [a, b, c, d]
    .flatMap((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0")))
    .join("");
}

async function signature(params: Record<string, string>): Promise<string> {
  const input = Object.keys(params)
    .filter((key) => key !== "format" && key !== "callback")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("") + API_SECRET;
  return md5(input);
}

async function request(method: string, params: Record<string, string>, post = false): Promise<any> {
  const signed: Record<string, string> = { method, api_key: API_KEY, ...params };
  signed.api_sig = await signature(signed);
  signed.format = "json";
  const body = Object.entries(signed)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const response = await fetch(post ? API_URL : `${API_URL}?${body}`, {
    method: post ? "POST" : "GET",
    headers: post ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: post ? body : undefined
  });
  if (!response.ok) throw new Error(`Last.fm request failed (${response.status})`);
  return response.json();
}

export const LastFmApi = {
  isConfigured: () => Boolean(API_KEY && API_SECRET),
  authUrl: () => `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(API_KEY)}&cb=${encodeURIComponent(LASTFM_CALLBACK)}`,
  async exchangeToken(token: string): Promise<{ username: string; sessionKey: string }> {
    const result = await request("auth.getSession", { token });
    if (!result.session?.name || !result.session.key) {
      throw new Error(result.message || "Last.fm authentication failed");
    }
    return { username: result.session.name, sessionKey: result.session.key };
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
