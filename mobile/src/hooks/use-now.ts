import { useEffect, useState } from "react";

/**
 * The current time as state. Anything time-dependent in render (check-in windows,
 * "started", late-cancel) must read this rather than `Date.now()`: a render-time
 * clock read is only evaluated when something else happens to re-render the
 * screen, so a window that opens while you watch would never open.
 */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
