import { resolveAppNavigation } from "../utils/navigationUtils.ts";
import type { AppNavigationTarget } from "../utils/navigationUtils.ts";

/** Window in which an identical destination is treated as an already handled tap. */
export const LAUNCH_DEDUPE_MS = 2000;

/** Delay between an attempt and the check that tells us whether it landed. */
export const LAUNCH_RETRY_MS = 120;

/**
 * Minimum time between consecutive pushes of the same destination.
 *
 * After `router.push` succeeds React re-renders the root layout (updating
 * `rootStateRef`) within a frame — well under 100 ms on any real device.
 * Waiting this long before a second push means: if the state still has not
 * updated after LAUNCH_STATE_SETTLE_MS it is because the push was silently
 * discarded by an uninitialised navigator (cold start), not because the state
 * just hasn't propagated yet.  Without this guard a warm-start retry would
 * fire a second `router.push` while the first one's re-render was still
 * pending, stacking a duplicate screen on every notification tap.
 */
export const LAUNCH_STATE_SETTLE_MS = 250;

/** How long a destination keeps being retried before it is given up on. */
export const LAUNCH_RETRY_TIMEOUT_MS = 4000;

/**
 * A launch intent read from the activity that started the app is the same tap the
 * notification response already described, but it is only read once player and store
 * setup finish — well past {@link LAUNCH_DEDUPE_MS}. Re-navigating then would stack a
 * second copy of the screen, so those callers widen the window.
 */
export const LAUNCH_INTENT_DEDUPE_MS = 15000;

/** Minimal shape of a react-navigation state, so the helpers stay framework free. */
export interface NavigationStateLike {
  index?: number;
  routes: ReadonlyArray<{ name?: string; path?: string }>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface LaunchNavigationOptions {
  /** Performs the actual navigation. Must not throw. */
  apply: (target: AppNavigationTarget) => void;
  /** True once the destination is reachable anywhere in the navigator state. */
  isApplied: (target: AppNavigationTarget) => boolean;
  /** True when the destination is the screen the user is currently looking at. */
  isFocused: (target: AppNavigationTarget) => boolean;
  /** Injectable clock, for tests. */
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

function routeName(pathname: string): string {
  return pathname.startsWith("/") ? pathname.slice(1) : pathname;
}

/** True when the destination is anywhere in the state, focused or not. */
export function isTargetInState(
  state: NavigationStateLike | null | undefined,
  target: AppNavigationTarget
): boolean {
  if (!state?.routes?.length) return false;
  const name = routeName(target.pathname);
  return state.routes.some((route) => route.name === name || route.path === target.pathname);
}

/** True when the destination is the focused (visible) route. */
export function isFocusedTarget(
  state: NavigationStateLike | null | undefined,
  target: AppNavigationTarget
): boolean {
  if (!state?.routes?.length) return false;
  const index = typeof state.index === "number" ? state.index : state.routes.length - 1;
  const route = state.routes[index];
  if (!route) return false;
  return route.name === routeName(target.pathname) || route.path === target.pathname;
}

function targetKey(target: AppNavigationTarget): string {
  return `${target.pathname}?${JSON.stringify(target.params)}`;
}

/**
 * Routes notification and deep-link destinations to the navigator, collapsing the
 * several sources a single tap produces and re-issuing the push until it actually
 * lands.
 *
 * expo-router queues `router.push` and silently discards it when the root navigator
 * is not mounted yet, which is exactly the state the app is in during a cold start.
 * Every request is therefore verified against the navigation state and retried for a
 * bounded window, and the dedupe stamp is only recorded once a request settles so a
 * retry is never mistaken for a duplicate tap.
 */
export function createLaunchNavigation(options: LaunchNavigationOptions) {
  const { apply, isApplied, isFocused } = options;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle));

  let timer: TimerHandle | null = null;
  let inFlight: { key: string; target: AppNavigationTarget; startedAt: number; lastAppliedAt: number } | null = null;
  let handled: { key: string; at: number } | null = null;

  function stopTimer() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function settle(entry: { key: string }) {
    stopTimer();
    if (inFlight === entry) inFlight = null;
    handled = { key: entry.key, at: now() };
  }

  function run(entry: { key: string; target: AppNavigationTarget; startedAt: number; lastAppliedAt: number }) {
    // Only push if this is the first attempt (lastAppliedAt === 0) or the state
    // propagation window has elapsed since the last push. This prevents the timer
    // from stacking a second screen while the first push's React re-render is still
    // pending. On cold start the navigator discards pushes silently, so after
    // LAUNCH_STATE_SETTLE_MS with no state change we know the push didn't land and
    // it is safe to try again.
    const sinceApply = entry.lastAppliedAt === 0 ? Infinity : now() - entry.lastAppliedAt;
    if (sinceApply >= LAUNCH_STATE_SETTLE_MS) {
      apply(entry.target);
      entry.lastAppliedAt = now();
    }
    timer = schedule(() => {
      // A push is only considered done once the route exists in the state. Checking
      // the whole stack rather than the focused route matters because a podcast
      // detail screen pushes the episode on top of itself moments after mounting.
      if (isApplied(entry.target)) {
        settle(entry);
        return;
      }
      if (now() - entry.startedAt >= LAUNCH_RETRY_TIMEOUT_MS) {
        settle(entry);
        return;
      }
      run(entry);
    }, LAUNCH_RETRY_MS);
  }

  /**
   * Routes `rawUrl` to the app. `dedupeWindowMs` overrides how long an identical
   * destination stays suppressed.
   */
  function request(rawUrl: string, dedupeWindowMs: number = LAUNCH_DEDUPE_MS): boolean {
    if (!rawUrl) return false;
    const target = resolveAppNavigation(rawUrl);
    if (!target) return false;
    const key = targetKey(target);

    // A request already in flight owns the destination; re-requesting it just means
    // another source saw the same tap.
    if (inFlight?.key === key) return true;

    if (handled?.key === key && now() - handled.at < dedupeWindowMs) return false;

    const isFirstRequest = handled === null && inFlight === null;

    stopTimer();
    const entry = { key, target, startedAt: now(), lastAppliedAt: 0 };

    // On a cold start expo-router can resolve the same intent into the initial state,
    // leaving the screen focused before any of our listeners run. Pushing again would
    // stack a duplicate, so the first request of the session adopts what is already
    // on screen. Later taps are genuine and always navigate.
    if (isFirstRequest && isFocused(target)) {
      settle(entry);
      return true;
    }

    inFlight = entry;
    run(entry);
    return true;
  }

  function dispose() {
    stopTimer();
    inFlight = null;
  }

  return { request, dispose };
}
