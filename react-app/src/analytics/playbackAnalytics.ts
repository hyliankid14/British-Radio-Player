/**
 * Strictly more than 10 seconds of active playback required before analytics are recorded.
 * Matches legacy Kotlin RadioService `ANALYTICS_MIN_PLAY_MS = 10_001L`.
 */
export const ANALYTICS_MIN_PLAY_MS = 10_001;

export interface PlaybackAnalyticsStorage {
  getLastTrackedAnalyticsEpisodeId(): string | null;
  setLastTrackedAnalyticsEpisodeId(episodeId: string | null): void;
}

export interface PlaybackAnalyticsDeps {
  storage?: PlaybackAnalyticsStorage;
  trackStationPlay?: (stationId: string, stationTitle?: string) => Promise<void> | void;
  trackEpisodePlay?: (
    podcastId: string,
    episodeId: string,
    episodeTitle?: string,
    podcastTitle?: string
  ) => Promise<void> | void;
}

interface PendingStation {
  id: string;
  title?: string;
}

interface PendingEpisode {
  podcastId: string;
  episodeId: string;
  episodeTitle?: string;
  podcastTitle?: string;
}

/**
 * Manages analytics tracking for live radio stations and podcast episodes,
 * enforcing continuous playback duration (>10s) and deduplication rules matching the
 * legacy Kotlin Android application (RadioService).
 */
export class PlaybackAnalyticsManager {
  private deps: PlaybackAnalyticsDeps;

  private stationRunnablePending = false;
  private stationRunnableScheduled = false;
  private stationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStation: PendingStation | null = null;

  private episodeRunnablePending = false;
  private episodeRunnableScheduled = false;
  private episodeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEpisode: PendingEpisode | null = null;

  private lastTrackedEpisodeAnalyticsId: string | null = null;

  constructor(deps: PlaybackAnalyticsDeps = {}) {
    this.deps = deps;
    this.init();
  }

  init(): void {
    const storage = this.deps.storage;
    this.lastTrackedEpisodeAnalyticsId = storage ? storage.getLastTrackedAnalyticsEpisodeId() : null;
  }

  getLastTrackedEpisodeId(): string | null {
    return this.lastTrackedEpisodeAnalyticsId;
  }

  cancelAnalyticsTimers(): void {
    if (this.stationTimer) {
      clearTimeout(this.stationTimer);
      this.stationTimer = null;
    }
    this.stationRunnablePending = false;
    this.stationRunnableScheduled = false;
    this.pendingStation = null;

    if (this.episodeTimer) {
      clearTimeout(this.episodeTimer);
      this.episodeTimer = null;
    }
    this.episodeRunnablePending = false;
    this.episodeRunnableScheduled = false;
    this.pendingEpisode = null;
  }

  /**
   * Called when a station playback is requested or initiated.
   * Cancels any pending timers and prepares station analytics to fire after 10s of continuous playback.
   */
  onStationPlaybackRequested(stationId: string, stationTitle?: string): void {
    this.cancelAnalyticsTimers();
    const cleanId = (stationId || "").trim();
    if (!cleanId) return;

    this.pendingStation = { id: cleanId, title: stationTitle };
    this.stationRunnablePending = true;
    this.stationRunnableScheduled = false;
  }

  /**
   * Called when an episode playback is requested or initiated.
   * Cancels any pending timers. If restarting from beginning, resets deduplication state.
   * If not already tracked for this episode session, prepares episode analytics to fire after 10s of continuous playback.
   */
  onEpisodePlaybackRequested(
    podcastId: string,
    episodeId: string,
    episodeTitle?: string,
    podcastTitle?: string,
    isResume = false
  ): void {
    this.cancelAnalyticsTimers();
    const cleanPodId = (podcastId || "").trim();
    const cleanEpId = (episodeId || "").trim();
    if (!cleanPodId || !cleanEpId) return;

    // Allow replayed completed or restarted episodes to be counted as a new play.
    if (!isResume && this.lastTrackedEpisodeAnalyticsId === cleanEpId) {
      this.lastTrackedEpisodeAnalyticsId = null;
      this.deps.storage?.setLastTrackedAnalyticsEpisodeId(null);
    }

    // Track episode play analytics only once per episode session.
    if (this.lastTrackedEpisodeAnalyticsId !== cleanEpId) {
      this.pendingEpisode = {
        podcastId: cleanPodId,
        episodeId: cleanEpId,
        episodeTitle,
        podcastTitle
      };
      this.episodeRunnablePending = true;
      this.episodeRunnableScheduled = false;
    }
  }

  /**
   * Driven by player playback state (playing vs paused/buffering).
   * Paused time is excluded by pausing/cancelling the 10-second timer.
   */
  onPlaybackStateChanged(isPlaying: boolean): void {
    if (isPlaying) {
      if (this.stationRunnablePending && !this.stationRunnableScheduled && this.pendingStation) {
        this.stationRunnableScheduled = true;
        this.stationTimer = setTimeout(() => {
          const station = this.pendingStation;
          this.stationRunnablePending = false;
          this.stationRunnableScheduled = false;
          this.pendingStation = null;
          this.stationTimer = null;
          if (station) {
            if (this.deps.trackStationPlay) {
              void this.deps.trackStationPlay(station.id, station.title);
            }
          }
        }, ANALYTICS_MIN_PLAY_MS);
      }

      if (this.episodeRunnablePending && !this.episodeRunnableScheduled && this.pendingEpisode) {
        this.episodeRunnableScheduled = true;
        this.episodeTimer = setTimeout(() => {
          const ep = this.pendingEpisode;
          this.episodeRunnablePending = false;
          this.episodeRunnableScheduled = false;
          this.pendingEpisode = null;
          this.episodeTimer = null;
          if (ep) {
            this.lastTrackedEpisodeAnalyticsId = ep.episodeId;
            this.deps.storage?.setLastTrackedAnalyticsEpisodeId(ep.episodeId);
            if (this.deps.trackEpisodePlay) {
              void this.deps.trackEpisodePlay(ep.podcastId, ep.episodeId, ep.episodeTitle, ep.podcastTitle);
            }
          }
        }, ANALYTICS_MIN_PLAY_MS);
      }
    } else {
      if (this.stationRunnableScheduled) {
        if (this.stationTimer) {
          clearTimeout(this.stationTimer);
          this.stationTimer = null;
        }
        this.stationRunnableScheduled = false;
      }
      if (this.episodeRunnableScheduled) {
        if (this.episodeTimer) {
          clearTimeout(this.episodeTimer);
          this.episodeTimer = null;
        }
        this.episodeRunnableScheduled = false;
      }
    }
  }

  /**
   * Called when playback is stopped, completed, or encounters an unrecoverable error.
   */
  onPlaybackStopped(): void {
    this.cancelAnalyticsTimers();
  }

  resetForTesting(): void {
    this.cancelAnalyticsTimers();
    this.lastTrackedEpisodeAnalyticsId = null;
    this.deps.storage?.setLastTrackedAnalyticsEpisodeId(null);
  }
}

let defaultInstance: PlaybackAnalyticsManager | null = null;

function getDefaultInstance(): PlaybackAnalyticsManager {
  if (!defaultInstance) {
    const storage: PlaybackAnalyticsStorage = {
      getLastTrackedAnalyticsEpisodeId: () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          return require("../storage/preferences").Preferences.getLastTrackedAnalyticsEpisodeId();
        } catch {
          return null;
        }
      },
      setLastTrackedAnalyticsEpisodeId: (id) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require("../storage/preferences").Preferences.setLastTrackedAnalyticsEpisodeId(id);
        } catch {}
      }
    };
    const trackStation = (id: string, name?: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require("./analytics").trackStationPlay(id, name);
      } catch {}
    };
    const trackEpisode = (podId: string, epId: string, epTitle?: string, podTitle?: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require("./analytics").trackEpisodePlay(podId, epId, epTitle, podTitle);
      } catch {}
    };
    defaultInstance = new PlaybackAnalyticsManager({
      storage,
      trackStationPlay: trackStation,
      trackEpisodePlay: trackEpisode
    });
  }
  return defaultInstance;
}

export const PlaybackAnalytics = {
  onStationPlaybackRequested: (stationId: string, stationTitle?: string): void =>
    getDefaultInstance().onStationPlaybackRequested(stationId, stationTitle),
  onEpisodePlaybackRequested: (
    podcastId: string,
    episodeId: string,
    episodeTitle?: string,
    podcastTitle?: string,
    isResume = false
  ): void =>
    getDefaultInstance().onEpisodePlaybackRequested(podcastId, episodeId, episodeTitle, podcastTitle, isResume),
  onPlaybackStateChanged: (isPlaying: boolean): void =>
    getDefaultInstance().onPlaybackStateChanged(isPlaying),
  onPlaybackStopped: (): void =>
    getDefaultInstance().onPlaybackStopped(),
  getLastTrackedEpisodeId: (): string | null =>
    getDefaultInstance().getLastTrackedEpisodeId(),
  resetForTesting: (): void =>
    getDefaultInstance().resetForTesting()
};
