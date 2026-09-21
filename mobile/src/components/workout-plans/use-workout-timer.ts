import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import {
  createWorkoutTimerLifecycle,
  type WorkoutTimerCheckpoint,
  type WorkoutTimerView,
} from "@/lib/workout-plans/workout-timer";
import type { StoredWorkoutTimer } from "@/lib/workout-plans/timer-record";

export type TimerPersistence = {
  record: StoredWorkoutTimer | null;
  currentId: string | null;
  save(id: string, clock: WorkoutTimerCheckpoint, expectedId: string | null): Promise<void>;
};

/** Persist transitions, not ticks. A saved epoch start needs no background JS execution. */
export function useWorkoutTimer({
  scope,
  isCurrent,
  disabled = false,
  autoStart = false,
  persistence,
}: {
  scope: string;
  isCurrent: () => boolean;
  disabled?: boolean;
  autoStart?: boolean;
  persistence?: TimerPersistence;
}) {
  const [binding] = useState(() => ({
    id: persistence?.record?.id ?? Crypto.randomUUID(),
    expectedId: persistence?.currentId ?? null,
  }));
  const [timer] = useState(() =>
    createWorkoutTimerLifecycle({
      now: Date.now,
      // Install account/set guards after the parent commits its active-set scope.
      isCurrent: () => true,
      scope,
      checkpoint: persistence?.record?.clock,
      autoStart: false,
      disabled,
    }),
  );
  const latest = useRef({ isCurrent, persistence, disabled });
  useLayoutEffect(() => {
    latest.current = { isCurrent, persistence, disabled };
  }, [isCurrent, persistence, disabled]);
  const alive = useRef(true);
  const pending = useRef(false);
  // A restored warning is already durable. Only a newly detected reason needs another write;
  // otherwise checkpoint-key remounts would keep rewriting the same warning indefinitely.
  const warned = useRef<string | null>(persistence?.record?.clock.reviewReason ?? null);
  const warningAttempt = useRef<string | null>(persistence?.record?.clock.reviewReason ?? null);
  const initialStart = useRef(autoStart && !persistence?.record);
  const focused = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<WorkoutTimerView>({
    elapsedSeconds: null,
    running: false,
    reviewReason: null,
  });
  const update = useCallback(() => {
    if (!alive.current) return;
    const next = timer.read();
    setView((previous) =>
      previous.elapsedSeconds === next.elapsedSeconds &&
      previous.running === next.running &&
      previous.reviewReason === next.reviewReason
        ? previous
        : next,
    );
  }, [timer]);
  const canTransition = useCallback(
    () =>
      !pending.current &&
      alive.current &&
      focused.current &&
      !latest.current.disabled &&
      latest.current.isCurrent() &&
      AppState.currentState === "active",
    [],
  );
  const transition = useCallback(
    async (change: () => void): Promise<boolean> => {
      if (!canTransition()) return false;
      initialStart.current = false;
      const before = timer.checkpoint();
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        change();
        const checkpoint = timer.checkpoint();
        if (!checkpoint) throw new Error("Reopen this workout to use its timer.");
        update();
        await latest.current.persistence?.save(binding.id, checkpoint, binding.expectedId);
        // A skipped or failed write must remain eligible for the next foreground/focus retry.
        warned.current = checkpoint.reviewReason;
        warningAttempt.current = checkpoint.reviewReason;
        return true;
      } catch {
        if (alive.current && latest.current.isCurrent()) {
          if (before) timer.restore(before);
          setError("That timer change could not be saved. Try again before leaving the screen.");
        }
        return false;
      } finally {
        pending.current = false;
        if (alive.current) {
          setBusy(false);
          update();
        }
      }
    },
    [binding, canTransition, timer, update],
  );
  const persistWarning = useCallback(
    (retry = false) => {
      if (!canTransition()) return;
      const reason = timer.read().reviewReason;
      if (!reason || warned.current === reason || (!retry && warningAttempt.current === reason))
        return;
      // At most one attempt per detected reason until an explicit eligibility transition.
      warningAttempt.current = reason;
      void transition(() => {});
    },
    [canTransition, timer, transition],
  );
  const startInitial = useCallback(() => {
    if (initialStart.current && !latest.current.disabled) void transition(() => timer.start());
  }, [timer, transition]);
  useEffect(() => {
    alive.current = true;
    timer.setCurrentGuard(() => alive.current && latest.current.isCurrent());
    update();
    // The installed guard already closes late callbacks. Destructively clearing the engine here
    // would also erase a restored checkpoint during React's setup/cleanup/setup replay.
    return () => {
      alive.current = false;
    };
  }, [timer, update]);
  useEffect(() => {
    timer.setDisabled(disabled);
    startInitial();
    if (!disabled) persistWarning(true);
    update();
  }, [disabled, timer, startInitial, persistWarning, update]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      timer.focus(AppState.currentState === "active");
      startInitial();
      persistWarning(true);
      update();
      return () => {
        focused.current = false;
        // A real navigation blur cancels a deferred first start; effect replay does not.
        if (alive.current) initialStart.current = false;
        timer.blur();
      };
    }, [timer, startInitial, persistWarning, update]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      timer.foregroundChanged(state === "active");
      if (state !== "active") initialStart.current = false;
      else {
        startInitial();
        persistWarning(true);
      }
      update();
    });
    const interval = setInterval(update, 250);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [timer, startInitial, persistWarning, update]);
  useEffect(() => {
    if (view.reviewReason && !busy) persistWarning();
  }, [view.reviewReason, busy, persistWarning]);
  return {
    ...view,
    busy,
    error,
    durable: !!persistence,
    start: () => void transition(() => timer.start()),
    pause: () => void transition(() => timer.pause()),
    reset: () => void transition(() => timer.reset()),
    restart: () =>
      void transition(() => {
        timer.reset();
        timer.start();
      }),
    // The synchronous pending ref also fences already-queued taps before React publishes busy.
    confirmedDuration: () => (canTransition() ? timer.confirmedDuration() : null),
  };
}
