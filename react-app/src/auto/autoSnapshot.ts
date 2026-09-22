import { Episode, Podcast, PodcastApi } from "../api/podcasts";
import { AudioQuality, StationRepository } from "../data/stations";
import { PodcastHistoryEntry, Preferences, SavedEpisodeEntry } from "../storage/preferences";

/** Episode shape consumed by the native Android Auto service. */
export interface AutoEpisode {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  audioUrl: string;
  pubDate: string;
  pubDateEpochMs: number;
  durationMins: number;
  podcastId: string;
  podcastTitle: string;
  podcastImageUrl: string;
  localFilePath?: string;
}

interface AutoStation {
  id: string;
  title: string;
  serviceId: string;
  streamServiceIds: string[];
  directStreamUrls: string[];
  logoUrl: string;
}

interface AutoPodcast {
  id: string;
  title: string;
  description: string;
  rssUrl: string;
  imageUrl: string;
  genres: string[];
  typicalDurationMins: number;
  latestUpdateMs: number;
}

interface AutoPlaylist {
  id: string;
  name: string;
  isDefault: boolean;
  entries: AutoEpisode[];
}

/** Complete state pushed to the native Android Auto service. */
export interface AutoSnapshot {
  version: number;
  generatedAtMs: number;
  stations: AutoStation[];
  favorites: string[];
  audioQuality: AudioQuality;
  autoQuality: boolean;
  geoBlocked: boolean;
  startupPage: string;
  scrollMode: string;
  podcastArtwork: string;
  pauseBuffering: boolean;
  autoplayNext: string;
  hidePlayedInPlaylists: boolean;
  carplayStation: string;
  carplayAutoResume: boolean;
  carplayHidePlayed: boolean;
  lastStationId: string;
  subscriptions: AutoPodcast[];
  subscribedIds: string[];
  podcastSort: string;
  podcastManualOrder: string[];
  podcastTags: Record<string, string[]>;
  episodes: Record<string, AutoEpisode[]>;
  playlists: AutoPlaylist[];
  downloads: AutoEpisode[];
  history: AutoEpisode[];
  playedIds: string[];
  progress: Record<string, number>;
  lastPlayedEpoch: Record<string, number>;
  /** Set by the sync layer so native code can avoid double playback. */
  phonePlaybackActive: boolean;
}

export function parseEpisodeDateEpoch(pubDate?: string): number {
  if (!pubDate) return 0;
  const parsed = Date.parse(pubDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortEpisodes(episodes: Episode[], podcastId: string): Episode[] {
  const order = Preferences.getPodcastEpisodeSort(podcastId);
  return [...episodes].sort((a, b) => {
    const aEpoch = parseEpisodeDateEpoch(a.pubDate);
    const bEpoch = parseEpisodeDateEpoch(b.pubDate);
    if (aEpoch && bEpoch) {
      return order === "oldest_first" ? aEpoch - bEpoch : bEpoch - aEpoch;
    }
    return 0;
  });
}

function toAutoEpisode(
  episode: Episode,
  podcastId: string,
  podcastTitle: string,
  podcastImageUrl: string
): AutoEpisode {
  return {
    id: episode.id,
    title: episode.title,
    description: episode.description,
    imageUrl: episode.imageUrl || podcastImageUrl,
    audioUrl: episode.audioUrl,
    pubDate: episode.pubDate,
    pubDateEpochMs: parseEpisodeDateEpoch(episode.pubDate),
    durationMins: episode.durationMins,
    podcastId,
    podcastTitle,
    podcastImageUrl
  };
}

function historyToAutoEpisode(entry: PodcastHistoryEntry): AutoEpisode {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    imageUrl: entry.imageUrl,
    audioUrl: entry.audioUrl,
    pubDate: entry.pubDate,
    pubDateEpochMs: parseEpisodeDateEpoch(entry.pubDate),
    durationMins: entry.durationMins,
    podcastId: entry.podcastId,
    podcastTitle: entry.podcastTitle,
    podcastImageUrl: entry.imageUrl
  };
}

function savedToAutoEpisode(entry: SavedEpisodeEntry): AutoEpisode {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    imageUrl: entry.imageUrl,
    audioUrl: entry.audioUrl,
    pubDate: entry.pubDate,
    pubDateEpochMs: parseEpisodeDateEpoch(entry.pubDate),
    durationMins: entry.durationMins,
    podcastId: entry.podcastId,
    podcastTitle: entry.podcastTitle,
    podcastImageUrl: entry.imageUrl
  };
}

let catalogCache: Podcast[] = [];
let catalogFetchedAtMs = 0;
const CATALOG_TTL_MS = 10 * 60 * 1000;

async function loadCatalog(): Promise<Podcast[]> {
  const now = Date.now();
  if (catalogCache.length && now - catalogFetchedAtMs < CATALOG_TTL_MS) return catalogCache;
  try {
    const catalog = await PodcastApi.fetchLiveCatalog();
    if (Array.isArray(catalog) && catalog.length) {
      catalogCache = catalog;
      catalogFetchedAtMs = now;
    }
  } catch {
    // Offline: fall back to the last known catalogue.
  }
  return catalogCache;
}

/**
 * Builds the complete Android Auto state snapshot from React-side storage.
 *
 * Podcast episode data is taken from the in-memory episode cache, so this never
 * triggers a network fetch on the critical path. Pass `includePodcastData = false`
 * for a fast, stations-only snapshot (used to make the head unit browsable
 * immediately on cold start).
 */
export async function buildAutoSnapshot(includePodcastData = true): Promise<AutoSnapshot> {
  const catalog = includePodcastData ? await loadCatalog() : [];
  const catalogById = new Map(catalog.map((podcast) => [podcast.id, podcast]));

  const subscribedIds = Preferences.getSubscribedPodcasts();
  const episodes: Record<string, AutoEpisode[]> = {};
  const podcastTags: Record<string, string[]> = {};
  const subscriptions: AutoPodcast[] = [];

  if (includePodcastData) {
    const cachedPodcastIds = new Set<string>(subscribedIds);
    for (const podcastId of cachedPodcastIds) {
      const cached = PodcastApi.getEpisodesFromCache(podcastId);
      if (cached && cached.length) {
        const podcast = catalogById.get(podcastId);
        const title = podcast?.title || podcastId;
        const image = podcast?.imageUrl || "";
        const sorted = sortEpisodes(cached, podcastId);
        episodes[podcastId] = sorted.map((episode) => toAutoEpisode(episode, podcastId, title, image));
      }
    }

    for (const podcastId of subscribedIds) {
      const podcast = catalogById.get(podcastId);
      const cached = PodcastApi.getEpisodesFromCache(podcastId) || [];
      const latest = cached.reduce((max, episode) => Math.max(max, parseEpisodeDateEpoch(episode.pubDate)), 0);
      subscriptions.push({
        id: podcastId,
        title: podcast?.title || podcastId,
        description: podcast?.description || "",
        rssUrl: podcast?.rssUrl || `https://podcasts.files.bbci.co.uk/${podcastId}.rss`,
        imageUrl: podcast?.imageUrl || "",
        genres: podcast?.genres || [],
        typicalDurationMins: podcast?.typicalDurationMins || 0,
        latestUpdateMs: latest
      });
      podcastTags[podcastId] = Preferences.getPodcastTags(podcastId, podcast?.genres || []);
    }
  }

  const playlistEntryMap = Preferences.getPlaylistEntryMap();
  const playlists: AutoPlaylist[] = Preferences.getPodcastPlaylists()
    .filter((playlist) => !playlist.isDefault)
    .map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      isDefault: false,
      entries: (playlistEntryMap[playlist.id] || []).map(savedToAutoEpisode)
    }));
  const savedEntries = Preferences.getPodcastPlaylistEntries("saved");
  playlists.unshift({
    id: "saved",
    name: "Saved Episodes",
    isDefault: true,
    entries: savedEntries.map(savedToAutoEpisode)
  });

  const progressSeconds = Preferences.getMap("pref_episode_progress");
  const progressMs: Record<string, number> = {};
  for (const [episodeId, seconds] of Object.entries(progressSeconds)) {
    if (typeof seconds === "number" && seconds > 0) progressMs[episodeId] = Math.floor(seconds * 1000);
  }

  return {
    version: 1,
    generatedAtMs: Date.now(),
    stations: StationRepository.getAll().map((station) => ({
      id: station.id,
      title: station.title,
      serviceId: station.serviceId,
      streamServiceIds: station.streamServiceIds,
      directStreamUrls: station.directStreamUrls,
      logoUrl: station.logoUrl
    })),
    favorites: Preferences.getFavorites(),
    audioQuality: Preferences.getAudioQuality(),
    autoQuality: Preferences.getSetting("pref_auto_quality", true),
    geoBlocked: Preferences.getGeoBlocked(),
    startupPage: Preferences.getSetting("pref_startup_page", "all_stations"),
    scrollMode: Preferences.getSetting("pref_scroll_mode", "all"),
    podcastArtwork: Preferences.getSetting("pref_podcast_artwork", "episode"),
    pauseBuffering: Preferences.getSetting("pref_pause_buffering", true),
    autoplayNext: Preferences.getSetting("pref_autoplay_next", "none"),
    hidePlayedInPlaylists: Preferences.getHidePlayedEpisodesInPlaylists(),
    carplayStation: Preferences.getSetting("pref_carplay_station", ""),
    carplayAutoResume: Preferences.getSetting("pref_carplay_auto_resume", true),
    carplayHidePlayed: Preferences.getSetting("pref_carplay_hide_played", false),
    lastStationId: Preferences.getLastStationId(),
    subscriptions,
    subscribedIds,
    podcastSort: Preferences.getSubscribedPodcastSort(),
    podcastManualOrder: Preferences.getSubscribedPodcastManualOrder(),
    podcastTags,
    episodes,
    playlists,
    downloads: Preferences.getPodcastPlaylistEntries("downloaded").map(savedToAutoEpisode),
    history: Preferences.getPodcastHistory().map(historyToAutoEpisode),
    playedIds: Preferences.getPlayedEpisodeIds(),
    progress: progressMs,
    lastPlayedEpoch: Preferences.getMap("pref_last_played_epoch"),
    phonePlaybackActive: false
  };
}
