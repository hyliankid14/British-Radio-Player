export interface PodcastLike {
  id: string;
  title: string;
  [key: string]: any;
}

export const PIXELS_PER_MINUTE = 4.0; // 30 min = 120dp, 60 min = 240dp
export const ROW_HEIGHT = 76;
export const STATION_COLUMN_WIDTH = 88;
export const MINUTES_IN_DAY = 1440; // 24 hours * 60 minutes
export const TIMELINE_WIDTH = MINUTES_IN_DAY * PIXELS_PER_MINUTE; // 5760dp

export interface TimeSlot {
  label: string; // e.g., "10:00am"
  minuteOffset: number; // 0 to 1440
}

/**
 * Generates 30-minute intervals across a 24-hour day starting from 00:00.
 */
export function generateTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let minute = 0; minute < MINUTES_IN_DAY; minute += 30) {
    const hours24 = Math.floor(minute / 60);
    const mins = minute % 60;
    const period = hours24 >= 12 ? "pm" : "am";
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    const formattedMins = mins === 0 ? ":00" : `:${String(mins).padStart(2, "0")}`;
    slots.push({
      label: `${hours12}${formattedMins}${period}`,
      minuteOffset: minute
    });
  }
  return slots;
}

/**
 * Calculates start position and width of a schedule item relative to day start.
 */
export function calculateScheduleBlockLayout(
  startTimeMs: number,
  endTimeMs: number,
  dayStartMs: number,
  pxPerMinute: number = PIXELS_PER_MINUTE
): { left: number; width: number } {
  const dayEndMs = dayStartMs + MINUTES_IN_DAY * 60 * 1000;
  
  // Clamp entry within the 24h window of the given day
  const clampedStart = Math.max(startTimeMs, dayStartMs);
  const clampedEnd = Math.min(endTimeMs, dayEndMs);

  const startMinutes = Math.max(0, (clampedStart - dayStartMs) / (60 * 1000));
  const durationMinutes = Math.max(1, (clampedEnd - clampedStart) / (60 * 1000));

  const left = Math.round(startMinutes * pxPerMinute);
  const width = Math.max(20, Math.round(durationMinutes * pxPerMinute));

  return { left, width };
}

/**
 * Normalizes text for comparison (lowercased, stripped punctuation, normalized whitespace).
 */
export function normalizeTitle(text?: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches a schedule show title with a podcast in the catalog.
 */
export function matchShowToPodcast<T extends PodcastLike>(
  showTitle: string,
  episodeTitle: string | undefined,
  podcastMap: Map<string, T>
): T | undefined {
  if (!showTitle && !episodeTitle) return undefined;

  const normShow = normalizeTitle(showTitle);
  if (normShow && podcastMap.has(normShow)) {
    return podcastMap.get(normShow);
  }

  // Check prefix or partial match for common BBC prefixes like "BBC Radio 4: ..." or "The ..."
  for (const [key, podcast] of podcastMap.entries()) {
    if (key.length > 3 && (normShow.includes(key) || key.includes(normShow))) {
      return podcast;
    }
  }

  if (episodeTitle) {
    const normEpisode = normalizeTitle(episodeTitle);
    if (normEpisode && podcastMap.has(normEpisode)) {
      return podcastMap.get(normEpisode);
    }
  }

  return undefined;
}
