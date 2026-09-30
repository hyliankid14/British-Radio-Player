import type { Podcast } from "../api/podcasts";
import { Preferences } from "../storage/preferences";
import { getLanguageTag, getServiceKey } from "./languageResolver";
import { isEnglishPodcast } from "./languageRules";

/**
 * Whether a podcast is English, consulting the language index built by
 * `ensureLanguageIndex` and falling back to a text guess for anything unresolved.
 */
export function isLikelyEnglishPodcast(podcast: Podcast): boolean {
  return isEnglishPodcast(podcast, getLanguageTag(podcast.id), getServiceKey(podcast.id));
}

/** Removes non-English podcasts when the user has enabled the language filter. */
export function applyLanguageFilter(podcasts: Podcast[]): Podcast[] {
  if (!Preferences.getSetting("pref_exclude_non_english", false)) return podcasts;
  return podcasts.filter(isLikelyEnglishPodcast);
}
