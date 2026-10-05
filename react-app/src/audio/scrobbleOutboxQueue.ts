import {
  enqueueScrobble,
  isStaleScrobble,
  scrobbleKey
} from "./scrobbleQueue.ts";
import type { QueuedScrobble } from "./scrobbleQueue.ts";

export type { QueuedScrobble };

/** Give up after this many consecutive delivery failures so one poisoned entry cannot
 * block the queue forever. */
const MAX_ATTEMPTS = 8;

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 10 * 60_000;

/** Oldest entries past this age are dropped rather than submitted years late. */
const MAX_AGE_MS = 14 * 24 * 60 * 60_000;

/**
 * Everything the queue touches outside itself, injected so the retry, concurrency and
 * reordering behaviour can be driven by a fake clock in tests. The default wiring is the
 * live app.
 */
export interface ScrobbleOutboxDeps {
  readQueue(): QueuedScrobble[];
  writeQueue(queue: QueuedScrobble[]): void;
  /** Direct delivery is enabled and a session key is present. */
  isConnected(): boolean;
  /** Resolves true when Last.fm accepted the scrobble, false when it ignored it. */
  deliver(entry: QueuedScrobble): Promise<boolean>;
  /** Records a confirmed delivery in the listener's local history. */
  record(entry: QueuedScrobble): void;
  setLastError(message: string): void;
  now(): number;
  warn(...args: unknown[]): void;
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel(handle: ReturnType<typeof setTimeout>): void;
}

function scrobbleEntryKey(entry: QueuedScrobble): string {
  return `${entry.timestampSec}\u0000${scrobbleKey(entry)}`;
}

/**
 * True when two queue entries describe the same delivery attempt. `enqueueScrobble`
 * collapses replays of one artist/track inside the dedup window, so artist, track and
 * timestamp together identify a single entry well enough to find it again in storage
 * after an in-flight request has resolved.
 */
function isSameEntry(a: QueuedScrobble, b: QueuedScrobble): boolean {
  return scrobbleEntryKey(a) === scrobbleEntryKey(b);
}

/**
 * Durable scrobble queue.
 *
 * Scrobbles used to be fired and forgotten: any network failure, or the app being
 * backgrounded long enough for the request to be torn down, dropped the track
 * permanently with a console warning the user never sees. Entries are persisted here
 * first and retried with backoff until Last.fm accepts them.
 *
 * Delivery is strictly serial. `run()` is the only writer and it re-reads storage after
 * every await, so a scrobble queued while a request is in flight survives that request
 * instead of being overwritten by it.
 */
export class ScrobbleOutboxQueue {
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private readonly deps: ScrobbleOutboxDeps;

  constructor(deps: ScrobbleOutboxDeps) {
    this.deps = deps;
  }

  enqueue(entry: QueuedScrobble): void {
    const queue = this.deps.readQueue();
    const updated = enqueueScrobble(queue, entry);
    if (updated === queue) return;

    // A successful delivery resets the backoff, so start from a clean slate.
    this.attempt = 0;
    this.deps.writeQueue(updated);
    // Only ask for a flush when one is not already running: `run` drops the request if it
    // is, and the in-flight pass re-reads storage, so it will pick this entry up anyway.
    if (!this.flushing) this.schedule(0);
  }

  /** Attempts delivery of every queued scrobble. Safe to call repeatedly. */
  flush(): void {
    this.clearRetry();
    void this.run();
  }

  /** Re-arms the retry timer after a wait. */
  private schedule(delayMs: number): void {
    this.clearRetry();
    this.retryTimer = this.deps.schedule(() => {
      this.retryTimer = null;
      void this.run();
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      this.deps.cancel(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Removes a delivered entry from storage by identity rather than by index.
   *
   * An enqueue during the await has already been written to storage, so the snapshot this
   * pass started from is stale. Writing `queue.slice(1)` back would silently discard
   * whatever was queued while the request was in flight — the scrobble would never reach
   * Last.fm and nothing on screen would show the loss.
   */
  private dequeue(entry: QueuedScrobble): void {
    const current = this.deps.readQueue();
    const index = current.findIndex((item) => isSameEntry(item, entry));
    if (index === -1) return;
    this.deps.writeQueue([...current.slice(0, index), ...current.slice(index + 1)]);
  }

  /**
   * Moves a rejected entry behind everything else in the queue.
   *
   * Holding it at the head is what stopped recording dead: `run` always takes the head, so
   * one entry the proxy refuses forever — a fractional `duration`, an expired session key
   * — blocks every scrobble after it indefinitely. Parking it keeps the entry for when the
   * cause is fixed while the rest of the queue keeps flowing.
   */
  private park(entry: QueuedScrobble): void {
    const queue = this.deps.readQueue();
    const index = queue.findIndex((item) => isSameEntry(item, entry));
    if (index === -1) return;
    this.deps.writeQueue([...queue.slice(0, index), ...queue.slice(index + 1), entry]);
  }

  private async run(): Promise<void> {
    // Guard here rather than in `flush` alone: the retry timer and `enqueue` also call
    // `run` directly, and a second concurrent pass would submit the same head entry twice.
    if (this.flushing) return;
    this.flushing = true;
    // Entries rejected during this pass. Parking one puts it at the back of the queue, so
    // reaching the same entry again means every entry has been tried and nothing changed —
    // the pass gives up and waits rather than circling. Entries genuinely queued while the
    // pass runs are new, so they are still delivered within it.
    const parkedThisPass = new Set<string>();

    try {
      while (true) {
        const queue = this.deps.readQueue();
        const entry = queue[0];
        if (!entry) {
          this.attempt = 0;
          return;
        }

        if (parkedThisPass.has(scrobbleEntryKey(entry))) {
          this.attempt = 0;
          this.deps.warn(
            "[ScrobbleOutbox] Every queued scrobble was rejected; waiting before retrying"
          );
          this.schedule(RETRY_MAX_MS);
          return;
        }

        if (!this.deps.isConnected()) {
          // Nothing will succeed until the user reconnects. Hold the queue rather than
          // burning attempts, and retry periodically so it flushes after sign-in.
          this.schedule(RETRY_MAX_MS);
          return;
        }

        if (isStaleScrobble(entry, this.deps.now(), MAX_AGE_MS)) {
          this.deps.warn(`[ScrobbleOutbox] Dropping stale scrobble: ${entry.artist} - ${entry.track}`);
          this.dequeue(entry);
          continue;
        }

        try {
          const delivered = await this.deps.deliver(entry);
          this.dequeue(entry);
          if (delivered) {
            // Only now is the track actually in the listener's Last.fm account, so
            // only now does it belong in "recent scrobbles". Recording on intent made
            // that list claim success for tracks that were never delivered.
            this.deps.record(entry);
            this.deps.setLastError("");
          }
          // Either way the queue advanced, so the backoff starts fresh.
          this.attempt = 0;
          continue;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = (err as { status?: number } | undefined)?.status;
          const permanent = typeof status === "number" && status >= 400 && status < 500;

          if (permanent) {
            // A rejected request keeps failing until its cause is fixed, so the entry is
            // kept and only retried periodically — but it moves to the back of the queue
            // rather than blocking everything ahead of it.
            this.deps.setLastError(`${entry.artist} - ${entry.track}: ${message}`);
            this.deps.warn(
              `[ScrobbleOutbox] Holding ${entry.artist} - ${entry.track}; rejected with ${status}: ${message}`
            );
            this.park(entry);
            parkedThisPass.add(scrobbleEntryKey(entry));
            continue;
          }

          this.deps.warn(
            `[ScrobbleOutbox] Scrobble failed for ${entry.artist} - ${entry.track}: ${message}`
          );
          this.deps.setLastError(`${entry.artist} - ${entry.track}: ${message}`);

          this.attempt += 1;
          if (this.attempt >= MAX_ATTEMPTS) {
            this.deps.warn(
              `[ScrobbleOutbox] Giving up on ${entry.artist} - ${entry.track} after ${this.attempt} attempts`
            );
            this.dequeue(entry);
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
}