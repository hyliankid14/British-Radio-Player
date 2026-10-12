import type { Station } from "../data/stations.ts";
import { StationRepository } from "../data/stations.ts";
import type { Episode, Podcast } from "../api/podcasts.ts";

export const VOICE_URL_PREFIX = "bbcradioplayer://voice/";

export type VoiceActionType = "play" | "stop" | "resume";

export interface VoiceAction {
  action: VoiceActionType;
  stationId?: string | null;
  podcastId?: string | null;
  episodeId?: string | null;
  query?: string | null;
  random?: boolean;
  resume?: boolean;
}

/**
 * Parses incoming voice deep links (e.g. `bbcradioplayer://voice/play?station=radio1`,
 * `bbcradioplayer://voice/play?podcast=p086w16s`, `bbcradioplayer://voice/play?query=Desert%20Island%20Discs`).
 *
 * Returns null for any URL not matching the voice scheme prefix or with an unrecognized action.
 */
export function parseVoiceActionUrl(url: string | null | undefined): VoiceAction | null {
  if (!url || typeof url !== "string" || !url.startsWith(VOICE_URL_PREFIX)) {
    return null;
  }

  const [rawAction, rawQuery = ""] = url.slice(VOICE_URL_PREFIX.length).split("?");
  const actionName = rawAction.toLowerCase().trim();

  let action: VoiceActionType;
  if (actionName === "play") {
    action = "play";
  } else if (actionName === "stop") {
    action = "stop";
  } else if (actionName === "resume") {
    action = "resume";
  } else {
    return null;
  }

  let stationId: string | null = null;
  let podcastId: string | null = null;
  let episodeId: string | null = null;
  let query: string | null = null;
  let random = false;
  let isResumeFlag = false;

  if (rawQuery) {
    const searchParams = new URLSearchParams(rawQuery);
    const stationParam = searchParams.get("station");
    if (stationParam) stationId = stationParam.trim() || null;

    const podcastParam = searchParams.get("podcast");
    if (podcastParam) podcastId = podcastParam.trim() || null;

    const episodeParam = searchParams.get("episode");
    if (episodeParam) episodeId = episodeParam.trim() || null;

    const queryParam = searchParams.get("query");
    if (queryParam) query = queryParam.trim() || null;

    const randomParam = searchParams.get("random");
    if (randomParam === "true" || randomParam === "1") {
      random = true;
    }

    const resumeParam = searchParams.get("resume");
    if (resumeParam === "true" || resumeParam === "1") {
      isResumeFlag = true;
    }
  }

  if (action === "play" && isResumeFlag && !stationId && !podcastId && !query && !random) {
    action = "resume";
  }

  return {
    action,
    stationId,
    podcastId,
    episodeId,
    query,
    random
  };
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6"
};

/**
 * Normalises a search string by mapping number words ("one" -> "1") and stripping punctuation.
 */
function normalizeVoiceQuery(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return words.map((w) => NUMBER_WORDS[w] ?? w).join(" ");
}

/**
 * Matches a station for a spoken voice query, following the same scoring principles
 * used by Android Auto and the legacy radio service.
 */
export function matchStationForVoiceQuery(
  rawQuery: string,
  stations: Station[] = StationRepository.getAll()
): Station | null {
  const query = rawQuery.trim();
  if (!query || stations.length === 0) return null;

  const qNorm = normalizeVoiceQuery(query);
  const qTokens = qNorm.split(/\s+/).filter(Boolean);
  const qTokenSet = new Set(qTokens);
  const qTerms = qTokens.filter((t) => t !== "bbc" && t !== "play" && t !== "the" && t !== "to");

  let bestStation: Station | null = null;
  let bestScore = 0;

  for (const station of stations) {
    const titleNorm = normalizeVoiceQuery(station.title);
    const idNorm = normalizeVoiceQuery(station.id);
    const titleTokens = titleNorm.split(/\s+/).filter(Boolean);
    const idTokens = idNorm.split(/\s+/).filter(Boolean);

    // Exact title or ID match gets the highest priority
    if (titleNorm === qNorm || idNorm === qNorm) {
      return station;
    }

    // Direct whole-phrase boundary match
    const titleRegex = new RegExp(`(^|\\s)${titleNorm.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(\\s|$)`);
    if (titleRegex.test(qNorm)) {
      const score = 100 + titleNorm.length;
      if (score > bestScore) {
        bestScore = score;
        bestStation = station;
      }
      continue;
    }

    // Token-based matching
    if (qTerms.length === 0) continue;
    let score = 0;
    for (const term of qTerms) {
      if (titleTokens.includes(term)) {
        score += 10;
      }
      if (idTokens.includes(term)) {
        score += 5;
      }
    }

    // Distinct tokens (excluding generic "radio" and "bbc")
    const specificTokens = titleTokens.filter((t) => t !== "radio" && t !== "bbc");
    if (specificTokens.length > 0 && specificTokens.every((tok) => qTokenSet.has(tok))) {
      score += 30;
    }

    if (score >= 20 && score > bestScore) {
      bestScore = score;
      bestStation = station;
    }
  }

  return bestScore >= 20 ? bestStation : null;
}

/**
 * Matches a podcast for a spoken voice query from an array of podcasts.
 * Prefers title matches over description matches.
 */
export function matchPodcastForVoiceQuery(rawQuery: string, podcasts: Podcast[]): Podcast | null {
  const query = rawQuery.trim();
  if (!query || podcasts.length === 0) return null;

  const qNorm = normalizeVoiceQuery(query);
  const qTerms = qNorm.split(" ").filter((t) => t.length > 0 && t !== "podcast" && t !== "play" && t !== "the");

  let bestPodcast: Podcast | null = null;
  let bestScore = 0;

  for (const podcast of podcasts) {
    const titleNorm = normalizeVoiceQuery(podcast.title);
    const descNorm = normalizeVoiceQuery(podcast.description || "");

    // Exact title match gets absolute priority
    if (titleNorm === qNorm) {
      return podcast;
    }

    let score = 0;
    if (titleNorm.includes(qNorm)) {
      score += 50;
    }

    for (const term of qTerms) {
      if (titleNorm.includes(term)) {
        score += 10;
      } else if (descNorm.includes(term)) {
        score += 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPodcast = podcast;
    }
  }

  return bestScore > 0 ? bestPodcast : null;
}

/**
 * Selects an episode for playback: skips already fully played episodes,
 * falling back to the first/latest episode if all have been listened to.
 */
export function selectEpisodeForVoicePlayback(
  episodes: Episode[],
  isEpisodePlayed?: (episodeId: string) => boolean
): Episode | null {
  if (!episodes || episodes.length === 0) return null;

  const isPlayed = isEpisodePlayed ?? (() => false);
  const unplayed = episodes.find((ep) => !isPlayed(ep.id));
  return unplayed ?? episodes[0];
}

async function getOrFetchCatalog(): Promise<Podcast[]> {
  const { PodcastApi } = await import("../api/podcasts.ts");
  const cached = PodcastApi.getCachedCatalog();
  if (cached && cached.length > 0) return cached;
  return PodcastApi.fetchLiveCatalog().catch(() => [] as Podcast[]);
}

/**
 * Resolves and executes a voice action triggered by Siri or voice deep links.
 */
export async function executeVoiceAction(action: VoiceAction): Promise<boolean> {
  const { usePlayerStore } = await import("../store/playerStore.ts");
  const { Preferences } = await import("../storage/preferences.ts");
  const { PodcastApi } = await import("../api/podcasts.ts");
  const player = usePlayerStore.getState();

  if (action.action === "stop") {
    await player.stop();
    return true;
  }

  if (action.action === "resume") {
    if (player.isPlaying) return true;
    if (player.currentStation) {
      await player.playStation(player.currentStation);
      return true;
    }
    if (player.currentEpisode && player.currentPodcast) {
      await player.playEpisode(player.currentPodcast, player.currentEpisode);
      return true;
    }

    const lastPlayed = Preferences.getLastPlayed();
    if (lastPlayed) {
      if (lastPlayed.kind === "station") {
        const station = StationRepository.getById(lastPlayed.id);
        if (station) {
          await player.playStation(station);
          return true;
        }
      }
    }

    const defaultStation = StationRepository.getAll()[0];
    if (defaultStation) {
      await player.playStation(defaultStation);
      return true;
    }
    return false;
  }

  // Play explicit station
  if (action.stationId) {
    const station = StationRepository.getById(action.stationId);
    if (station) {
      await player.playStation(station);
      return true;
    }
  }

  // Play random podcast
  if (action.random) {
    const catalog: Podcast[] = await getOrFetchCatalog();
    const subscribedIds = Preferences.getSubscribedPodcasts();
    const candidateList =
      subscribedIds.length > 0
        ? catalog.filter((p: Podcast) => subscribedIds.includes(p.id))
        : catalog;

    const list = candidateList.length > 0 ? candidateList : catalog;
    if (list.length > 0) {
      const randomIndex = Math.floor(Math.random() * list.length);
      const chosen = list[randomIndex];
      const episodes = await PodcastApi.fetchEpisodes(chosen.rssUrl, chosen.id).catch(() => [] as Episode[]);
      const episode = selectEpisodeForVoicePlayback(episodes);
      if (episode) {
        await player.playEpisode(chosen, episode);
        return true;
      }
    }
  }

  // Play explicit podcast
  if (action.podcastId) {
    const catalog: Podcast[] = await getOrFetchCatalog();
    let podcast: Podcast | undefined;

    if (action.podcastId === "recent") {
      const lastPlayed = Preferences.getLastPlayed();
      if (lastPlayed?.kind === "episode" && lastPlayed.podcastId) {
        podcast = catalog.find((p: Podcast) => p.id === lastPlayed.podcastId);
      }
      if (!podcast) {
        const subscribedIds = Preferences.getSubscribedPodcasts();
        if (subscribedIds.length > 0) {
          podcast = catalog.find((p: Podcast) => p.id === subscribedIds[0]);
        }
      }
      if (!podcast && catalog.length > 0) {
        podcast = catalog[0];
      }
    } else {
      podcast = catalog.find((p: Podcast) => p.id === action.podcastId);
    }

    if (podcast) {
      const episodes = await PodcastApi.fetchEpisodes(podcast.rssUrl, podcast.id).catch(() => [] as Episode[]);
      const episode = action.episodeId
        ? episodes.find((e) => e.id === action.episodeId) ?? selectEpisodeForVoicePlayback(episodes)
        : selectEpisodeForVoicePlayback(episodes);

      if (episode) {
        await player.playEpisode(podcast, episode);
        return true;
      }
    }
  }

  // Handle free-form voice query (e.g. "play radio 1", "play desert island discs", "play random podcast")
  if (action.query) {
    const query = action.query.trim();
    if (query.toLowerCase().includes("random")) {
      return executeVoiceAction({ action: "play", random: true });
    }

    // Try matching station first
    const matchedStation = matchStationForVoiceQuery(query);
    if (matchedStation) {
      await player.playStation(matchedStation);
      return true;
    }

    // Try matching podcast
    const catalog: Podcast[] = await getOrFetchCatalog();
    const subscribedIds = Preferences.getSubscribedPodcasts();
    const subscribedPodcasts = catalog.filter((p: Podcast) => subscribedIds.includes(p.id));

    // Prefer subscribed podcasts first
    const matchedPodcast =
      matchPodcastForVoiceQuery(query, subscribedPodcasts) ??
      matchPodcastForVoiceQuery(query, catalog);

    if (matchedPodcast) {
      const episodes = await PodcastApi.fetchEpisodes(matchedPodcast.rssUrl, matchedPodcast.id).catch(() => [] as Episode[]);
      const episode = selectEpisodeForVoicePlayback(episodes);
      if (episode) {
        await player.playEpisode(matchedPodcast, episode);
        return true;
      }
    }

    // Fall back to resuming or playing the first station
    return executeVoiceAction({ action: "resume" });
  }

  // Fallback to default playback if no target was specified
  return executeVoiceAction({ action: "resume" });
}
