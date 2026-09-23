import { StationRepository } from "../data/stations";

export interface CurrentShow {
  title: string;
  episodeTitle?: string;
  artist?: string;
  track?: string;
  description?: string;
  imageUrl?: string;
  startTime?: string;
  endTime?: string;
  nextShowTitle?: string;
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
  if (show.episodeTitle) {
    return show.episodeTitle;
  }
  return show.title || "BBC Radio";
}

export async function fetchShowInfo(stationId: string): Promise<CurrentShow> {
  const station = StationRepository.getById(stationId);
  if (!station) return { title: "BBC Radio" };

  const serviceId = station.serviceId;
  let artist: string | undefined;
  let track: string | undefined;
  let rmsImageUrl: string | undefined;

  // 1. Fetch live song/segment from RMS API
  try {
    const rmsRes = await fetch(`https://rms.api.bbc.co.uk/v2/services/${serviceId}/segments/latest?t=${Date.now()}`, {
      headers: { "User-Agent": "BritishRadioPlayer/1.0" }
    });
    if (rmsRes.ok) {
      const data = await rmsRes.json();
      const segment = data?.data?.[0];
      if (segment) {
        artist = segment.titles?.primary;
        track = segment.titles?.secondary || segment.titles?.tertiary;
        const imgTemplate = segment.image_url;
        if (imgTemplate) {
          rmsImageUrl = imgTemplate.replace("{recipe}", "320x320");
        }
      }
    }
  } catch (err) {
    // Non-critical, RMS segment might be absent or 404
  }

  // 2. Fetch live programme title from ESS Schedules API
  let showTitle = "BBC Radio";
  let episodeTitle: string | undefined;
  let essImageUrl: string | undefined;
  let nextShowTitle: string | undefined;

  try {
    const essRes = await fetch(`https://ess.api.bbci.co.uk/schedules?serviceId=${serviceId}&mediatypes=audio`, {
      headers: { "User-Agent": "BritishRadioPlayer/1.0" }
    });
    if (essRes.ok) {
      const essData = await essRes.json();
      const items = essData?.items || [];
      const now = Date.now();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const publishedTime = item.published_time;
        if (!publishedTime?.start || !publishedTime?.end) continue;

        const start = new Date(publishedTime.start).getTime();
        const end = new Date(publishedTime.end).getTime();

        if (now >= start && now <= end) {
          const brand = item.brand;
          const episode = item.episode;
          showTitle = brand?.title || episode?.title || "BBC Radio";
          if (brand?.title && episode?.title) {
            episodeTitle = episode.title;
          }

          const imageObj = episode?.image || brand?.image;
          const template = imageObj?.template_url;
          if (template) {
            essImageUrl = template.replace("{recipe}", "320x320");
          }

          // Next show
          if (i + 1 < items.length) {
            const nextItem = items[i + 1];
            nextShowTitle = nextItem.brand?.title || nextItem.episode?.title;
          }
          break;
        }
      }
    }
  } catch (err) {
    // Transient schedule error
  }

  return {
    title: showTitle,
    episodeTitle,
    artist,
    track,
    imageUrl: rmsImageUrl || essImageUrl,
    nextShowTitle
  };
}

const scheduleCache = new Map<string, ScheduleEntry[]>();

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

