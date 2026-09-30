import { Preferences } from "../storage/preferences.ts";
import { LastFmApi } from "../api/lastfm.ts";
import {
  QueuedScrobble,
  enqueueScrobble,
  isStaleScrobble
} from "./scrobbleQueue.ts";

export type { QueuedScrobble };

/** Give up after this many consecutive delivery failures so one poisoned entry cannot
 * block the queue forever. */
const MAX_ATTEMPTS = 8;

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 10 * 60_000;

/** Oldest entries past this age are dropped rather than submitted years late. */
const MAX_AGE_MS = 14 * 24 * 60 * 60_000;

/**
 * Durable scrobble queue.
 *
 * Scrobbles used to be fired and forgotten: any network failure, or the app being
 * backgrounded long enough for the request to be torn down, dropped the track
 * permanently with a console warning the user never sees. Entries are persisted here
 * first and retried with backoff until Last.fm accepts them.
 */
class ScrobbleOutboxQueue {
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  enqueue(entry: QueuedScrobble): void {
    const queue = Preferences.getLastFmOutbox();
    const updated = enqueueScrobble(queue, entry);
    if (updated === queue) return;

    // A successful delivery resets the backoff, so start from a clean slate.
    this.attempt = 0;
    Preferences.setLastFmOutbox(updated);
    this.schedule(0);
  }

  /** Attempts delivery of every queued scrobble. Safe to call repeatedly. */
  flush(): void {
    if (this.flushing) return;
    this.clearRetry();
    void this.run();
  }

  private async run(): Promise<void> {
    this.flushing = true;
    try {
      while (true) {
        const queue = Preferences.getLastFmOutbox();
        const entry = queue[0];
        if (!entry) {
          this.attempt = 0;
          return;
        }

        const settings = Preferences.getLastFm();
        if (!settings.direct || !settings.sessionKey) {
          // Nothing will succeed until the user reconnects. Hold the queue rather than
          // burning attempts, and retry periodically so it flushes after sign-in.
          this.schedule(RETRY_MAX_MS);
          return;
        }

        if (isStaleScrobble(entry, Date.now(), MAX_AGE_MS)) {
          console.warn(`[ScrobbleOutbox] Dropping stale scrobble: ${entry.artist} - ${entry.track}`);
          Preferences.setLastFmOutbox(queue.slice(1));
          continue;
        }

        try {
          const delivered = await LastFmApi.scrobble(
            entry.artist,
            entry.track,
            entry.timestampSec,
            entry.album,
            entry.durationSec
          );
          Preferences.setLastFmOutbox(queue.slice(1));
          if (delivered) {
            // Only now is the track actually in the listener's Last.fm account, so
            // only now does it belong in "recent scrobbles". Recording on intent made
            // that list claim success for tracks that were never delivered.
            Preferences.addLastFmRecentScrobble({
              artist: entry.artist,
              track: entry.track,
              stationName: entry.album,
              timestampMs: entry.timestampSec * 1000
            });
            Preferences.setLastFmLastError("");
          }
          // Either way the queue advanced, so the backoff starts fresh.
          this.attempt = 0;
          continue;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = (err as { status?: number } | undefined)?.status;
          const permanent = typeof status === "number" && status >= 400 && status < 500;

          if (permanent) {
            // A rejected request will keep failing until the cause is fixed — a
            // missing proxy route, a bad key, an expired session. Burn no attempts and
            // drop nothing, so the scrobbles survive the outage and flush once the
            // user reconnects or the proxy is deployed.
            Preferences.setLastFmLastError(`${entry.artist} - ${entry.track}: ${message}`);
            console.warn(
              `[ScrobbleOutbox] Holding ${entry.artist} - ${entry.track}; rejected with ${status}: ${message}`
            );
            this.schedule(RETRY_MAX_MS);
            return;
          }

          console.warn(
            `[ScrobbleOutbox] Scrobble failed for ${entry.artist} - ${entry.track}: ${message}`
          );
          Preferences.setLastFmLastError(`${entry.artist} - ${entry.track}: ${message}`);

          this.attempt += 1;
          if (this.attempt >= MAX_ATTEMPTS) {
            console.warn(
              `[ScrobbleOutbox] Giving up on ${entry.artist} - ${entry.track} after ${this.attempt} attempts`
            );
            Preferences.setLastFmOutbox(queue.slice(1));
            this.attempt = 0;
            continue;
          }
          this.schedule(Math.min(RETRY_BASE_MS * 2 ** (this.attempt - 1), RETRY_MAX_MS));
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private schedule(delayMs: number): void {
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

export const ScrobbleOutbox = new ScrobbleOutboxQueue();
