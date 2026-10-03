import type { Podcast } from "../api/podcasts";

/**
 * BBC services that publish in a language other than English: the World Service
 * language editions plus the Welsh (Cymru) and Gaelic (nan Gàidheal / Alba) services.
 * Matched against `ownership.service.key` from `https://www.bbc.co.uk/programmes/{pid}.json`.
 *
 * Only these need a feed fetch to decide their language. The other ~700 catalogue
 * podcasts belong to English-language services, so the service key alone settles them
 * and the 1.2 kB programme JSON replaces a 100 kB+ feed download.
 *
 * A new non-English service added by the BBC would read as English here and its
 * podcasts would stay visible, so keep this list in step with the catalogue.
 */
const FOREIGN_LANGUAGE_SERVICES = new Set([
  // World Service language editions
  "hindiradio",
  "arabicradio",
  "persianradio",
  "russianradio",
  "burmeseradio",
  "gahuzaradio",
  "bbcmarathiaudio",
  "tamilradio",
  "urduradio",
  "gujaratiradio",
  "nepaliradio",
  "bbcukrainianaudio",
  "kyrgyzradio",
  "cantoneseradio",
  "indonesiaradio",
  "bbcmundo",
  "brasil",
  // UK minority-language services
  "radiocymru",
  "bbc_cymru",
  "radionangaidheal",
  "bbcalba"
]);

/** True for `en`, `en-gb`, `en-001` and any other English tag. */
export function isEnglishLanguageTag(tag: string): boolean {
  return /^en(?:$|[-_])/i.test(tag.trim());
}

export function isForeignLanguageService(serviceKey: string): boolean {
  return FOREIGN_LANGUAGE_SERVICES.has(serviceKey);
}

/** Reads the channel `<language>` tag from an RSS document. */
export function readFeedLanguage(xml: string): string | null {
  const match = /<language>([^<]*)<\/language>/i.exec(xml);
  const tag = match?.[1]?.trim().toLowerCase();
  return tag ? tag : null;
}

/** Reads `ownership.service.key` from a programme JSON document. */
export function readProgrammeService(json: string): string | null {
  try {
    const parsed = JSON.parse(json);
    const key = parsed?.programme?.ownership?.service?.key;
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

// Genre tags that identify BBC World Service language services.
const NON_ENGLISH_GENRE =
  /(hindi|arabic|urdu|spanish|portuguese|russian|mandarin|cantonese|chinese|japanese|korean|bengali|gujarati|punjabi|tamil|telugu|marathi|swahili|hausa|somali|persian|farsi|turkish|french|german|italian|polish|romanian|vietnamese|thai|indonesian|malayalam|kannada|sinhala|burmese|nepali|pashto|kurdish|azerbaijani|ukrainian|serbian|croatian|greek|dutch|danish|swedish|norwegian|finnish|hungarian|czech|slovak|bulgarian|albanian|amharic|yoruba|igbo|zulu|xhosa|afrikaans|somali)/i;

// Non-Latin scripts indicate a non-English edition of a BBC service.
const NON_LATIN_SCRIPT =
  /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

/**
 * Best guess for a podcast the language index has not resolved yet, from the BBC
 * genre tags and the writing script. It is a safety net rather than the main test:
 * the Welsh and Gaelic services write in the Latin script and carry ordinary genre
 * tags, so text alone cannot separate them from English. The index settles those from
 * the feed's own `<language>` tag.
 */
export function looksNonEnglishByText(podcast: Podcast): boolean {
  const haystack = `${podcast.title} ${podcast.genres.join(" ")}`;
  if (NON_LATIN_SCRIPT.test(haystack)) return true;
  return podcast.genres.some((genre) => NON_ENGLISH_GENRE.test(genre));
}

/**
 * Whether a podcast is English, given whatever the language index knows about it.
 *
 * A foreign-language service *and* a non-Latin title together outrank the feed's
 * `<language>` tag. Some BBC Hindi feeds ship a wrong `<language>en</language>` —
 * `p0fmrg25`, `p055260j` and `p05527ds` all do, and all three are dormant Hindi shows
 * (last episodes 2023, 2022 and 2019) rather than the English shows the tag implies. The
 * conjunction is deliberately narrow: a Latin-script show on a foreign service keeps its
 * tag, so English programmes in Welsh or Gaelic are unaffected.
 *
 * Failing that, the feed's `<language>` tag is authoritative when present, so an English
 * podcast whose title is set in a non-Latin script stays visible. Then a podcast on a
 * known English BBC service is English, and only a podcast the index has not placed at
 * all falls back to the text guess.
 */
export function isEnglishPodcast(
  podcast: Podcast,
  languageTag?: string,
  serviceKey?: string
): boolean {
  if (serviceKey && isForeignLanguageService(serviceKey) && looksNonEnglishByText(podcast)) {
    return false;
  }
  if (languageTag) return isEnglishLanguageTag(languageTag);
  if (serviceKey && !isForeignLanguageService(serviceKey)) return true;
  return !looksNonEnglishByText(podcast);
}
