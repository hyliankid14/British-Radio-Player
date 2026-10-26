import test from "node:test";
import assert from "node:assert/strict";

import {
  backgroundRefreshInterval,
  isEpisodeListStale,
  planSubscriptionSync
} from "../src/background/syncPolicy.ts";

const MINUTE = 60_000;

// ─── Scheduling ─────────────────────────────────────────────────────────────

test("the worker is scheduled whenever there is a subscription to refresh", () => {
  // Regression: the interval used to be derived from the *armed* subscriptions, and
  // `isPodcastNotificationsEnabled` defaults to false, so a default install cancelled the
  // worker outright and nothing was ever fetched in the background.
  assert.equal(backgroundRefreshInterval(5, 60), 60);
  assert.equal(backgroundRefreshInterval(1, 15), 15);
});

test("no subscriptions cancels the worker", () => {
  assert.equal(backgroundRefreshInterval(0, 60), 0);
  assert.equal(backgroundRefreshInterval(-1, 60), 0);
});

test(`"Never" (interval 0) means manual only and cancels the worker`, () => {
  assert.equal(backgroundRefreshInterval(5, 0), 0);
});

test("a negative interval is not a schedule", () => {
  assert.equal(backgroundRefreshInterval(5, -30), 0);
});

test("fractional minutes floor to whole minutes", () => {
  assert.equal(backgroundRefreshInterval(3, 60.9), 60);
});

// ─── Refresh vs notify ──────────────────────────────────────────────────────

test("every subscription is refreshed, only armed ones may notify", () => {
  const plan = planSubscriptionSync(["a", "b", "c"], (id) => id === "b");
  assert.deepEqual(plan.refreshIds, ["b", "a", "c"]);
  assert.deepEqual(plan.notifyIds, ["b"]);
});

test("armed subscriptions are ordered first so a time budget cannot starve them", () => {
  // Both consumers walk refreshIds under a deadline. Without the ordering, a listener with
  // many subscriptions could have the two they armed cut off by the ones they did not.
  const ids = Array.from({ length: 50 }, (_, i) => `pod-${i}`);
  const plan = planSubscriptionSync(ids, (id) => id === "pod-49" || id === "pod-48");
  assert.deepEqual(plan.refreshIds.slice(0, 2), ["pod-48", "pod-49"]);
  assert.deepEqual(plan.notifyIds, ["pod-48", "pod-49"]);
});

test("a subscription with no bells armed still refreshes", () => {
  const plan = planSubscriptionSync(["a", "b"], () => false);
  assert.deepEqual(plan.refreshIds, ["a", "b"]);
  assert.deepEqual(plan.notifyIds, []);
});

test("duplicate ids are collapsed, keeping the first occurrence", () => {
  const plan = planSubscriptionSync(["a", "b", "a"], (id) => id === "a");
  assert.deepEqual(plan.refreshIds, ["a", "b"]);
  assert.deepEqual(plan.notifyIds, ["a"]);
});

test("blank ids are dropped", () => {
  const plan = planSubscriptionSync(["", "a", ""], () => true);
  assert.deepEqual(plan.refreshIds, ["a"]);
});

// ─── Staleness ──────────────────────────────────────────────────────────────

test("a list fetched within the refresh interval is fresh", () => {
  const now = 1_700_000_000_000;
  assert.equal(isEpisodeListStale(now - 30 * MINUTE, 60, now), false);
});

test("a list older than the refresh interval is stale", () => {
  // Regression: the in-car prefetch re-read only shows with an *empty* cache, so a
  // subscription that had been opened once kept its original list for the life of the process.
  const now = 1_700_000_000_000;
  assert.equal(isEpisodeListStale(now - 61 * MINUTE, 60, now), true);
});

test("exactly the interval is not yet stale", () => {
  const now = 1_700_000_000_000;
  assert.equal(isEpisodeListStale(now - 60 * MINUTE, 60, now), false);
});

test("a list with no recorded fetch time is stale", () => {
  // It arrived from somewhere that was not this app's snapshot store.
  assert.equal(isEpisodeListStale(0, 60, Date.now()), true);
});

test("manual-only means nothing is ever stale", () => {
  assert.equal(isEpisodeListStale(0, 0, Date.now()), false);
  assert.equal(isEpisodeListStale(1, 0, Date.now()), false);
});

test("the 15-minute floor still triggers a refresh", () => {
  const now = 1_700_000_000_000;
  assert.equal(isEpisodeListStale(now - 16 * MINUTE, 15, now), true);
  assert.equal(isEpisodeListStale(now - 14 * MINUTE, 15, now), false);
});
