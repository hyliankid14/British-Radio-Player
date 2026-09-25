import { Preferences } from "../storage/preferences.ts";
import { LastFmApi } from "../api/lastfm.ts";
import { NativeAndroid } from "../native/nativeAndroid.ts";

export interface ActiveTrack {
  artist: string;
  track: string;
  album: string;
  durationSec: number;
  startTimeMs: number;
  totalListenedMs: number;
  lastResumeTimeMs: number;
  isPlaying: boolean;
  alreadyScrobbled: boolean;
  isPodcast: boolean;
}

import {
  calculateScrobbleThresholdMs,
  MIN_SCROBBLE_TIME_MS,
  MAX_SCROBBLE_THRESHOLD_MS,
  DEFAULT_RADIO_THRESHOLD_MS
} from "./scrobbleThreshold.ts";
export {
  calculateScrobbleThresholdMs,
  MIN_SCROBBLE_TIME_MS,
  MAX_SCROBBLE_THRESHOLD_MS,
  DEFAULT_RADIO_THRESHOLD_MS
};

// Broadcast states matching Simple Last.fm Scrobbler (SLS)
export const SLS_STATE_START = 0;
export const SLS_STATE_RESUME = 1;
export const SLS_STATE_PAUSE = 2;
export const SLS_STATE_COMPLETE = 3;

class ScrobbleCoordinator {
  private activeTrack: ActiveTrack | null = null;
  private scrobbleTimer: ReturnType<typeof setTimeout> | null = null;

  getActiveTrack(): ActiveTrack | null {
    return this.activeTrack;
  }

  onTrackStarted(
    artist: string,
    track: string,
    album = "",
    durationSec = 0,
    isPodcast = false
  ): void {
    const trimmedArtist = artist.trim();
    const trimmedTrack = track.trim();

    if (!trimmedArtist || !trimmedTrack) {
      this.onNoTrackPlaying();
      return;
    }

    const settings = Preferences.getLastFm();
    if (isPodcast && !settings.podcasts) {
      this.onPlaybackStopped();
      return;
    }

    // If the same track is already active, handle play/resume
    if (
      this.activeTrack &&
      this.activeTrack.artist.toLowerCase() === trimmedArtist.toLowerCase() &&
      this.activeTrack.track.toLowerCase() === trimmedTrack.toLowerCase()
    ) {
      if (!this.activeTrack.isPlaying) {
        this.onPlaybackResumed();
      }
      return;
    }

    // Before starting the new track, check if the previous track qualifies for scrobble
    this.checkAndScrobbleCurrent();

    const now = Date.now();
    const newTrack: ActiveTrack = {
      artist: trimmedArtist,
      track: trimmedTrack,
      album: album.trim(),
      durationSec,
      startTimeMs: now,
      totalListenedMs: 0,
      lastResumeTimeMs: now,
      isPlaying: true,
      alreadyScrobbled: false,
      isPodcast
    };
    this.activeTrack = newTrack;

    console.log(
      `[ScrobbleManager] Track started: ${newTrack.artist} - ${newTrack.track} (duration: ${durationSec}s, isPodcast: ${isPodcast})`
    );

    // 1. External scrobbler broadcast (Pano Scrobbler, SLS, Scroball)
    if (settings.broadcast) {
      NativeAndroid.broadcastScrobble(
        SLS_STATE_START,
        newTrack.artist,
        newTrack.track,
        newTrack.album,
        durationSec
      );
    }

    // 2. Direct Last.fm Now Playing & schedule scrobble
    if (settings.direct && settings.sessionKey) {
      LastFmApi.updateNowPlaying(
        newTrack.artist,
        newTrack.track,
        durationSec > 0 ? durationSec : undefined,
        newTrack.album || undefined
      ).catch((err) => {
        console.warn("[ScrobbleManager] Failed to update now playing:", err);
      });
    }

    this.scheduleScrobbleTimer(newTrack);
  }

  onPlaybackPaused(): void {
    const current = this.activeTrack;
    if (!current || !current.isPlaying) return;

    const now = Date.now();
    current.totalListenedMs += now - current.lastResumeTimeMs;
    current.isPlaying = false;

    if (this.scrobbleTimer) {
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = null;
    }

    const settings = Preferences.getLastFm();
    if (settings.broadcast) {
      NativeAndroid.broadcastScrobble(
        SLS_STATE_PAUSE,
        current.artist,
        current.track,
        current.album,
        current.durationSec
      );
    }
  }

  onPlaybackResumed(): void {
    const current = this.activeTrack;
    if (!current || current.isPlaying) return;

    current.lastResumeTimeMs = Date.now();
    current.isPlaying = true;

    const settings = Preferences.getLastFm();
    if (settings.broadcast) {
      NativeAndroid.broadcastScrobble(
        SLS_STATE_RESUME,
        current.artist,
        current.track,
        current.album,
        current.durationSec
      );
    }

    if (!current.alreadyScrobbled) {
      this.scheduleScrobbleTimer(current);
    }
  }

  onPlaybackStopped(): void {
    this.checkAndScrobbleCurrent();

    const current = this.activeTrack;
    if (current) {
      const settings = Preferences.getLastFm();
      if (settings.broadcast) {
        NativeAndroid.broadcastScrobble(
          SLS_STATE_COMPLETE,
          current.artist,
          current.track,
          current.album,
          current.durationSec
        );
      }
    }

    if (this.scrobbleTimer) {
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = null;
    }
    this.activeTrack = null;
  }

  onNoTrackPlaying(): void {
    // When radio transitions from music to speech/news, check if the song was listened to enough
    this.checkAndScrobbleCurrent();

    if (this.scrobbleTimer) {
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = null;
    }
    this.activeTrack = null;
  }

  onProgress(positionSec: number, durationSec: number): void {
    const current = this.activeTrack;
    if (!current || current.alreadyScrobbled || !current.isPlaying) return;

    const now = Date.now();
    current.totalListenedMs += now - current.lastResumeTimeMs;
    current.lastResumeTimeMs = now;

    if (current.durationSec <= 0 && durationSec > 0) {
      current.durationSec = Math.round(durationSec);
    }

    const thresholdMs = calculateScrobbleThresholdMs(current.durationSec);
    if (
      current.totalListenedMs >= thresholdMs ||
      (current.isPodcast && positionSec * 1000 >= thresholdMs)
    ) {
      this.triggerScrobble(current);
    }
  }

  private scheduleScrobbleTimer(track: ActiveTrack): void {
    if (this.scrobbleTimer) {
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = null;
    }

    const thresholdMs = calculateScrobbleThresholdMs(track.durationSec);
    const remainingMs = Math.max(0, thresholdMs - track.totalListenedMs);

    this.scrobbleTimer = setTimeout(() => {
      if (this.activeTrack === track && !track.alreadyScrobbled && track.isPlaying) {
        const now = Date.now();
        track.totalListenedMs += now - track.lastResumeTimeMs;
        track.lastResumeTimeMs = now;
        if (track.totalListenedMs >= thresholdMs) {
          this.triggerScrobble(track);
        }
      }
    }, remainingMs);
  }

  private checkAndScrobbleCurrent(): void {
    const current = this.activeTrack;
    if (!current || current.alreadyScrobbled) return;

    if (current.isPlaying) {
      const now = Date.now();
      current.totalListenedMs += now - current.lastResumeTimeMs;
      current.lastResumeTimeMs = now;
    }

    const thresholdMs = calculateScrobbleThresholdMs(current.durationSec);
    if (current.totalListenedMs >= thresholdMs) {
      this.triggerScrobble(current);
    }
  }

  private triggerScrobble(track: ActiveTrack): void {
    track.alreadyScrobbled = true;

    if (this.scrobbleTimer) {
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = null;
    }

    const settings = Preferences.getLastFm();
    if (track.isPodcast && !settings.podcasts) return;
    if (!settings.direct || !settings.sessionKey) return;

    const timestampSec = Math.floor(track.startTimeMs / 1000);
    console.log(
      `[ScrobbleManager] Submitting scrobble: ${track.artist} - ${track.track} (listened ${track.totalListenedMs}ms, threshold: ${calculateScrobbleThresholdMs(track.durationSec)}ms)`
    );

    LastFmApi.scrobble(
      track.artist,
      track.track,
      timestampSec,
      track.album || undefined,
      track.durationSec > 0 ? track.durationSec : undefined
    ).catch((err) => {
      console.warn(`[ScrobbleManager] Scrobble failed for ${track.artist} - ${track.track}:`, err);
    });
  }
}

export const ScrobbleManager = new ScrobbleCoordinator();
