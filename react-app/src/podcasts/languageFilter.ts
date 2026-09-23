import { Podcast } from "../api/podcasts";
import { Preferences } from "../storage/preferences";

// Genre tags that identify BBC World Service language services.
const NON_ENGLISH_GENRE =
  /(hindi|arabic|urdu|spanish|portuguese|russian|mandarin|cantonese|chinese|japanese|korean|bengali|gujarati|punjabi|tamil|telugu|marathi|swahili|hausa|somali|persian|farsi|turkish|french|german|italian|polish|romanian|vietnamese|thai|indonesian|malayalam|kannada|sinhala|burmese|nepali|pashto|kurdish|azerbaijani|ukrainian|serbian|croatian|greek|dutch|danish|swedish|norwegian|finnish|hungarian|czech|slovak|bulgarian|albanian|amharic|yoruba|igbo|zulu|xhosa|afrikaans|somali)/i;

// Non-Latin scripts indicate a non-English edition of a BBC service.
const NON_LATIN_SCRIPT =
  /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

/**
 * Heuristic English check for a podcast. The Kotlin build used an on-device ML language
 * detector; this approximation uses the BBC genre tags and the writing script, which is
 * reliable for the BBC's World Service language editions.
 */
export function isLikelyEnglishPodcast(podcast: Podcast): boolean {
  const haystack = `${podcast.title} ${podcast.genres.join(" ")}`;
  if (NON_LATIN_SCRIPT.test(haystack)) return false;
  if (podcast.genres.some((genre) => NON_ENGLISH_GENRE.test(genre))) return false;
  return true;
}

/** Removes non-English podcasts when the user has enabled the language filter. */
export function applyLanguageFilter(podcasts: Podcast[]): Podcast[] {
  if (!Preferences.getSetting("pref_exclude_non_english", false)) return podcasts;
  return podcasts.filter(isLikelyEnglishPodcast);
}
