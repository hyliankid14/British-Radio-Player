export interface AppNavigationTarget {
  pathname: string;
  params: Record<string, string>;
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
