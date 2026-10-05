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
 * Words that name a BBC station, a format or plain filler rather than a programme. They turn up
 * on one side of a genuine match far more often than the other — "BBC Radio 4 - In Our Time"
 * against the "In Our Time" podcast, "The Documentary Podcast" against "The Documentary" — so
 * they are dropped from both titles before comparing. A title with nothing else left can never
 * be matched, which is what stops the "BBC Radio" podcast from claiming every local show and
 * "Radio 5 Live" from claiming the "5 Live Science Podcast".
 */
const NON_IDENTIFYING_WORDS = new Set([
  "a", "an", "the", "and", "of", "in", "on", "at", "for", "to", "from", "by", "with",
  "is", "are", "bbc", "radio", "fm", "am", "tv", "live", "show", "programme", "program",
  "podcast", "podcasts", "episode", "series"
]);

/**
 * Share of the longer title's identifying words that a shorter title has to account for before
 * the two are treated as the same programme. Half is not enough: that is exactly what let the
 * one-word "Tracks" podcast match "Night Tracks", "City Soundtracks", "Cinematic Soundtracks"
 * and "Sleep Tracks". A single-word podcast therefore only ever matches a show of the same
 * single word, and "BBC Essex" no longer swallows "BBC Essex Sport".
 */
const MIN_WORD_COVERAGE = 0.6;

/**
 * Drops a plural or possessive "s" so "Chorley's" and "Chorley" compare equal. Deliberately
 * crude — it runs on both titles, so it only has to be consistent, not correct.
 */
function stripTrailingS(word: string): string {
  if (word.length >= 5 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** The words of a title that actually identify the programme, normalised and stemmed. */
function identifyingWords(text?: string): string[] {
  const words: string[] = [];
  for (const word of normalizeTitle(text).split(" ")) {
    if (!word || NON_IDENTIFYING_WORDS.has(word)) continue;
    words.push(stripTrailingS(word));
  }
  return words;
}

/** True when `short` appears inside `long` as an unbroken run of words, in the same order. */
function isContiguousRun(short: string[], long: string[]): boolean {
  if (short.length === 0 || short.length > long.length) return false;
  for (let i = 0; i + short.length <= long.length; i++) {
    let matched = 0;
    while (matched < short.length && long[i + matched] === short[matched]) matched++;
    if (matched === short.length) return true;
  }
  return false;
}

interface PodcastWordIndex {
  byFirstWord: Map<string, PodcastLike[]>;
  allWords: WeakMap<PodcastLike, string[]>;
}

/**
 * Per-catalogue word index. The guide matches every schedule block against the whole podcast
 * catalogue, so the identifying words are tokenised once per podcast and bucketed by first word
 * rather than recomputed for every block.
 */
const podcastIndexCache = new WeakMap<object, PodcastWordIndex>();

function getPodcastIndex<T extends PodcastLike>(podcastMap: Map<string, T>): PodcastWordIndex {
  const cached = podcastIndexCache.get(podcastMap);
  if (cached) return cached;

  const byFirstWord = new Map<string, PodcastLike[]>();
  const allWords = new WeakMap<PodcastLike, string[]>();
  for (const podcast of podcastMap.values()) {
    const words = identifyingWords(podcast.title);
    allWords.set(podcast, words);
    if (words.length === 0) continue;
    const bucket = byFirstWord.get(words[0]);
    if (bucket) bucket.push(podcast);
    else byFirstWord.set(words[0], [podcast]);
  }

  const index: PodcastWordIndex = { byFirstWord, allWords };
  podcastIndexCache.set(podcastMap, index);
  return index;
}

/**
 * Matches a schedule show title with a podcast in the catalog.
 *
 * A match has to be the same programme, not merely to share a word with it. In order of
 * confidence: an identical title, then an identical set of identifying words (which absorbs the
 * "BBC Radio 4 - " prefixes and the trailing "Podcast"), then one title whose identifying words
 * cover at least {@link MIN_WORD_COVERAGE} of the other's as an unbroken run. Anything looser
 * used to match "Cinematic Soundtracks" to the unrelated "Tracks" podcast.
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

  const showWords = identifyingWords(showTitle);
  if (showWords.length > 0) {
    const index = getPodcastIndex(podcastMap);
    // Only podcasts starting on one of the show's words can be a run match, and the candidates
    // are deduplicated so a repeated word does not compare the same podcast twice.
    const candidates = new Set<PodcastLike>();
    for (const word of showWords) {
      const bucket = index.byFirstWord.get(word);
      if (!bucket) continue;
      for (const podcast of bucket) candidates.add(podcast);
    }

    let best: { podcast: T; coverage: number; words: number } | undefined;
    for (const podcast of candidates) {
      const podcastWords = index.allWords.get(podcast) || [];
      if (podcastWords.length === 0) continue;

      let matchedWords: number;
      let sameWords: boolean;
      if (showWords.length === podcastWords.length) {
        sameWords = showWords.every((word, i) => word === podcastWords[i]);
        matchedWords = showWords.length;
      } else if (showWords.length < podcastWords.length) {
        sameWords = isContiguousRun(showWords, podcastWords);
        matchedWords = showWords.length;
      } else {
        sameWords = isContiguousRun(podcastWords, showWords);
        matchedWords = podcastWords.length;
      }
      if (!sameWords) continue;

      const coverage = matchedWords / Math.max(showWords.length, podcastWords.length);
      if (coverage < MIN_WORD_COVERAGE) continue;
      if (
        !best ||
        coverage > best.coverage ||
        (coverage === best.coverage && matchedWords > best.words)
      ) {
        best = { podcast: podcast as T, coverage, words: matchedWords };
      }
    }
    if (best) return best.podcast;
  }

  const normEpisode = normalizeTitle(episodeTitle);
  if (normEpisode && podcastMap.has(normEpisode)) {
    return podcastMap.get(normEpisode);
  }

  return undefined;
}
