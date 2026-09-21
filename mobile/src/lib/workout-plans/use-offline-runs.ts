import { useCallback, useEffect, useState } from "react";
import type { ApiSession } from "../api";
import { offlineWorkouts } from "./offline";
import type { OfflineRun } from "./offline-data";

export function useOfflineRuns(ownerId: string, session: ApiSession, enabled = true) {
  const [runs, setRuns] = useState<OfflineRun[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) {
      setRuns([]);
      setReady(true);
      return;
    }
    try {
      const value = await offlineWorkouts.list(ownerId, session.isCurrent);
      if (session.isCurrent()) {
        setRuns(value);
        setError(null);
        setReady(true);
      }
    } catch (failure) {
      if (session.isCurrent()) {
        setError(
          failure instanceof Error ? failure : new Error("Saved workouts could not be read."),
        );
        setReady(true);
      }
    }
  }, [ownerId, session, enabled]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (live) void reload();
    };
    refresh();
    const unsubscribe = offlineWorkouts.subscribe(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [reload]);
  return { runs, ready, error, reload };
}
