/**
 * The shape the home screen widgets read, and the rules that produce it.
 *
 * Both platforms render from this: Android through the native module's shared preferences,
 * iOS through the App Group container the widget extension reads. Everything here is pure
 * so the wording, the artwork choice and the station fallback chain can be pinned down in
 * `tests/widgetSync.test.ts` instead of only being observable on a device.
 */

/** What the player is doing, as the widgets see it. */
export interface WidgetLiveState {
  /** Station being played, or empty when a podcast is playing or nothing is loaded. */
  stationId: string;
  stationTitle: string;
  /** Song, episode or programme line. Empty when nothing is playing. */
  showLine: string;
  isPlaying: boolean;
  /** Show artwork for the widget background, or empty to use generated station artwork. */
  artworkUrl: string;
}

/** A tap on a widget, queued natively and drained by the app on its next start. */
export interface WidgetAction {
  action: "play" | "stop" | "open";
  stationId: string | null;
}

/** The station fields a widget needs; the native side never sees stream URLs or logos. */
export interface WidgetCatalogueEntry {
  id: string;
  title: string;
  category: string;
}

const EMPTY_LIVE_STATE: WidgetLiveState = {
  stationId: "",
  stationTitle: "",
  showLine: "",
  isPlaying: false,
  artworkUrl: ""
};

/** The scheme the widget links use; see plugins/ios-widget/Extension/StationWidgetView.swift. */
const WIDGET_URL_PREFIX = "bbcradioplayer://widget/";

/** The subset of `CurrentShow` the widget line is derived from. */
export interface WidgetShowLike {
  title?: string;
  episodeTitle?: string;
  artist?: string;
  track?: string;
  imageUrl?: string;
  songImageUrl?: string;
  rawImageUrl?: string;
}

/**
 * The line under the station name, following the ladder both platforms use: song, then
 * episode, then programme, then nothing (the widget falls back to "Live now").
 */
export function formatWidgetShowLine(show: WidgetShowLike | null | undefined): string {
  if (!show) return "";
  const artist = (show.artist ?? "").trim();
  const track = (show.track ?? "").trim();
  if (artist && track) return `${artist} - ${track}`;
  if (track) return track;
  if (artist) return artist;

  const episode = (show.episodeTitle ?? "").trim();
  const title = (show.title ?? "").trim();
  if (episode && episode !== title) return episode;
  if (title && title.toLowerCase() !== "bbc radio") return title;
  return "";
}

/**
 * Show artwork, or empty when there is none usable. Placeholder artwork is rejected
 * because it is a BBC station logo, and the widget background never carries BBC branding.
 */
export function resolveWidgetArtwork(
  show: WidgetShowLike | null | undefined,
  stationLogoUrl: string | undefined,
  isPlaceholder: (url: string, logoUrl: string | undefined) => boolean
): string {
  const raw = show?.songImageUrl || show?.rawImageUrl || show?.imageUrl || "";
  if (!raw || isPlaceholder(raw, stationLogoUrl)) return "";
  return raw;
}

/** Derives everything the widgets render from the current player state. */
export function resolveWidgetLiveState(input: {
  stationId?: string | null;
  stationTitle?: string | null;
  stationLogoUrl?: string | null;
  show?: WidgetShowLike | null;
  isPlaying?: boolean;
  isPlaceholderArtwork: (url: string, logoUrl: string | undefined) => boolean;
}): WidgetLiveState {
  const stationId = input.stationId ?? "";
  if (!stationId) return EMPTY_LIVE_STATE;

  const isPlaying = input.isPlaying === true;
  const stationTitle = (input.stationTitle ?? "").trim();
  return {
    stationId,
    stationTitle,
    // Artwork is only worth fetching while something is playing: the widget that points at
    // another station never shows it, and a stale picture would be misleading.
    showLine: isPlaying ? formatWidgetShowLine(input.show) : "",
    isPlaying,
    artworkUrl: isPlaying
      ? resolveWidgetArtwork(input.show, input.stationLogoUrl ?? undefined, input.isPlaceholderArtwork)
      : ""
  };
}

/** True when two pushes would render the same thing, so a redraw can be skipped. */
export function isSameWidgetState(a: WidgetLiveState, b: WidgetLiveState): boolean {
  return (
    a.stationId === b.stationId &&
    a.stationTitle === b.stationTitle &&
    a.showLine === b.showLine &&
    a.isPlaying === b.isPlaying &&
    a.artworkUrl === b.artworkUrl
  );
}

/** Serialises the station list the native pickers offer, so it cannot drift from the app. */
export function buildWidgetCatalogueJson(
  stations: ReadonlyArray<WidgetCatalogueEntry>
): string {
  return JSON.stringify({
    stations: stations.map((station) => ({
      id: station.id,
      title: station.title,
      category: station.category
    }))
  });
}

/** Parses a queued widget tap. Returns null for anything unrecognised. */
export function parseWidgetAction(raw: string | null | undefined): WidgetAction | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const action = record.action;
  if (action !== "play" && action !== "stop" && action !== "open") return null;
  const stationId = typeof record.stationId === "string" && record.stationId ? record.stationId : null;
  return { action, stationId };
}

/**
 * The iOS widget hands its taps to the app as `bbcradioplayer://widget/<action>?station=<id>`
 * links, because an extension cannot drive playback itself. Returns null for any other URL,
 * so the caller can fall through to ordinary deep-link navigation.
 */
export function parseWidgetActionUrl(url: string | null | undefined): WidgetAction | null {
  if (!url || !url.startsWith(WIDGET_URL_PREFIX)) return null;

  const [path, query = ""] = url.slice(WIDGET_URL_PREFIX.length).split("?");
  let stationId: string | null = null;
  for (const pair of query.split("&")) {
    if (!pair.startsWith("station=")) continue;
    stationId = decodeURIComponent(pair.slice("station=".length)) || null;
  }
  return parseWidgetAction(JSON.stringify({ action: path, stationId }));
}
