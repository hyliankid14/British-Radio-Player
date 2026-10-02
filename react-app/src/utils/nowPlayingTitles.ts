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
