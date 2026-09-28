/**
 * Builds the links shared out of the app. Every shared podcast/episode points at
 * the GitHub Pages web player (docs/), which renders the content for anyone
 * without the app and offers an "Open in App" deep link for everyone else.
 *
 * These builders are pure so the exact URLs can be covered by unit tests; the
 * react-native share sheet lives in `share.ts`.
 */

export const WEB_PLAYER_BASE_URL = "https://hyliankid14.github.io/British-Radio-Player";

/** Structurally satisfied by `Podcast`/`Episode` from src/api/podcasts. */
export interface ShareablePodcast {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  rssUrl: string;
}

export interface ShareableEpisode {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  audioUrl: string;
  pubDate: string;
  durationMins: number;
  podcastId: string;
}

const APP_FOOTER =
  "If you have the British Radio Player app installed, you can open it directly.";

const SUMMARY_INPUT_LIMIT = 2000;
const SUMMARY_SENTENCES = 2;
const SUMMARY_WORD_LIMIT = 30;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "as", "is", "was", "are", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "should",
  "could", "may", "might", "must", "can", "this", "that", "these", "those",
  "we", "they"
]);

/** Strips feed markup so a summary never ships raw HTML into a share text. */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    // Tags become a space: replacing them with "" would weld "</p><p>" into
    // "Service.News" and hide the sentence boundary from the summariser.
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function limitToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function countWords(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  const matches = text.toLowerCase().match(/\b\w+\b/g);
  if (!matches) return freq;
  for (const word of matches) {
    if (word.length > 3 && !STOP_WORDS.has(word)) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  return freq;
}

function importantWords(sentence: string): string[] {
  return (sentence.toLowerCase().match(/\b\w+\b/g) ?? []).filter(
    (word) => word.length > 3 && !STOP_WORDS.has(word)
  );
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 10);
}

/**
 * Extractive two-sentence summary of a feed description. Shared links carry a
 * short blurb so the web player has something to show before (or without) a
 * successful feed fetch.
 */
export function summarizeText(description: string): string {
  const plain = stripHtml(description);
  if (!plain) return "";

  const text = plain.slice(0, SUMMARY_INPUT_LIMIT).trim();
  if (!text) return "";

  let sentences = splitSentences(text);

  if (sentences.length === 0 || (sentences.length === 1 && sentences[0] === text)) {
    const clauses = text
      .split(/[,;:]+/)
      .map((clause) => clause.trim().replace(/[,;:\-\s]+$/, ""))
      .filter((clause) => clause.length > 10);
    if (clauses.length > 1) {
      const joined = clauses.slice(0, SUMMARY_SENTENCES).join(", ");
      return joined.endsWith(".") ? joined : `${joined}.`;
    }
    sentences = text
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 10);
  }

  if (sentences.length === 0) return limitToWords(text, SUMMARY_WORD_LIMIT);
  if (sentences.length === 1) {
    return `${limitToWords(sentences[0], SUMMARY_WORD_LIMIT).replace(/[.!?]+$/, "")}.`;
  }

  const freq = countWords(text);
  const ranked = sentences
    .map((sentence, index) => {
      const words = importantWords(sentence);
      const freqScore = words.reduce((total, word) => total + (freq.get(word) ?? 0), 0);
      // Lead sentences carry the most weight in feed descriptions.
      const positionBonus = index === 0 ? 1.3 : 1;
      return {
        index,
        score: (freqScore / Math.max(words.length, 1)) * positionBonus
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SUMMARY_SENTENCES)
    .sort((a, b) => a.index - b.index);

  const summary = ranked
    .map(({ index }) => sentences[index].trim().replace(/[.!?]+$/, ""))
    .join(". ");

  if (!summary) return limitToWords(text, SUMMARY_WORD_LIMIT);
  return `${summary}.`;
}

/**
 * BBC feeds occasionally hand out media-selector paths such as
 * `/mediaselector/b6/redir/`, which return 404; only the `/6/` form resolves.
 * Normalising here means a shared episode link still plays in a browser, and
 * forces HTTPS so the player is not blocked on a mixed-content page.
 */
export function normalizeBbcAudioUrl(audioUrl: string): string {
  if (!audioUrl) return "";
  return audioUrl
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/proto\/http\//i, "/proto/https/")
    .replace(/\/mediaselector\/b\d+\//i, "/mediaselector/6/");
}

function buildUrl(route: string, params: Array<[string, string | null | undefined]>): string {
  const query = params
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const base = `${WEB_PLAYER_BASE_URL}/#/${route}`;
  return query ? `${base}?${query}` : base;
}

/** Web player route for a podcast: `#/p/{id}`. */
export function buildPodcastShareUrl(podcast: ShareablePodcast, summary?: string): string {
  return buildUrl(`p/${encodeURIComponent(podcast.id)}`, [
    ["title", podcast.title],
    ["desc", summary ?? ""],
    ["img", podcast.imageUrl],
    ["rss", podcast.rssUrl]
  ]);
}

/** Web player route for an episode: `#/e/{podcastId}/{episodeId}`. */
export function buildEpisodeShareUrl(
  episode: ShareableEpisode,
  podcastTitle?: string,
  summary?: string
): string {
  return buildUrl(`e/${encodeURIComponent(episode.podcastId)}/${encodeURIComponent(episode.id)}`, [
    ["title", episode.title],
    ["desc", summary ?? ""],
    ["img", episode.imageUrl],
    ["podcast", podcastTitle],
    ["podcastId", episode.podcastId],
    ["audio", normalizeBbcAudioUrl(episode.audioUrl)],
    ["date", episode.pubDate],
    ["duration", episode.durationMins > 0 ? String(episode.durationMins) : ""]
  ]);
}

export function buildPodcastShareMessage(title: string, summary: string, url: string): string {
  const blurb = summary ? ` - ${summary}` : "";
  return `Check out "${title}"${blurb}\n\n${url}\n\n${APP_FOOTER}`;
}

export function buildEpisodeShareMessage(
  title: string,
  podcastTitle: string,
  summary: string,
  url: string
): string {
  const from = podcastTitle ? ` from ${podcastTitle}` : "";
  const blurb = summary ? ` - ${summary}` : "";
  return `Listen to "${title}"${from}${blurb}\n\n${url}\n\n${APP_FOOTER}`;
}
