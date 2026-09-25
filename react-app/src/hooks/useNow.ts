import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Returns a timestamp that stays current instead of freezing at first render,
 * so relative labels like "Today at 19:40" roll over to "Yesterday at 19:40"
 * once the day changes, and catch up after the app returns from the background.
 *
 * Ticks are aligned to the interval boundary to keep them cheap: formatted times
 * are minute-precision, so a once-a-minute re-render is enough.
 *
 * @param intervalMs Tick period. Defaults to one minute.
 * @param enabled Set false to stop ticking (and release the listeners) while no
 *   component is showing a relative time.
 */
export function useNow(intervalMs = 60_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    // Re-sync immediately: the value may be stale after being disabled.
    setNow(Date.now());

    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timeout) clearTimeout(timeout);
      const remaining = intervalMs - (Date.now() % intervalMs);
      timeout = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, remaining);
    };

    schedule();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });

    return () => {
      if (timeout) clearTimeout(timeout);
      subscription.remove();
    };
  }, [intervalMs, enabled]);

  return now;
}
