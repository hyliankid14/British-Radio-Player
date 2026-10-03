export interface AppNavigationTarget {
  pathname: string;
  params: Record<string, string>;
}

/**
 * Every pathname {@link resolveAppNavigation} is allowed to hand to the navigator, mirroring
 * the screens in `app/`.
 *
 * A notification or deep link can only ever reach a route that exists. When one does not,
 * expo-router resolves it to its `*not-found` slot and paints the "Unmatched Route" screen,
 * which is a dead end for the user: they asked to open something and got a 404. Rejecting
 * the URL at the edge instead lets the caller fall back to the tabs.
 *
 * `tests/navigation.test.ts` walks `app/` and asserts every route appears here, so a new
 * screen cannot be added without this list catching up.
 */
export const KNOWN_APP_ROUTES: readonly string[] = [
  "/",
  "/(tabs)",
  "/(tabs)/favourites",
  "/(tabs)/guide",
  "/(tabs)/index",
  "/(tabs)/library",
  "/(tabs)/podcasts",
  "/(tabs)/settings",
  "/lastfm-auth",
  "/modal/episode-detail",
  "/modal/now-playing",
  "/modal/playlist-detail",
  "/modal/podcast-detail",
  "/modal/podcast-search",
  "/modal/schedule",
  "/modal/settings-detail",
  "/notification.click",
  "/widget/[action]",
  "/widget/index"
];

/** True when `pathname` names a screen that exists in `app/`. */
export function isKnownAppRoute(pathname: string): boolean {
  return KNOWN_APP_ROUTES.includes(pathname);
}

/**
 * Builds the in-app URL a podcast notification should open. Passing `episodeId`
 * deep-links past the episode list straight to the notified episode.
 */
export function buildPodcastDetailUrl(podcastId: string, episodeId?: string): string {
  const base = `/modal/podcast-detail?podcastId=${encodeURIComponent(podcastId)}`;
  if (!episodeId) return base;
  return `${base}&episodeId=${encodeURIComponent(episodeId)}`;
}

/** Builds the in-app URL a finished download should open — the library's Downloads section. */
export function buildLibraryUrl(): string {
  return "/(tabs)/library";
}

/** Builds the in-app URL a saved-search notification should open. */
export function buildPodcastSearchUrl(
  query: string,
  savedSearchId?: string,
  result?: { episodeId?: string; podcastId?: string }
): string {
  let url = `/modal/podcast-search?search=${encodeURIComponent(query)}`;
  if (savedSearchId) url += `&savedSearchId=${encodeURIComponent(savedSearchId)}`;
  if (result?.episodeId) url += `&episodeId=${encodeURIComponent(result.episodeId)}`;
  if (result?.podcastId) url += `&podcastId=${encodeURIComponent(result.podcastId)}`;
  return url;
}

/**
 * Parses deep links (e.g. bbcradioplayer://modal/podcast-detail?podcastId=123,
 * bbcradioplayer://podcasts?search=comedy&savedSearchId=abc), relative URLs (/modal/podcast-detail...),
 * and external deep links (such as /lastfm-auth), correctly preserving hostname and path segments.
 *
 * Returns null when the input is unusable or names no screen in the app, so callers can fall
 * back rather than navigate into a route that would render the "Unmatched Route" screen.
 */
export function resolveAppNavigation(rawUrl: string): AppNavigationTarget | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Strip scheme prefix like "bbcradioplayer://" or "https://"
  const withoutScheme = trimmed.replace(/^[a-zA-Z0-9+.-]+:\/+/i, "");

  // Split into path and query string
  const [pathPart, queryPart] = withoutScheme.split("?");

  // Format pathname with a leading slash
  let cleanPath = (pathPart || "").trim();
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  // Parse query parameters
  const params: Record<string, string> = {};
  if (queryPart) {
    const searchParams = new URLSearchParams(queryPart);
    searchParams.forEach((val, key) => {
      params[key] = val;
    });
  }

  // Map known short routes or normalize
  let pathname = cleanPath;

  // Handle Last.fm auth callback
  if (pathname.includes("lastfm-auth") || params.token) {
    return {
      pathname: "/lastfm-auth",
      params
    };
  }

  // Handle media playback notification click (trackplayer://notification.click or bbcradioplayer://notification.click)
  if (pathname.includes("notification.click")) {
    return {
      pathname: "/modal/now-playing",
      params
    };
  }

  // Route widget deep links to main tabs
  if (pathname.startsWith("/widget")) {
    return {
      pathname: "/(tabs)",
      params
    };
  }

  // Route podcast searches to dedicated podcast search screen
  if (
    pathname === "/modal/podcast-search" ||
    ((pathname === "/podcasts" || pathname === "/(tabs)/podcasts") && params.search !== undefined)
  ) {
    return {
      pathname: "/modal/podcast-search",
      params
    };
  }

  // Ensure root-relative route
  if (pathname === "" || pathname === "/") {
    pathname = "/";
  }

  // Nothing in the app answers to this path. Returning null lets the caller drop the
  // navigation rather than land the user on expo-router's "Unmatched Route" screen.
  if (!isKnownAppRoute(pathname)) return null;

  return {
    pathname,
    params
  };
}
