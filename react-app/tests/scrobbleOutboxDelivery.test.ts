import test from "node:test";
import assert from "node:assert/strict";
import { ScrobbleOutboxQueue } from "../src/audio/scrobbleOutboxQueue.ts";
import type { ScrobbleOutboxDeps } from "../src/audio/scrobbleOutboxQueue.ts";
import type { QueuedScrobble } from "../src/audio/scrobbleQueue.ts";

const NOW_MS = 1_700_000_000_000;

const entry = (
  artist: string,
  track: string,
  timestampSec = Math.floor(NOW_MS / 1000),
  extra: Partial<QueuedScrobble> = {}
): QueuedScrobble => ({
  artist,
  track,
  album: "BBC Radio 1",
  durationSec: 207,
  timestampSec,
  ...extra
});

interface Harness {
  outbox: ScrobbleOutboxQueue;
  /** Storage backing the queue, as the app's preferences hold it. */
  storage: () => QueuedScrobble[];
  delivered: QueuedScrobble[];
  recorded: QueuedScrobble[];
  errors: string[];
  /** Timers armed by the queue, newest last, so a test can fire them on demand. */
  timers: { delayMs: number; fire: () => void }[];
  /** Runs every pending timer once, in order. */
  fireTimers(): void;
  /** Lets queued microtasks (the in-flight deliver promise) settle. */
  settle(): Promise<void>;
}

function httpError(status: number, message = `HTTP ${status}`): Error {
  return Object.assign(new Error(message), { status });
}

function createHarness(
  overrides: Partial<ScrobbleOutboxDeps> = {},
  deliverImpl: (entry: QueuedScrobble) => Promise<boolean> = async () => true
): Harness {
  let queue: QueuedScrobble[] = [];
  const delivered: QueuedScrobble[] = [];
  const recorded: QueuedScrobble[] = [];
  const errors: string[] = [];
  const timers: { delayMs: number; fire: () => void }[] = [];
  const warnings: unknown[][] = [];

  const deps: ScrobbleOutboxDeps = {
    readQueue: () => queue,
    writeQueue: (next) => {
      queue = next;
    },
    isConnected: () => true,
    // Every attempt is logged here so a test only has to say what the attempt *does*,
    // and never has to remember to record it.
    deliver: async (item) => {
      delivered.push(item);
      return deliverImpl(item);
    },
    record: (item) => recorded.push(item),
    setLastError: (message) => {
      errors.push(message);
    },
    now: () => NOW_MS,
    warn: (...args) => warnings.push(args),
    schedule: (callback, delayMs) => {
      timers.push({ delayMs, fire: callback });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle) => {
      timers[Number(handle) - 1] = { delayMs: -1, fire: () => {} };
    },
    ...overrides
  };

  return {
    outbox: new ScrobbleOutboxQueue(deps),
    storage: () => queue,
    delivered,
    recorded,
    errors,
    timers,
    fireTimers: () => {
      for (const timer of timers.splice(0)) {
        if (timer.delayMs >= 0) timer.fire();
      }
    },
    settle: async () => {
      // The delivery loop advances one entry per few microtask turns, so drain generously
      // rather than assuming a fixed depth.
      for (let i = 0; i < 40; i++) await Promise.resolve();
    }
  };
}

test("an empty queue sends nothing and arms no timer", async () => {
  const h = createHarness();

  h.outbox.flush();
  await h.settle();

  assert.deepEqual(h.delivered, []);
  assert.equal(h.timers.length, 0);
});

test("a queued scrobble is delivered and removed from storage", async () => {
  const h = createHarness();

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.fireTimers();
  await h.settle();

  assert.equal(h.delivered.length, 1);
  assert.equal(h.delivered[0].track, "Track A");
  assert.deepEqual(h.storage(), []);
});

test("a scrobble is recorded in local history only once Last.fm confirms it", async () => {
  const h = createHarness({}, async () => false);

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.fireTimers();
  await h.settle();

  assert.deepEqual(h.recorded, [], "an ignored scrobble never reached the account");
  assert.deepEqual(h.storage(), [], "but it still leaves the queue");
});

test("a scrobble enqueued while a delivery is in flight is not lost", async () => {
  let queue: QueuedScrobble[] = [];
  const delivered: QueuedScrobble[] = [];
  let releaseFirst!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const h = createHarness({
    readQueue: () => queue,
    writeQueue: (next) => {
      queue = next;
    },
    deliver: async (item) => {
      delivered.push(item);
      if (delivered.length === 1) await inFlight;
      return true;
    }
  });

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.fireTimers();

  // The first request is now awaiting. Queue a second scrobble behind it.
  h.outbox.enqueue(entry("Artist B", "Track B", Math.floor(NOW_MS / 1000) + 300));
  assert.equal(queue.length, 2, "the second scrobble is queued while the first is in flight");

  releaseFirst();
  await h.settle();

  assert.deepEqual(
    h.storage().map((item) => item.track),
    [],
    "both scrobbles left the queue"
  );
  assert.deepEqual(
    delivered.map((item) => item.track),
    ["Track A", "Track B"],
    "the in-flight scrobble and the one queued behind it were both delivered"
  );
});

test("a second flush while a delivery is in flight does not resend the head entry", async () => {
  let queue: QueuedScrobble[] = [];
  const delivered: QueuedScrobble[] = [];
  let releaseFirst!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const h = createHarness({
    readQueue: () => queue,
    writeQueue: (next) => {
      queue = next;
    },
    deliver: async (item) => {
      delivered.push(item);
      if (delivered.length === 1) await inFlight;
      return true;
    }
  });

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.fireTimers();

  // A retry tick landing on top of the in-flight pass must not start a second pass.
  h.outbox.flush();
  h.outbox.flush();

  releaseFirst();
  await h.settle();

  assert.deepEqual(
    delivered.map((item) => item.track),
    ["Track A"],
    "the entry was submitted once, not once per concurrent pass"
  );
});

test("a permanently rejected entry does not block the rest of the queue", async () => {
  const h = createHarness({}, async (item) => {
    if (item.track === "Track A") throw httpError(400, "duration must be an integer");
    return true;
  });

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.outbox.enqueue(entry("Artist B", "Track B", Math.floor(NOW_MS / 1000) + 300));
  h.fireTimers();
  await h.settle();

  assert.deepEqual(
    h.delivered.map((item) => item.track),
    ["Track B", "Track A"],
    "the entry behind the rejected one was delivered before it was retried"
  );
  assert.deepEqual(
    h.storage().map((item) => item.track),
    ["Track A"],
    "the rejected entry is kept, not dropped"
  );
});

test("a queue of permanently rejected entries is retried later rather than spun on", async () => {
  const h = createHarness({}, async () => {
    throw httpError(403, "Invalid session key");
  });

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.outbox.enqueue(entry("Artist B", "Track B", Math.floor(NOW_MS / 1000) + 300));
  h.fireTimers();
  await h.settle();

  assert.equal(h.delivered.length, 2, "each entry is attempted once, then the pass gives up");
  assert.equal(h.timers.length, 1, "a retry is armed");
  assert.equal(h.timers[0].delayMs, 10 * 60_000);
  assert.equal(h.storage().length, 2, "nothing is dropped");
});

test("a mix of deliverable and rejected entries does not spin on the queue", async () => {
  // Regression: parking a rejected entry at the back means it is reached again after every
  // entry behind it. A pass that resets its rejection counter on each success would circle
  // for ever, so a pass examines each entry at most once.
  const h = createHarness({}, async (item) => {
    if (item.track === "Track B") throw httpError(400, "duration must be an integer");
    return true;
  });

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.outbox.enqueue(entry("Artist B", "Track B", Math.floor(NOW_MS / 1000) + 200));
  h.outbox.enqueue(entry("Artist C", "Track C", Math.floor(NOW_MS / 1000) + 400));
  h.fireTimers();
  await h.settle();

  assert.equal(h.delivered.length, 3, "each entry was attempted exactly once");
  assert.deepEqual(
    h.storage().map((item) => item.track),
    ["Track B"],
    "only the rejected entry is left"
  );
  assert.equal(h.timers.length, 1, "the pass gave up and armed a retry");
  assert.equal(h.timers[0].delayMs, 10 * 60_000);
});

test("a transient failure is retried with exponential backoff", async () => {
  const h = createHarness({}, async () => {
    throw new Error("network down");
  });

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.fireTimers();
  await h.settle();

  assert.deepEqual(h.timers.map((timer) => timer.delayMs), [15_000]);
  assert.ok(
    h.errors.some((message) => message.includes("network down")),
    "the failure is surfaced for the settings banner"
  );
});

test("a scrobble enqueued while disconnected is held until the session returns", async () => {
  let connected = false;
  const h = createHarness({ isConnected: () => connected });

  h.outbox.enqueue(entry("Artist A", "Track A"));
  h.fireTimers();
  await h.settle();

  assert.deepEqual(h.delivered, [], "nothing is sent without a session");
  assert.equal(h.storage().length, 1, "but the scrobble survives");

  connected = true;
  h.fireTimers();
  await h.settle();

  assert.equal(h.delivered.length, 1, "the held scrobble flushes once reconnected");
});

test("a scrobble older than the age limit is dropped instead of submitted late", async () => {
  const h = createHarness();

  h.outbox.enqueue(entry("Artist A", "Track A", Math.floor(NOW_MS / 1000) - 15 * 24 * 3600));
  h.fireTimers();
  await h.settle();

  assert.deepEqual(h.delivered, []);
  assert.deepEqual(h.storage(), []);
});