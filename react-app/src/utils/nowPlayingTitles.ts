export interface RadioNowPlayingTitlesParams {
  stationTitle?: string;
  showTitle?: string;
  episodeTitle?: string;
  artist?: string;
  track?: string;
}

export interface NowPlayingTitles {
  headerTitle: string;
  primaryTitle: string;
  secondaryTitle?: string;
}

/**
 * Resolves header, primary headline and secondary titles for live radio playback on Now Playing.
 * Avoids duplicating the radio station name under the image when show or song details are available.
 */
export function resolveRadioNowPlayingTitles(params: RadioNowPlayingTitlesParams): NowPlayingTitles {
  const stationTitle = params.stationTitle?.trim() || "Radio";
  const rawShowTitle = params.showTitle?.trim();
  const radioShowName =
    rawShowTitle && rawShowTitle.toLowerCase() !== "bbc radio"
      ? rawShowTitle
      : stationTitle;

  const artist = params.artist?.trim();
  const track = params.track?.trim();
  const isSongPlaying = Boolean(artist || track);
  const artistTrack = isSongPlaying
    ? [artist, track].filter(Boolean).join(" - ")
    : "";

  const episodeTitle = params.episodeTitle?.trim();
  const hasDistinctEpisode = Boolean(episodeTitle && episodeTitle !== radioShowName);

  const primaryTitle = isSongPlaying
    ? (artistTrack || radioShowName)
    : hasDistinctEpisode
      ? `${radioShowName} - ${episodeTitle}`
      : (radioShowName || stationTitle);

  const secondaryTitle =
    isSongPlaying && radioShowName !== stationTitle && radioShowName.toLowerCase() !== "bbc radio"
      ? radioShowName
      : undefined;

  return {
    headerTitle: stationTitle,
    primaryTitle,
    secondaryTitle
  };
}

/** 24-hour `HH:MM`, matching `formatScheduleTime` used by the guide and schedule screens. */
function formatUpNextTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Builds the "Up next:" line under a live radio show on Now Playing, including the time the
 * next programme starts. Falls back to the current show's end time, which is where the schedule
 * grid advances to the next show, when the schedule entry has no explicit next start time.
 */
export function formatUpNextLabel(
  nextShowTitle?: string,
  nextShowStartTimeMs?: number,
  currentShowEndTimeMs?: number
): string {
  const title = nextShowTitle?.trim();
  if (!title) return "";

  const startTimeMs =
    typeof nextShowStartTimeMs === "number" && nextShowStartTimeMs > 0
      ? nextShowStartTimeMs
      : currentShowEndTimeMs;
  const time =
    typeof startTimeMs === "number" && startTimeMs > 0 ? formatUpNextTime(startTimeMs) : "";

  return time ? `${title} at ${time}` : title;
}
