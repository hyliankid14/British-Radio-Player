import { Preferences } from "../storage/preferences.ts";
import { LastFmApi } from "../api/lastfm.ts";
import { ScrobbleOutboxQueue } from "./scrobbleOutboxQueue.ts";
import type { ScrobbleOutboxDeps } from "./scrobbleOutboxQueue.ts";
import type { QueuedScrobble } from "./scrobbleQueue.ts";

export type { QueuedScrobble, ScrobbleOutboxDeps };
export { ScrobbleOutboxQueue };

/**
 * Durable scrobble queue, wired to the live preferences and the Last.fm client.
 *
 * The retry, concurrency and reordering logic lives in ScrobbleOutboxQueue with its
 * collaborators injected, so it can be driven by a fake clock in tests.
 */
const deps: ScrobbleOutboxDeps = {
  readQueue: () => Preferences.getLastFmOutbox(),
  writeQueue: (queue) => Preferences.setLastFmOutbox(queue),
  isConnected: () => {
    const settings = Preferences.getLastFm();
    return settings.direct && !!settings.sessionKey;
  },
  deliver: (entry) =>
    LastFmApi.scrobble(
      entry.artist,
      entry.track,
      entry.timestampSec,
      entry.album,
      entry.durationSec
    ),
  record: (entry) => {
    Preferences.addLastFmRecentScrobble({
      artist: entry.artist,
      track: entry.track,
      stationName: entry.album,
      timestampMs: entry.timestampSec * 1000
    });
  },
  setLastError: (message) => Preferences.setLastFmLastError(message),
  now: () => Date.now(),
  warn: (...args) => console.warn(...args),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle)
};

export const ScrobbleOutbox = new ScrobbleOutboxQueue(deps);