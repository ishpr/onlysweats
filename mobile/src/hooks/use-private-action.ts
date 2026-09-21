import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiSession } from "@/lib/api";

/** Serial actions with immediate duplicate protection and invalidation on unmount. */
export function usePrivateAction(session: ApiSession) {
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
    };
  }, []);
  const run = useCallback(
    async <T>(
      operation: (signal: AbortSignal) => Promise<T>,
      success?: (value: T) => void | Promise<void>,
    ) => {
      if (pending.current || !active.current || !session.isCurrent()) return;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      setError(null);
      try {
        const value = await operation(controller.signal);
        if (active.current && !controller.signal.aborted && session.isCurrent())
          await success?.(value);
      } catch (failure) {
        if (active.current && !controller.signal.aborted && session.isCurrent()) {
          setError(
            failure instanceof ApiError || failure instanceof Error
              ? failure.message
              : "That did not finish. Please try again.",
          );
        }
      } finally {
        if (pending.current === controller) pending.current = null;
        if (active.current && session.isCurrent()) setBusy(false);
      }
    },
    [session],
  );
  return { busy, error, setError, run };
}
