import {
  calculateScrobbleThresholdMs,
  MIN_SCROBBLE_TIME_MS,
  MAX_SCROBBLE_THRESHOLD_MS,
  DEFAULT_RADIO_THRESHOLD_MS
} from "./scrobbleThreshold.ts";

export { calculateScrobbleThresholdMs };

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
  /**
   * True while metadata reports no song for a track that is still playing. The track
   * stays active so a transient gap does not reset the listen clock.
   */
  metadataMissing: boolean;
  /** When metadata first went missing, or 0 while metadata is present. */
  missingSinceMs: number;
}

/** Broadcast states matching Simple Last.fm Scrobbler (SLS) */
export const SLS_STATE_START = 0;
export const SLS_STATE_RESUME = 1;
export const SLS_STATE_PAUSE = 2;
export const SLS_STATE_COMPLETE = 3;

/**
 * How long a track survives metadata reporting no song for it. Metadata is applied with
 * a deliberate delay and the station poll runs every few seconds, so a normal track
 * handover produces a gap of roughly 20-25s. Anything longer than this is treated as
 * the track genuinely being over (speech, news, an advert) so a stale song is never
 * credited.
 */
export const METADATA_GAP_TOLERANCE_MS = 60_000;

export interface ScrobbleSubmission {
  artist: string;
  track: string;
  album?: string;
  durationSec?: number;
  timestampSec: number;
}

export interface ScrobbleHistoryEntry {
  artist: string;
  track: string;
  stationName?: string;
  timestampMs: number;
}

export interface ScrobbleDeps {
  now(): number;
  /** Direct Last.fm delivery is enabled and a session key is present. */
  canScrobble(): boolean;
  podcastsEnabled(): boolean;
  broadcastEnabled(): boolean;
  /** Hand the scrobble to the durable outbox for delivery. */
  submit(entry: ScrobbleSubmission): void;
  /**
   * Record the track in local history. Called for every qualifying track; the
   * implementation decides whether that means "confirmed by Last.fm" or "queued".
   * With direct delivery on, the outbox records on confirmation instead, so this
   * list only ever claims tracks that actually reached the account.
   */
  record(entry: ScrobbleHistoryEntry): void;
  nowPlaying(artist: string, track: string, durationSec?: number, album?: string): void;
  broadcast(
    state: number,
    artist: string,
    track: string,
    album: string,
    durationSec: number
  ): void;
  /**
   * Timer seam. Defaults to the platform timer; injected in tests so the scrobble
   * countdown is driven by a fake clock instead of wall time.
   */
  schedule?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel?(handle: ReturnType<typeof setTimeout>): void;
}

export class ScrobbleStateMachine {
  private activeTrack: ActiveTrack | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly deps: ScrobbleDeps;

  constructor(deps: ScrobbleDeps) {
    this.deps = deps;
  }

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

    if (isPodcast && !this.deps.podcastsEnabled()) {
      this.onPlaybackStopped();
      return;
    }

    const current = this.activeTrack;
    if (
      current &&
      current.artist.toLowerCase() === trimmedArtist.toLowerCase() &&
      current.track.toLowerCase() === trimmedTrack.toLowerCase()
    ) {
      if (!current.isPlaying) this.onPlaybackResumed();
      // Metadata had gone quiet for this track and is reporting it again. The listen
      // clock was never restarted, so only clear the gap marker.
      current.metadataMissing = false;
      current.missingSinceMs = 0;
      return;
    }

    this.expireStalledTrack();
    this.checkAndScrobbleCurrent();

    const now = this.deps.now();
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
      isPodcast,
      metadataMissing: false,
      missingSinceMs: 0
    };
    this.activeTrack = newTrack;

    console.log(
      `[ScrobbleManager] Track started: ${newTrack.artist} - ${newTrack.track} (duration: ${durationSec}s, isPodcast: ${isPodcast})`
    );

    if (this.deps.broadcastEnabled()) {
      this.deps.broadcast(
        SLS_STATE_START,
        newTrack.artist,
        newTrack.track,
        newTrack.album,
        durationSec
      );
    }

    if (this.deps.canScrobble()) {
      this.deps.nowPlaying(
        newTrack.artist,
        newTrack.track,
        durationSec > 0 ? durationSec : undefined,
        newTrack.album || undefined
      );
    }

    this.scheduleScrobbleTimer(newTrack);
  }

  onPlaybackPaused(): void {
    const current = this.activeTrack;
    if (!current || !current.isPlaying) return;

    current.totalListenedMs += this.deps.now() - current.lastResumeTimeMs;
    current.isPlaying = false;

    this.clearTimer();
    this.emitBroadcast(SLS_STATE_PAUSE, current);
  }

  onPlaybackResumed(): void {
    const current = this.activeTrack;
    if (!current || current.isPlaying) return;

    current.lastResumeTimeMs = this.deps.now();
    current.isPlaying = true;

    this.emitBroadcast(SLS_STATE_RESUME, current);
    if (!current.alreadyScrobbled) this.scheduleScrobbleTimer(current);
  }

  onPlaybackStopped(): void {
    this.checkAndScrobbleCurrent();
    const current = this.activeTrack;
    if (current) this.emitBroadcast(SLS_STATE_COMPLETE, current);
    this.retireCurrentTrack();
  }

  /**
   * Metadata reports no song. This runs on every track handover as well as on real
   * speech breaks, so the active track is kept across the gap rather than discarded —
   * otherwise the listen clock would restart on every handover and short tracks would
   * never reach their threshold.
   */
  onNoTrackPlaying(): void {
    const current = this.activeTrack;
    if (!current) return;

    if (this.expireStalledTrack()) return;

    // Settles the listen clock; fires when the track qualifies.
    this.checkAndScrobbleCurrent();

    // The track is kept either way. Discarding it here would let the same song
    // scrobble twice: once on the countdown, then again once the handover gap passed
    // and the metadata came back for what is still the same song.
    if (!current.metadataMissing) {
      current.metadataMissing = true;
      current.missingSinceMs = this.deps.now();
    }
  }

  onProgress(positionSec: number, durationSec: number): void {
    const current = this.activeTrack;
    if (!current || current.alreadyScrobbled || !current.isPlaying) return;

    if (this.expireStalledTrack()) return;

    current.totalListenedMs += this.deps.now() - current.lastResumeTimeMs;
    current.lastResumeTimeMs = this.deps.now();

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

  private emitBroadcast(state: number, track: ActiveTrack): void {
    if (!this.deps.broadcastEnabled()) return;
    this.deps.broadcast(state, track.artist, track.track, track.album, track.durationSec);
  }

  private scheduleScrobbleTimer(track: ActiveTrack): void {
    this.clearTimer();

    const thresholdMs = calculateScrobbleThresholdMs(track.durationSec);
    const remainingMs = Math.max(0, thresholdMs - track.totalListenedMs);
    const schedule = this.deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

    this.timer = schedule(() => {
      if (this.activeTrack === track && !track.alreadyScrobbled && track.isPlaying) {
        track.totalListenedMs += this.deps.now() - track.lastResumeTimeMs;
        track.lastResumeTimeMs = this.deps.now();
        if (track.totalListenedMs >= thresholdMs) this.triggerScrobble(track);
      }
    }, remainingMs);
  }

  /** Settles the listen clock and scrobbles when the track qualifies. */
  private checkAndScrobbleCurrent(): boolean {
    const current = this.activeTrack;
    if (!current) return false;
    if (current.alreadyScrobbled) return true;

    if (current.isPlaying) {
      const now = this.deps.now();
      current.totalListenedMs += now - current.lastResumeTimeMs;
      current.lastResumeTimeMs = now;
    }

    if (current.totalListenedMs < calculateScrobbleThresholdMs(current.durationSec)) return false;

    this.triggerScrobble(current);
    return true;
  }

  /**
   * Retires the active track when metadata has reported no song for it for longer than
   * METADATA_GAP_TOLERANCE_MS, so a song is never credited long after it finished.
   * Returns true when a track was retired and the caller should stop processing it.
   */
  private expireStalledTrack(): boolean {
    const current = this.activeTrack;
    if (!current || !current.metadataMissing) return false;
    if (this.deps.now() - current.missingSinceMs < METADATA_GAP_TOLERANCE_MS) return false;

    this.checkAndScrobbleCurrent();
    this.retireCurrentTrack();
    return true;
  }

  private retireCurrentTrack(): void {
    this.clearTimer();
    this.activeTrack = null;
  }

  private clearTimer(): void {
    if (this.timer) {
      (this.deps.cancel ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle)))(this.timer);
      this.timer = null;
    }
  }

  private triggerScrobble(track: ActiveTrack): void {
    track.alreadyScrobbled = true;
    this.clearTimer();

    if (track.isPodcast && !this.deps.podcastsEnabled()) return;

    const timestampSec = Math.floor(track.startTimeMs / 1000);

    // Queue before touching local history or the network: a scrobble lost here is lost
    // for good, whereas a duplicate is collapsed by Last.fm and by the outbox's own
    // dedup window.
    this.deps.submit({
      artist: track.artist,
      track: track.track,
      album: track.album || undefined,
      durationSec: track.durationSec > 0 ? track.durationSec : undefined,
      timestampSec
    });

    this.deps.record({
      artist: track.artist,
      track: track.track,
      stationName: track.album || undefined,
      timestampMs: track.startTimeMs
    });

    if (!this.deps.canScrobble()) return;

    console.log(
      `[ScrobbleManager] Submitting scrobble: ${track.artist} - ${track.track} (listened ${track.totalListenedMs}ms, threshold: ${calculateScrobbleThresholdMs(track.durationSec)}ms)`
    );
  }
}
