/**
 * Shortens shared web player links. Feed descriptions make the raw URLs long
 * enough that chat clients truncate them, so prefer a short alias and fall back
 * to the full URL whenever the services are slow or unreachable — sharing must
 * never fail because a shortener did.
 *
 * Both providers are queried in parallel because either can be down at any time
 * (is.gd has been returning "database insert failed" outright), and serialising
 * them would add a full timeout to the share sheet.
 */

const SHORTEN_TIMEOUT_MS = 4000;

const SHORTENERS: ReadonlyArray<(url: string) => string> = [
  (url) => `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
  (url) => `https://is.gd/create.php?format=simple&logstats=0&url=${encodeURIComponent(url)}`
];

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

async function requestShortUrl(endpoint: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHORTEN_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      headers: { Accept: "text/plain" },
      signal: controller.signal
    });
    if (!res.ok) return null;
    // Both services answer errors with HTTP 200 and a plain-text message
    // ("Error, database insert failed"), so validate the body, not the status.
    const shortUrl = (await res.text()).trim();
    return isHttpUrl(shortUrl) ? shortUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function shortenUrl(longUrl: string): Promise<string> {
  if (!longUrl) return longUrl;
  const attempts = await Promise.all(SHORTENERS.map((build) => requestShortUrl(build(longUrl))));
  return attempts.find((url): url is string => url !== null) ?? longUrl;
}
