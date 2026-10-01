export interface AppNavigationTarget {
  pathname: string;
  params: Record<string, string>;
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

  return {
    pathname,
    params
  };
}
