import type { AutoNativeEvent } from "./autoBridge";

export interface AutoMutationSink {
  getFavorites(): string[];
  setFavorites(stationIds: string[]): void;
  getSubscribedPodcasts(): string[];
  setSubscribedPodcasts(podcastIds: string[]): void;
  addPodcastPlaylistEntry(playlist: "saved", entry: any): void;
  removePodcastPlaylistEntry(playlist: "saved", episodeId: string): void;
  markEpisodePlayed(episodeId: string, podcastId?: string, pubDateEpochMs?: number): void;
  setEpisodeProgress(episodeId: string, positionSec: number): void;
  addPodcastHistory(entry: {
    id: string;
    title?: string;
    description?: string;
    imageUrl?: string;
    audioUrl?: string;
    pubDate?: string;
    durationMins?: number;
    podcastId?: string;
    podcastTitle?: string;
    playedAtMs?: number;
  }): void;
  setLastPlayed(entry: {
    kind: "station" | "episode";
    id: string;
    podcastId?: string;
    atMs?: number;
  }): void;
  setLastStationId?(stationId: string): void;
  addRecentSong(song: {
    artist: string;
    track: string;
    imageUrl: string;
    stationId: string;
    stationName: string;
  }): void;
  onPlaybackStarted?(payload: Record<string, any>): void;
}

/** Parses raw event payloads whether given as JSON strings or pre-parsed objects. */
export function parseAutoPayload(raw: any): Record<string, any> {
  if (raw && typeof raw === "object") {
    if ("payload" in raw && (typeof raw.payload === "object" || typeof raw.payload === "string")) {
      return parseAutoPayload(raw.payload);
    }
    return raw;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Applies a single mutation event emitted from Android Auto or CarPlay to the state sink.
 */
export function applyAutoMutation(event: AutoNativeEvent, sink: AutoMutationSink): void {
  const payload = parseAutoPayload(event.payload);
  switch (event.type) {
    case "favoriteToggled": {
      const stationId = String(payload.stationId || "");
      if (!stationId) break;
      const favorites = sink.getFavorites();
      const isFavorite = favorites.includes(stationId);
      if (payload.favorite && !isFavorite) {
        sink.setFavorites([...favorites, stationId]);
      } else if (!payload.favorite && isFavorite) {
        sink.setFavorites(favorites.filter((id) => id !== stationId));
      }
      break;
    }

    case "subscribeToggled": {
      const podcastId = String(payload.podcastId || "");
      if (!podcastId) break;
      const subscribed = sink.getSubscribedPodcasts();
      const isSubscribed = subscribed.includes(podcastId);
      if (payload.subscribed && !isSubscribed) {
        sink.setSubscribedPodcasts([...subscribed, podcastId]);
      } else if (!payload.subscribed && isSubscribed) {
        sink.setSubscribedPodcasts(subscribed.filter((id) => id !== podcastId));
      }
      break;
    }

    case "savedToggled": {
      const entry = payload.entry as Record<string, any> | undefined;
      const episodeId = String(entry?.id || payload.episodeId || "");
      if (!episodeId) break;
      if (payload.saved === true && entry) {
        sink.addPodcastPlaylistEntry("saved", {
          id: episodeId,
          title: String(entry.title || ""),
          description: String(entry.description || ""),
          imageUrl: String(entry.imageUrl || entry.podcastImageUrl || ""),
          audioUrl: String(entry.audioUrl || ""),
          pubDate: String(entry.pubDate || ""),
          durationMins: Number(entry.durationMins || 0),
          podcastId: String(entry.podcastId || ""),
          podcastTitle: String(entry.podcastTitle || "")
        });
      } else {
        sink.removePodcastPlaylistEntry("saved", episodeId);
      }
      break;
    }

    case "episodePlayed": {
      const episodeId = String(payload.episodeId || "");
      if (!episodeId) break;
      sink.markEpisodePlayed(
        episodeId,
        payload.podcastId ? String(payload.podcastId) : undefined,
        typeof payload.pubDateEpochMs === "number" && payload.pubDateEpochMs > 0
          ? payload.pubDateEpochMs
          : undefined
      );
      break;
    }

    case "episodeProgress": {
      const episodeId = String(payload.episodeId || "");
      const positionMs = Number(payload.positionMs || 0);
      if (episodeId && positionMs > 0) {
        sink.setEpisodeProgress(episodeId, positionMs / 1000);
      }
      break;
    }

    case "podcastHistoryAdded": {
      const entry = payload as Record<string, any>;
      const episodeId = String(entry.id || "").trim();
      if (!episodeId) break;
      sink.addPodcastHistory({
        id: episodeId,
        title: String(entry.title || "").trim(),
        description: String(entry.description || "").trim(),
        imageUrl: String(entry.imageUrl || entry.podcastImageUrl || "").trim(),
        audioUrl: String(entry.audioUrl || "").trim(),
        pubDate: String(entry.pubDate || "").trim(),
        durationMins: Number(entry.durationMins || 0),
        podcastId: String(entry.podcastId || "").trim(),
        podcastTitle: String(entry.podcastTitle || "").trim(),
        playedAtMs: typeof entry.playedAtMs === "number" && entry.playedAtMs > 0 ? entry.playedAtMs : undefined
      });
      break;
    }

    case "lastPlayed": {
      const id = String(payload.id || "");
      if (!id) break;
      const kind = payload.kind === "episode" ? "episode" : "station";
      sink.setLastPlayed({
        kind,
        id,
        podcastId: String(payload.podcastId || ""),
        ...(typeof payload.atMs === "number" && payload.atMs > 0 ? { atMs: payload.atMs } : {})
      });
      if (kind === "station" && sink.setLastStationId) {
        sink.setLastStationId(id);
      }
      break;
    }

    case "recentSongAdded": {
      const entry = payload as Record<string, any>;
      const artist = String(entry?.artist || "").trim();
      const track = String(entry?.track || "").trim();
      if (artist || track) {
        sink.addRecentSong({
          artist,
          track,
          imageUrl: String(entry?.imageUrl || ""),
          stationId: String(entry?.stationId || ""),
          stationName: String(entry?.stationName || "")
        });
      }
      break;
    }

    case "playbackStarted": {
      if (payload.kind === "episode") {
        const episodeId = String(payload.id || "").trim();
        if (episodeId) {
          sink.addPodcastHistory({
            id: episodeId,
            title: String(payload.title || "").trim(),
            description: String(payload.description || "").trim(),
            imageUrl: String(payload.imageUrl || payload.podcastImageUrl || "").trim(),
            audioUrl: String(payload.audioUrl || "").trim(),
            pubDate: String(payload.pubDate || "").trim(),
            durationMins: Number(payload.durationMins || 0),
            podcastId: String(payload.podcastId || "").trim(),
            podcastTitle: String(payload.subtitle || payload.podcastTitle || "").trim(),
            playedAtMs: typeof payload.playedAtMs === "number" && payload.playedAtMs > 0 ? payload.playedAtMs : undefined
          });
        }
      }
      sink.onPlaybackStarted?.(payload);
      break;
    }

    default:
      break;
  }
}

/**
 * Drains a list of mutations in order into the provided state sink.
 */
export function applyAutoMutations(mutations: AutoNativeEvent[], sink: AutoMutationSink): void {
  for (const m of mutations) {
    applyAutoMutation(m, sink);
  }
}
