import { StationRepository } from "../data/stations.ts";

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

export function resolveDelayedRmsTrack(
  stationId: string,
  rawArtist?: string,
  rawTrack?: string,
  rawImageUrl?: string,
  durationOrNow?: number,
  nowArg?: number
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

export async function fetchShowInfo(stationId: string): Promise<CurrentShow> {
  const station = StationRepository.getById(stationId);
  if (!station) return { title: "BBC Radio" };

  const serviceId = station.serviceId;
  let rawArtist: string | undefined;
  let rawTrack: string | undefined;
  let rawRmsImageUrl: string | undefined;
  let rawDurationSec: number | undefined;

  // 1. Fetch live song/segment from RMS API. Only a currently-playing music segment
  // supplies artist/song details; speech, news, or a finished song fall back to the
  // programme (show) details from the schedule below.
  try {
    const rmsRes = await fetch(`https://rms.api.bbc.co.uk/v2/services/${serviceId}/segments/latest?t=${Date.now()}`, {
      headers: { "User-Agent": "BritishRadioPlayer/1.0" }
    });
    if (rmsRes.ok) {
      const data = await rmsRes.json();
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
          !imgTemplate.toLowerCase().includes("default") &&
          !imgTemplate.toLowerCase().includes("p01tqv8z")
        ) {
          rawRmsImageUrl = imgTemplate.replace("{recipe}", "320x320");
        }
      }
    }
  } catch (err) {
    // Non-critical, RMS segment might be absent or 404
  }

  // Delay RMS track/artist/artwork updates by 20 seconds to match the audio stream buffer latency
  const delayedRms = resolveDelayedRmsTrack(stationId, rawArtist, rawTrack, rawRmsImageUrl, rawDurationSec);
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
    const essRes = await fetch(
      `https://ess.api.bbci.co.uk/schedules?serviceId=${serviceId}&mediatypes=audio&t=${Date.now()}`,
      {
        headers: {
          "User-Agent": "BritishRadioPlayer/1.0",
          "Cache-Control": "no-cache"
        }
      }
    );
    if (essRes.ok) {
      const essData = await essRes.json();
      const items = essData?.items || [];
      const now = Date.now() - RMS_DELAY_MS;
      const entries: ScheduleEntry[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const publishedTime = item.published_time;
        if (!publishedTime?.start || !publishedTime?.end) continue;

        const start = new Date(publishedTime.start).getTime();
        const end = new Date(publishedTime.end).getTime();

        const brand = item.brand;
        const episode = item.episode;
        const itemTitle = brand?.title || episode?.title || "BBC Radio";
        const itemEpTitle = brand?.title && episode?.title && episode.title !== brand.title ? episode.title : undefined;
        const imageObj = episode?.image || brand?.image;
        const template = imageObj?.template_url;
        const itemImageUrl = template ? template.replace("{recipe}", "320x320") : undefined;

        entries.push({
          title: itemTitle,
          episodeTitle: itemEpTitle,
          startTimeMs: start,
          endTimeMs: end,
          imageUrl: itemImageUrl
        });

        if (now >= start && now <= end) {
          showTitle = itemTitle;
          if (brand?.title && episode?.title) {
            episodeTitle = episode.title;
          }
          if (itemImageUrl) {
            essImageUrl = itemImageUrl;
          }
          startTime = publishedTime.start;
          endTime = publishedTime.end;
          startTimeMs = start;
          endTimeMs = end;

          // Next show
          if (i + 1 < items.length) {
            const nextItem = items[i + 1];
            nextShowTitle = nextItem.brand?.title || nextItem.episode?.title;
            if (nextItem.published_time?.start) {
              nextShowStartTimeMs = new Date(nextItem.published_time.start).getTime();
            }
          }
        }
      }

      if (entries.length > 0) {
        entries.sort((a, b) => a.startTimeMs - b.startTimeMs);
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
    imageUrl: rmsImageUrl || essImageUrl,
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
}

const scheduleCache = new Map<string, ScheduleEntry[]>();

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
 * Fetch schedule entries for a station and date ("YYYY-MM-DD").
 * Uses ESS API for today and RMS API for past/future dates.
 */
export async function fetchScheduleForDate(
  stationId: string,
  dateStr: string,
  forceRefresh = false
): Promise<ScheduleEntry[]> {
  const cacheKey = `${stationId}_${dateStr}`;
  if (!forceRefresh && scheduleCache.has(cacheKey)) {
    return scheduleCache.get(cacheKey)!;
  }

  const station = StationRepository.getById(stationId);
  if (!station) return [];

  const serviceId = station.serviceId;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const entries: ScheduleEntry[] = [];

  try {
    if (dateStr === todayStr) {
      // Fetch today from ESS API
      const res = await fetch(`https://ess.api.bbci.co.uk/schedules?serviceId=${serviceId}&mediatypes=audio`, {
        headers: { "User-Agent": "BritishRadioPlayer/1.0" }
      });
      if (res.ok) {
        const data = await res.json();
        const items = data?.items || [];
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
      }
    } else {
      // Fetch other date from RMS API
      const res = await fetch(`https://rms.api.bbc.co.uk/v2/experience/inline/schedules/${serviceId}/${dateStr}`, {
        headers: { "User-Agent": "BritishRadioPlayer/1.0" }
      });
      if (res.ok) {
        const data = await res.json();
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
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch schedule for ${stationId} on ${dateStr}:`, err);
  }

  entries.sort((a, b) => a.startTimeMs - b.startTimeMs);
  scheduleCache.set(cacheKey, entries);
  return entries;
}

