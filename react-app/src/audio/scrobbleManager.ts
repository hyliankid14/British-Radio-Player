import { Preferences } from "../storage/preferences.ts";
import { LastFmApi } from "../api/lastfm.ts";
import { ScrobbleOutbox } from "./scrobbleOutbox.ts";
import { NativeAndroid } from "../native/nativeAndroid.ts";
import { ScrobbleStateMachine } from "./scrobbleStateMachine.ts";
import type { ActiveTrack, ScrobbleSubmission } from "./scrobbleStateMachine.ts";
import {
  calculateScrobbleThresholdMs,
  MIN_SCROBBLE_TIME_MS,
  MAX_SCROBBLE_THRESHOLD_MS,
  DEFAULT_RADIO_THRESHOLD_MS
} from "./scrobbleThreshold.ts";

export type { ActiveTrack };

export {
  calculateScrobbleThresholdMs,
  MIN_SCROBBLE_TIME_MS,
  MAX_SCROBBLE_THRESHOLD_MS,
  DEFAULT_RADIO_THRESHOLD_MS
};

const canScrobble = (): boolean => {
  const settings = Preferences.getLastFm();
  return settings.direct && !!settings.sessionKey;
};

const machine = new ScrobbleStateMachine({
  now: () => Date.now(),
  canScrobble,
  podcastsEnabled: () => Preferences.getLastFm().podcasts,
  broadcastEnabled: () => Preferences.getLastFm().broadcast,
  submit: (entry: ScrobbleSubmission) => {
    ScrobbleOutbox.enqueue(entry);
    // Kick the outbox so a connected session sends immediately rather than waiting for
    // the next retry tick.
    ScrobbleOutbox.flush();
  },
  record: (entry) => {
    // When direct delivery is on, the outbox records once Last.fm confirms, so
    // "recent scrobbles" only ever lists tracks that actually reached the account.
    // In broadcast-only mode there is nothing to confirm against — an external
    // scrobbler app owns delivery — so record the intent here as before.
    if (canScrobble()) return;
    Preferences.addLastFmRecentScrobble(entry);
  },
  nowPlaying: (artist, track, durationSec, album) => {
    LastFmApi.updateNowPlaying(artist, track, durationSec, album).catch((err) => {
      console.warn("[ScrobbleManager] Failed to update now playing:", err);
    });
  },
  broadcast: (state, artist, track, album, durationSec) => {
    NativeAndroid.broadcastScrobble(state, artist, track, album, durationSec);
  }
});

export const ScrobbleManager = {
  getActiveTrack: () => machine.getActiveTrack(),
  onTrackStarted: (
    artist: string,
    track: string,
    album?: string,
    durationSec?: number,
    isPodcast?: boolean
  ) => machine.onTrackStarted(artist, track, album, durationSec, isPodcast),
  onPlaybackPaused: () => machine.onPlaybackPaused(),
  onPlaybackResumed: () => machine.onPlaybackResumed(),
  onPlaybackStopped: () => machine.onPlaybackStopped(),
  onNoTrackPlaying: () => machine.onNoTrackPlaying(),
  onProgress: (positionSec: number, durationSec: number) => machine.onProgress(positionSec, durationSec)
};
