import { StationRepository, type Station } from "../data/stations.ts";
import { BoundedCache } from "../utils/boundedCache.ts";

export interface CurrentShow {
  title: string;
  episodeTitle?: string;
  artist?: string;
  track?: string;
  durationSec?: number;
  description?: string;
  imageUrl?: string;
  startTime?: string;
  endTime?: string;
  startTimeMs?: number;
  endTimeMs?: number;
  nextShowTitle?: string;
  nextShowStartTimeMs?: number;
  rawArtist?: string;
  rawTrack?: string;
  rawImageUrl?: string;
  songImageUrl?: string;
}

export interface ScheduleEntry {
  title: string;
  episodeTitle?: string;
  startTimeMs: number;
  endTimeMs: number;
  imageUrl?: string;
}

export function formatShowDisplayTitle(show: CurrentShow): string {
  if (show.artist && show.track) {
    return `${show.artist} - ${show.track}`;
  }
  if (show.track) {
    return show.track;
  }
  if (show.artist) {
    return show.artist;
  }
  if (show.title && show.title !== "BBC Radio") {
    if (show.episodeTitle && show.episodeTitle !== show.title) {
      return `${show.title} — ${show.episodeTitle}`;
    }
    return show.title;
  }
  if (show.episodeTitle) {
    return show.episodeTitle;
  }
  return show.title || "BBC Radio";
}

export interface RmsTrackData {
  artist?: string;
  track?: string;
  imageUrl?: string;
  durationSec?: number;
}

interface StationRmsDelayState {
  applied: RmsTrackData;
  pending?: RmsTrackData;
  pendingApplyAtMs?: number;
  lastRawKey?: string;
  timer?: ReturnType<typeof setTimeout>;
}

export const RMS_DELAY_MS = 20_000;
const stationRmsDelayMap = new Map<string, StationRmsDelayState>();
type RmsUpdateListener = (stationId: string) => void;
const rmsListeners = new Set<RmsUpdateListener>();

export function onRmsDelayedUpdate(listener: RmsUpdateListener): () => void {
  rmsListeners.add(listener);
  return () => {
    rmsListeners.delete(listener);
  };
}

function notifyRmsUpdate(stationId: string) {
  for (const listener of rmsListeners) {
    try {
      listener(stationId);
    } catch {
      // Ignore listener errors
    }
  }
}

export function resetStationRmsDelay(stationId?: string) {
  if (stationId) {
    const s = stationRmsDelayMap.get(stationId);
    if (s?.timer) clearTimeout(s.timer);
    stationRmsDelayMap.delete(stationId);
  } else {
    for (const s of stationRmsDelayMap.values()) {
      if (s.timer) clearTimeout(s.timer);
    }
    stationRmsDelayMap.clear();
  }
}

/**
 * Returns true if an artwork URL is empty, a generic BBC placeholder, or a solid grey placeholder.
 * BBC RMS commonly returns "p0bqcdzf" as a solid grey square when no song artwork exists.
 */
export function isPlaceholderArtwork(url?: string, stationLogoUrl?: string): boolean {
  if (!url || typeof url !== "string") return true;
  const trimmed = url.trim();
  if (!trimmed || !trimmed.startsWith("http")) return true;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("p0bqcdzf") ||
    lower.includes("p01tqv8z") ||
    lower.includes("default") ||
    lower.includes("placeholder") ||
    lower.includes("blocks-colour-black") ||
    lower.includes("/services/")
  ) {
    return true;
  }
  if (stationLogoUrl && trimmed === stationLogoUrl) {
    return true;
  }
  return false;
}

export function resolveDelayedRmsTrack(
  stationId: string,
  rawArtist?: string,
  rawTrack?: string,
  rawImageUrl?: string,
  durationOrNow?: number,
  nowArg?: number,
  skipDelay: boolean = false
): RmsTrackData {
  let rawDurationSec: number | undefined;
  let now: number;

  if (nowArg !== undefined) {
    rawDurationSec = durationOrNow;
    now = nowArg;
  } else if (durationOrNow !== undefined && durationOrNow > 86400) {
    rawDurationSec = undefined;
    now = durationOrNow;
  } else {
    rawDurationSec = durationOrNow;
    now = Date.now();
  }

  const rawKey = `${rawArtist || ""}__${rawTrack || ""}__${rawImageUrl || ""}__${rawDurationSec || 0}`;
  let state = stationRmsDelayMap.get(stationId);

  if (skipDelay) {
    if (state?.timer) clearTimeout(state.timer);
    const immediate: RmsTrackData = {
      artist: rawArtist,
      track: rawTrack,
      imageUrl: rawImageUrl,
      durationSec: rawDurationSec
    };
    stationRmsDelayMap.set(stationId, {
      applied: immediate,
      lastRawKey: rawKey
    });
    return immediate;
  }

  if (!state) {
    const initial: RmsTrackData = {
      artist: rawArtist,
      track: rawTrack,
      imageUrl: rawImageUrl,
      durationSec: rawDurationSec
    };
    state = {
      applied: initial,
      lastRawKey: rawKey
    };
    stationRmsDelayMap.set(stationId, state);
    return initial;
  }

  // If pending track has passed delay time, promote it
  if (state.pendingApplyAtMs !== undefined && now >= state.pendingApplyAtMs) {
    if (state.timer) clearTimeout(state.timer);
    state.applied = state.pending || {};
    state.pending = undefined;
    state.pendingApplyAtMs = undefined;
    state.timer = undefined;
  }

  // Detect update (new song, song change, or song ended)
  if (state.lastRawKey !== rawKey) {
    state.lastRawKey = rawKey;
    if (state.timer) clearTimeout(state.timer);

    const pendingData: RmsTrackData = {
      artist: rawArtist,
      track: rawTrack,
      imageUrl: rawImageUrl,
      durationSec: rawDurationSec
    };
    state.pending = pendingData;
    state.pendingApplyAtMs = now + RMS_DELAY_MS;

    state.timer = setTimeout(() => {
      const s = stationRmsDelayMap.get(stationId);
      if (!s) return;
      s.applied = s.pending || {};
      s.pending = undefined;
      s.pendingApplyAtMs = undefined;
      s.timer = undefined;
      notifyRmsUpdate(stationId);
    }, RMS_DELAY_MS);
  }

  return state.applied;
}

/** One in-flight `fetchShowInfo` per station, so overlapping callers share a single request. */
const inFlightShowInfo = new Map<string, Promise<CurrentShow>>();
/** Abort the two upstream calls if they hang, so a dead network cannot pile requests up. */
const SHOW_INFO_TIMEOUT_MS = 10_000;

/**
 * Last body and validator for each show-info endpoint.
 *
 * A station's show info is polled every 5s while it plays, far more often than either
 * upstream endpoint changes. Sending `If-None-Match` lets the CDN answer 304 and keep the poll
 * cheap; the previous cache-busting `?t=` query parameter together with `cache: "no-store"`
 * forced a full payload download every single time. The body has to be kept, because a 304
 * means "the copy you already have is still current".
 */
const conditionalCache = new Map<string, { etag?: string; json: unknown }>();

async function fetchJsonConditional(url: string, signal: AbortSignal): Promise<unknown | undefined> {
  const cached = conditionalCache.get(url);
  const headers: Record<string, string> = { "User-Agent": "BritishRadioPlayer/1.0" };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  const res = await fetch(url, { headers, signal });
  if (res.status === 304 && cached) return cached.json;
  if (!res.ok) return undefined;
  const json = await res.json();
  conditionalCache.set(url, { etag: res.headers.get("ETag") || undefined, json });
  return json;
}

export async function fetchShowInfo(stationId: string, skipDelay: boolean = false): Promise<CurrentShow> {
  const station = StationRepository.getById(stationId);
  if (!station) return { title: "BBC Radio" };

  // Key by stationId and skipDelay so immediate tune-in/refresh requests aren't coalesced
  // into an earlier delayed poll request.
  const key = `${stationId}:${skipDelay ? "immediate" : "delayed"}`;
  const existing = inFlightShowInfo.get(key);
  if (existing) return existing;

  const request = fetchShowInfoUncached(station, skipDelay).finally(() => {
    inFlightShowInfo.delete(key);
  });
  inFlightShowInfo.set(key, request);
  return request;
}

async function fetchShowInfoUncached(
  station: Station,
  skipDelay: boolean
): Promise<CurrentShow> {
  const stationId = station.id;
  const serviceId = station.serviceId;
  let rawArtist: string | undefined;
  let rawTrack: string | undefined;
  let rawRmsImageUrl: string | undefined;
  let rawDurationSec: number | undefined;

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), SHOW_INFO_TIMEOUT_MS);

  // Both upstream calls share one abort signal, so a hung endpoint cannot hold the caller
  // open past the timeout. Each section still degrades independently below.
  try {
    // 1. Live song/segment from RMS. Only a currently-playing music segment supplies
    // artist/song details; speech, news, or a finished song fall back to the programme.
    let rmsFetchSucceeded = false;
    try {
      const rmsData = await fetchJsonConditional(
        `https://rms.api.bbc.co.uk/v2/services/${serviceId}/segments/latest`,
        abort.signal
      );
      rmsFetchSucceeded = true;
      if (rmsData) {
        const data = rmsData as { data?: any[] };
        const segment = data?.data?.[0];
        const isMusic = String(segment?.segment_type || "").toLowerCase() === "music";
        const offset = segment?.offset;
        const label = String(offset?.label || "").toLowerCase();
        // BBC RMS sets now_playing: true and label: "Now Playing" while track is on air.
        // Once ended, now_playing is false and label indicates e.g. "X Minutes Ago".
        const isNowPlaying = (offset?.now_playing === true || label === "now playing") &&
          offset?.now_playing !== false &&
          !label.includes("ago");

        if (segment && isMusic && isNowPlaying) {
          rawArtist = segment.titles?.primary?.trim() || undefined;
          rawTrack = (segment.titles?.secondary || segment.titles?.tertiary)?.trim() || undefined;
          if (typeof offset?.end === "number" && typeof offset?.start === "number" && offset.end > offset.start) {
            rawDurationSec = offset.end - offset.start;
          } else if (segment.duration) {
            const parsed = Number(segment.duration);
            if (!Number.isNaN(parsed) && parsed > 0) rawDurationSec = parsed;
          }
          const imgTemplate = segment.image_url;
          if (
            imgTemplate &&
            !isPlaceholderArtwork(imgTemplate, station.logoUrl)
          ) {
            rawRmsImageUrl = imgTemplate.replace("{recipe}", "320x320");
          }
        }
      }
    } catch (err) {
      // Non-critical, RMS segment might be absent or 404
    }

    if (!rmsFetchSucceeded) {
      const existingState = stationRmsDelayMap.get(stationId);
      if (existingState?.applied?.artist || existingState?.applied?.track) {
        rawArtist = existingState.applied.artist;
        rawTrack = existingState.applied.track;
        rawRmsImageUrl = existingState.applied.imageUrl;
        rawDurationSec = existingState.applied.durationSec;
      }
    }

  // Delay RMS track/artist/artwork updates by 20 seconds to match the audio stream buffer latency,
  // or apply immediately when tuning in (skipDelay=true).
  const delayedRms = resolveDelayedRmsTrack(
    stationId,
    rawArtist,
    rawTrack,
    rawRmsImageUrl,
    rawDurationSec,
    undefined,
    skipDelay
  );
  const artist = delayedRms.artist;
  const track = delayedRms.track;
  const rmsImageUrl = delayedRms.imageUrl;
  const durationSec = delayedRms.durationSec;

  // 2. Fetch live programme title from ESS Schedules API
  let showTitle = "BBC Radio";
  let episodeTitle: string | undefined;
  let essImageUrl: string | undefined;
  let nextShowTitle: string | undefined;
  let startTime: string | undefined;
  let endTime: string | undefined;
  let startTimeMs: number | undefined;
  let endTimeMs: number | undefined;
  let nextShowStartTimeMs: number | undefined;

  try {
    const essData = (await fetchJsonConditional(
      `https://ess.api.bbci.co.uk/schedules?serviceId=${serviceId}&mediatypes=audio`,
      abort.signal
    )) as { items?: any[] } | undefined;
    if (essData) {
      const items = essData.items || [];
      const now = Date.now() - RMS_DELAY_MS;
      const entries = parseEssSchedule(items);

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (now >= entry.startTimeMs && now <= entry.endTimeMs) {
          showTitle = entry.title;
          episodeTitle = entry.episodeTitle;
          if (entry.imageUrl) {
            essImageUrl = entry.imageUrl;
          }
          startTime = new Date(entry.startTimeMs).toISOString();
          endTime = new Date(entry.endTimeMs).toISOString();
          startTimeMs = entry.startTimeMs;
          endTimeMs = entry.endTimeMs;

          // Next show
          if (i + 1 < entries.length) {
            const nextEntry = entries[i + 1];
            nextShowTitle = nextEntry.title;
            nextShowStartTimeMs = nextEntry.startTimeMs;
          }
          break;
        }
      }

      if (entries.length > 0) {
        const todayDate = new Date();
        const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
        scheduleCache.set(`${stationId}_${todayStr}`, entries);
      }
    } else {
      const cached = getUpcomingShowFromSchedule(stationId, Date.now() - RMS_DELAY_MS);
      if (cached) {
        showTitle = cached.title;
        episodeTitle = cached.episodeTitle;
        essImageUrl = cached.imageUrl;
        startTimeMs = cached.startTimeMs;
        endTimeMs = cached.endTimeMs;
      }
    }
  } catch (err) {
    const cached = getUpcomingShowFromSchedule(stationId, Date.now() - RMS_DELAY_MS);
    if (cached) {
      showTitle = cached.title;
      episodeTitle = cached.episodeTitle;
      essImageUrl = cached.imageUrl;
      startTimeMs = cached.startTimeMs;
      endTimeMs = cached.endTimeMs;
    }
  }

  return {
    title: showTitle,
    episodeTitle,
    artist,
    track,
    durationSec,
    songImageUrl: rmsImageUrl,
    imageUrl: (artist || track) ? rmsImageUrl : (rmsImageUrl || essImageUrl),
    startTime,
    endTime,
    startTimeMs,
    endTimeMs,
    nextShowTitle,
    nextShowStartTimeMs,
    rawArtist,
    rawTrack,
    rawImageUrl: rawRmsImageUrl
  };
  } finally {
    clearTimeout(timeout);
  }
}

// Bounded: keyed by station and date, so browsing the guide across days grew it without limit.
const MAX_CACHED_SCHEDULES = 300;
const scheduleCache = new BoundedCache<string, ScheduleEntry[]>(MAX_CACHED_SCHEDULES);

/**
 * Find the scheduled show for a station at a given timestamp using the cached schedule.
 */
export function getUpcomingShowFromSchedule(
  stationId: string,
  timestampMs: number = Date.now()
): ScheduleEntry | undefined {
  const d = new Date(timestampMs);
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const entries = scheduleCache.get(`${stationId}_${todayStr}`);
  if (!entries || !entries.length) return undefined;
  return entries.find((e) => timestampMs >= e.startTimeMs && timestampMs < e.endTimeMs);
}

/**
 * Format timestamp (ms) to HH:mm in local time.
 */
export function formatScheduleTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${mins}`;
}

/**
 * Automatically fill schedule gaps:
 * 1. Micro-gaps / overlaps (< 1.5 min): snap previous show's end time to next show's start time to eliminate slivers.
 * 2. 1.5 - 6.5 min gaps (top-of-hour news bulletin junctions): insert a synthetic "BBC News" entry with "News Summary".
 */
export function fillScheduleGaps(entries: ScheduleEntry[]): ScheduleEntry[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => a.startTimeMs - b.startTimeMs);
  const result: ScheduleEntry[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = { ...sorted[i] };
    result.push(current);

    if (i + 1 < sorted.length) {
      const next = sorted[i + 1];
      const gapMs = next.startTimeMs - current.endTimeMs;
      const gapMinutes = gapMs / (60 * 1000);

      if (gapMinutes >= -1.5 && gapMinutes < 1.5) {
        // Micro-gap or slight overlap: snap end time to next start time
        current.endTimeMs = next.startTimeMs;
      } else if (gapMinutes >= 1.5 && gapMinutes <= 6.5) {
        // News bulletin gap (usually 2-5 minutes at the top of the hour)
        result.push({
          title: "BBC News",
          episodeTitle: "News Summary",
          startTimeMs: current.endTimeMs,
          endTimeMs: next.startTimeMs
        });
      }
    }
  }

  return result;
}

function parseEssSchedule(items: any[]): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (const item of items) {
    const pubTime = item.published_time;
    if (!pubTime?.start || !pubTime?.end) continue;
    const start = new Date(pubTime.start).getTime();
    const end = new Date(pubTime.end).getTime();

    const brand = item.brand;
    const episode = item.episode;
    const title = brand?.title || episode?.title || "BBC Radio";
    const epTitle = brand?.title && episode?.title && episode.title !== brand.title ? episode.title : undefined;

    const imgObj = episode?.image || brand?.image;
    const template = imgObj?.template_url;
    const imageUrl = template ? template.replace("{recipe}", "320x320") : undefined;

    entries.push({
      title,
      episodeTitle: epTitle,
      startTimeMs: start,
      endTimeMs: end,
      imageUrl
    });
  }
  return fillScheduleGaps(entries);
}

function parseRmsSchedule(data: any): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  const modules = data?.data || [];
  for (const mod of modules) {
    const items = mod?.data || [];
    for (const item of items) {
      if (item.type !== "broadcast_summary") continue;
      if (!item.start || !item.end) continue;
      const start = new Date(item.start).getTime();
      const end = new Date(item.end).getTime();

      const titles = item.titles;
      const title = titles?.primary || "BBC Radio";
      const secondary = titles?.secondary;
      const epTitle = secondary && secondary !== title ? secondary : undefined;
      const imgUrl = item.image_url ? item.image_url.replace("{recipe}", "320x320") : undefined;

      entries.push({
        title,
        episodeTitle: epTitle,
        startTimeMs: start,
        endTimeMs: end,
        imageUrl: imgUrl
      });
    }
  }
  return fillScheduleGaps(entries);
}

/**
 * Fetch schedule entries for a station and date ("YYYY-MM-DD").
 * Uses ESS API for today with RMS API fallback, and RMS API for past/future dates.
 */
export async function fetchScheduleForDate(
  stationId: string,
  dateStr: string,
  forceRefresh = false
): Promise<ScheduleEntry[]> {
  const cacheKey = `${stationId}_${dateStr}`;
  if (!forceRefresh && scheduleCache.has(cacheKey)) {
    const cached = scheduleCache.get(cacheKey)!;
    if (cached.length > 0) return cached;
  }

  const station = StationRepository.getById(stationId);
  if (!station) return [];

  const serviceId = station.serviceId;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let entries: ScheduleEntry[] = [];

  // 1. Try primary API (ESS for today, RMS for other dates)
  try {
    if (dateStr === todayStr) {
      const res = await fetch(`https://ess.api.bbci.co.uk/schedules?serviceId=${serviceId}&mediatypes=audio`, {
        headers: { "User-Agent": "BritishRadioPlayer/1.0" }
      });
      if (res.ok) {
        const data = await res.json();
        entries = parseEssSchedule(data?.items || []);
      }
    } else {
      const res = await fetch(`https://rms.api.bbc.co.uk/v2/experience/inline/schedules/${serviceId}/${dateStr}`, {
        headers: { "User-Agent": "BritishRadioPlayer/1.0" }
      });
      if (res.ok) {
        const data = await res.json();
        entries = parseRmsSchedule(data);
      }
    }
  } catch (err) {
    console.warn(`Primary schedule fetch failed for ${stationId} on ${dateStr}:`, err);
  }

  // 2. Fallback: If primary returned nothing (e.g. ESS API error/rate-limit for today), try RMS API
  if (entries.length === 0) {
    try {
      const fallbackUrl = `https://rms.api.bbc.co.uk/v2/experience/inline/schedules/${serviceId}/${dateStr}`;
      const res = await fetch(fallbackUrl, {
        headers: { "User-Agent": "BritishRadioPlayer/1.0" }
      });
      if (res.ok) {
        const data = await res.json();
        entries = parseRmsSchedule(data);
      }
    } catch (err) {
      console.warn(`Fallback RMS schedule fetch failed for ${stationId} on ${dateStr}:`, err);
    }
  }

  // 3. Only cache when valid entries exist, never poison cache with empty results
  if (entries.length > 0) {
    entries.sort((a, b) => a.startTimeMs - b.startTimeMs);
    scheduleCache.set(cacheKey, entries);
  }

  return entries;
}

