import test from "node:test";
import assert from "node:assert/strict";
import {
  createLaunchNavigation,
  isFocusedTarget,
  isTargetInState,
  LAUNCH_DEDUPE_MS,
  LAUNCH_INTENT_DEDUPE_MS,
  LAUNCH_RETRY_MS,
  LAUNCH_RETRY_TIMEOUT_MS,
  type NavigationStateLike
} from "../src/navigation/launchNavigation.ts";

const DETAIL_URL = "/modal/podcast-detail?podcastId=p086w16s&episodeId=e1";
const DETAIL_PATH = "/modal/podcast-detail";

/**
 * Deterministic stand-in for setTimeout: timers queue up and only fire when the test
 * advances the clock, so retry behaviour can be asserted without real waiting.
 */
function createHarness() {
  let now = 1_000;
  const timers: { id: number; at: number; callback: () => void }[] = [];
  let nextId = 1;

  const schedule = (callback: () => void, ms: number) => {
    const id = nextId++;
    timers.push({ id, at: now + ms, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  const cancel = (handle: ReturnType<typeof setTimeout>) => {
    const index = timers.findIndex((timer) => timer.id === handle);
    if (index >= 0) timers.splice(index, 1);
  };
  const advance = (ms: number) => {
    now += ms;
    // Fire due timers in chronological order, allowing callbacks to schedule more.
    for (let guard = 0; guard < 1000; guard++) {
      const due = timers
        .filter((timer) => timer.at <= now)
        .sort((a, b) => a.at - b.at || a.id - b.id);
      if (due.length === 0) return;
      const timer = due[0];
      timers.splice(timers.indexOf(timer), 1);
      timer.callback();
    }
    throw new Error("timer loop did not settle");
  };

  return {
    schedule,
    cancel,
    advance,
    now: () => now,
    get pending() {
      return timers.length;
    }
  };
}

function createHarnessNavigation(
  overrides: {
    /** State the navigator reports back after each apply. */
    stateAfterApply?: (attempts: number) => NavigationStateLike | null;
  } = {}
) {
  const harness = createHarness();
  const applied: string[] = [];
  let attempts = 0;

  const navigation = createLaunchNavigation({
    apply: (target) => {
      attempts++;
      applied.push(target.pathname);
    },
    isApplied: (target) =>
      isTargetInState(overrides.stateAfterApply?.(attempts) ?? null, target),
    isFocused: (target) => isFocusedTarget(overrides.stateAfterApply?.(attempts) ?? null, target),
    now: harness.now,
    schedule: harness.schedule,
    cancel: harness.cancel
  });

  return { ...harness, navigation, applied, attempts: () => attempts };
}

/** Root navigation state for a pushed modal screen. */
function withDetailFocused(): NavigationStateLike {
  return { index: 1, routes: [{ name: "(tabs)" }, { name: "modal/podcast-detail" }] };
}

test("a push issued before the navigator is ready is retried until it lands", () => {
  // The navigator only reports the route once it has taken two attempts, mirroring a
  // cold start where the first push is discarded.
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: (attempts) =>
      attempts >= 2 ? withDetailFocused() : null
  });

  navigation.request(DETAIL_URL);
  assert.deepEqual(applied, [DETAIL_PATH]);

  advance(LAUNCH_RETRY_MS);
  assert.deepEqual(applied, [DETAIL_PATH, DETAIL_PATH]);

  // The second attempt landed, so no further retries are scheduled.
  advance(LAUNCH_RETRY_MS * 10);
  assert.deepEqual(applied, [DETAIL_PATH, DETAIL_PATH]);
});

test("retries stop once the retry timeout is exhausted", () => {
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: () => null
  });

  navigation.request(DETAIL_URL);
  assert.equal(applied.length, 1);

  advance(LAUNCH_RETRY_TIMEOUT_MS + LAUNCH_RETRY_MS * 10);

  // The destination never appeared, so the attempt is abandoned rather than retried
  // forever, and the last push is still counted.
  const attemptsAtTimeout = applied.length;
  advance(LAUNCH_RETRY_TIMEOUT_MS * 2);
  assert.equal(applied.length, attemptsAtTimeout);
});

test("a launch already resolved into the initial state is not pushed again", () => {
  // expo-router can build the initial state from the same intent, leaving the screen
  // focused before any of our listeners run.
  const { navigation, applied } = createHarnessNavigation({
    stateAfterApply: () => withDetailFocused()
  });

  assert.equal(navigation.request(DETAIL_URL), true);
  assert.deepEqual(applied, []);
});

test("repeat requests for the same destination within the dedupe window navigate once", () => {
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: (attempts) =>
      attempts >= 1 ? withDetailFocused() : null
  });

  navigation.request(DETAIL_URL);
  advance(LAUNCH_RETRY_MS);
  assert.deepEqual(applied, [DETAIL_PATH]);

  // Another launch path reports the same tap.
  assert.equal(navigation.request(DETAIL_URL), false);
  assert.deepEqual(applied, [DETAIL_PATH]);
});

test("a still in-flight request absorbs repeats of the same destination", () => {
  // Cold start: the linking URL arrives while the response listener is still
  // retrying. The repeat must not restart or double-schedule the navigation.
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: (attempts) => (attempts >= 4 ? withDetailFocused() : null)
  });

  navigation.request(DETAIL_URL);
  advance(LAUNCH_RETRY_MS);
  assert.equal(applied.length, 2);

  // The same tap is reported again by another launch path mid-retry.
  assert.equal(navigation.request(DETAIL_URL), true);
  advance(LAUNCH_RETRY_MS);
  assert.equal(applied.length, 3);
});

test("the native launch intent reuses the wide dedupe window after slow setup", () => {
  // The Android intent is read only after player and store setup, well past the
  // normal dedupe window. Without the wide window it would stack a duplicate screen.
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: (attempts) =>
      attempts >= 1 ? withDetailFocused() : null
  });

  navigation.request(DETAIL_URL);
  advance(LAUNCH_RETRY_MS);
  assert.deepEqual(applied, [DETAIL_PATH]);

  // Simulate the delay before setup finishes.
  advance(LAUNCH_DEDUPE_MS * 2);

  assert.equal(navigation.request(DETAIL_URL, LAUNCH_INTENT_DEDUPE_MS), false);
  assert.deepEqual(applied, [DETAIL_PATH]);
});

test("the same destination is navigable again once the dedupe window passes", () => {
  // The screen is still in the stack, but a genuinely new tap on the same podcast is
  // allowed through: re-pushing shows the latest episode rather than doing nothing.
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: (attempts) => (attempts >= 1 ? withDetailFocused() : null)
  });

  navigation.request(DETAIL_URL);
  advance(LAUNCH_RETRY_MS);
  assert.deepEqual(applied, [DETAIL_PATH]);

  advance(LAUNCH_DEDUPE_MS + 1);
  assert.equal(navigation.request(DETAIL_URL), true);
  assert.deepEqual(applied, [DETAIL_PATH, DETAIL_PATH]);
});

test("empty urls are ignored", () => {
  const { navigation, applied } = createHarnessNavigation();

  assert.equal(navigation.request(""), false);
  assert.equal(navigation.request("   "), false);
  assert.deepEqual(applied, []);
});

test("a newer destination supersedes an in-flight one", () => {
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: (attempts) => (attempts >= 2 ? withDetailFocused() : null)
  });

  navigation.request(DETAIL_URL);
  navigation.request("/modal/podcast-search?search=news");

  advance(LAUNCH_RETRY_MS);
  // The abandoned destination is not retried, only the newer one.
  assert.equal(applied.filter((path) => path === DETAIL_PATH).length, 1);
  assert.ok(applied.includes("/modal/podcast-search"));
});

test("dispose cancels pending retries", () => {
  const { navigation, applied, advance } = createHarnessNavigation({
    stateAfterApply: () => null
  });

  navigation.request(DETAIL_URL);
  assert.equal(applied.length, 1);

  navigation.dispose();
  advance(LAUNCH_RETRY_TIMEOUT_MS * 2);
  assert.equal(applied.length, 1);
});

test("a destination is matched by path as well as by name", () => {
  // The root state only holds top-level routes, so a modal screen is matched by name;
  // a top-level tab route carries a path instead.
  const tabTarget = { pathname: "/lastfm-auth", params: {} };

  assert.equal(
    isTargetInState({ index: 0, routes: [{ name: "lastfm-auth", path: "/lastfm-auth" }] }, tabTarget),
    true
  );
  assert.equal(
    isFocusedTarget({ index: 0, routes: [{ name: "lastfm-auth", path: "/lastfm-auth" }] }, tabTarget),
    true
  );
  assert.equal(
    isTargetInState({ index: 0, routes: [{ name: "(tabs)" }] }, tabTarget),
    false
  );
});

test("state helpers tolerate a missing or empty state", () => {
  const target = { pathname: DETAIL_PATH, params: {} };

  assert.equal(isTargetInState(null, target), false);
  assert.equal(isTargetInState(undefined, target), false);
  assert.equal(isTargetInState({ index: 0, routes: [] }, target), false);
  assert.equal(isFocusedTarget(null, target), false);
  assert.equal(isFocusedTarget({ index: 0, routes: [] }, target), false);
});
