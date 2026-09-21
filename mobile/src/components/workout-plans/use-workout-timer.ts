import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { createWorkoutTimerLifecycle } from "@/lib/workout-plans/workout-timer";

/** Ephemeral aid: leaving this screen or the foreground pauses, never resumes automatically. */
export function useWorkoutTimer({
  isCurrent,
  disabled = false,
  autoStart = false,
}: {
  isCurrent: () => boolean;
  disabled?: boolean;
  autoStart?: boolean;
}) {
  const [timer] = useState(() =>
    createWorkoutTimerLifecycle({
      now: () => performance.now(),
      isCurrent,
      autoStart,
      disabled,
    }),
  );
  const [view, setView] = useState({ elapsedSeconds: 0, running: false });
  useLayoutEffect(() => {
    timer.setCurrentGuard(isCurrent);
    timer.setDisabled(disabled);
  }, [disabled, isCurrent, timer]);
  useLayoutEffect(() => () => timer.setCurrentGuard(() => false), [timer]);
  const update = useCallback(() => {
    const next = timer.read();
    setView((previous) =>
      previous.elapsedSeconds === next.elapsedSeconds && previous.running === next.running
        ? previous
        : next,
    );
  }, [timer]);
  useFocusEffect(
    useCallback(() => {
      timer.focus(AppState.currentState === "active");
      update();
      return () => {
        timer.blur();
        update();
      };
    }, [timer, update]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      timer.foregroundChanged(state === "active");
      update();
    });
    const interval = setInterval(update, 250);
    return () => {
      subscription.remove();
      clearInterval(interval);
      timer.reset();
    };
  }, [timer, update]);
  const start = () => {
    if (AppState.currentState !== "active") return;
    timer.start();
    update();
  };
  return {
    ...view,
    start,
    pause: () => {
      timer.pause();
      update();
    },
    reset: () => {
      timer.reset();
      update();
    },
    confirmedDuration: () => {
      if (AppState.currentState !== "active") return null;
      return timer.confirmedDuration();
    },
  };
}
