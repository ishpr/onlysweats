import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { enablePush, pushStatus, type PushStatus } from "@/lib/push";

/** Permission state, re-read when the app comes back from Settings. */
export function usePush() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void pushStatus()
      .then(setStatus)
      .catch(() => setStatus("unavailable"));
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await enablePush());
    } catch {
      refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { status, busy, enable };
}
