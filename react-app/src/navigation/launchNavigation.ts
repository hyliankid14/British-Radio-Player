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

/** Minimal shape of a react-navigation route, so the helpers stay framework free. */
export interface NavigationRouteLike {
  name?: string;
  path?: string;
  /** State of the navigator this screen renders. */
  state?: NavigationStateLike;
}

/**
 * Minimal shape of a react-navigation state, so the helpers stay framework free.
 *
 * Routes nest the state of the navigator their screen renders, so the helpers below
 * have to walk the whole tree: expo-router mounts the root layout inside a `__root`
 * slot navigator, and that navigator's state only ever holds a single `__root` route.
 * The app's own stack sits one level down, inside `routes[0].state`.
 */
export interface NavigationStateLike {
  index?: number;
  routes?: ReadonlyArray<NavigationRouteLike>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface LaunchNavigationOptions {
  /** Performs the actual navigation. Must not throw. */
  apply: (target: AppNavigationTarget) => void;
  /**
   * Puts the app into the state the destination should open on top of — for example
   * the list a modal's back button should fall back to. Runs before every navigation
   * attempt, and when a launch has already been resolved into the initial state.
   * Must not throw.
   */
  prepare?: (target: AppNavigationTarget) => void;
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

/** A modal screen is matched by name, a route inside a navigator by its path. */
function matchesRoute(route: NavigationRouteLike, target: AppNavigationTarget): boolean {
  return route.name === routeName(target.pathname) || route.path === target.pathname;
}

/** True when the destination is anywhere in the state tree, focused or not. */
export function isTargetInState(
  state: NavigationStateLike | null | undefined,
  target: AppNavigationTarget
): boolean {
  if (!state?.routes?.length) return false;
  return state.routes.some(
    (route) => matchesRoute(route, target) || isTargetInState(route.state, target)
  );
}

/** True when the destination is the focused (visible) route. */
export function isFocusedTarget(
  state: NavigationStateLike | null | undefined,
  target: AppNavigationTarget
): boolean {
  let current: NavigationStateLike | null | undefined = state;
  while (current?.routes?.length) {
    const index = typeof current.index === "number" ? current.index : current.routes.length - 1;
    const route = current.routes[index];
    if (!route) return false;
    if (matchesRoute(route, target)) return true;
    current = route.state;
  }
  return false;
}

function targetKey(target: AppNavigationTarget): string {
  return `${target.pathname}?${JSON.stringify(target.params)}`;
}

/**
 * Routes notification and deep-link destinations to the navigator, collapsing the
 * several sources a single tap produces and re-issuing the push until it actually
 * lands.
 *
 * expo-router can drop a navigation issued before the root navigator is mounted,
 * which is exactly the state the app is in during a cold start. Every request is
 * therefore verified against the navigation state and retried for a bounded window,
 * and the dedupe stamp is only recorded once a request settles so a retry is never
 * mistaken for a duplicate tap.
 */
export function createLaunchNavigation(options: LaunchNavigationOptions) {
  const { apply, prepare, isApplied, isFocused } = options;
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
    // pending. On cold start the navigator can discard pushes silently, so after
    // LAUNCH_STATE_SETTLE_MS with no state change we know the push didn't land and
    // it is safe to try again.
    const sinceApply = entry.lastAppliedAt === 0 ? Infinity : now() - entry.lastAppliedAt;
    if (sinceApply >= LAUNCH_STATE_SETTLE_MS) {
      prepare?.(entry.target);
      apply(entry.target);
      entry.lastAppliedAt = now();
    }
    timer = schedule(() => {
      // A push is only considered done once the route exists in the state. Checking
      // the whole tree rather than the focused route matters because the app's stack
      // is nested inside expo-router's root slot navigator.
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
    // on screen — but it still prepares the state underneath it.
    if (isFirstRequest && isFocused(target)) {
      prepare?.(target);
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
