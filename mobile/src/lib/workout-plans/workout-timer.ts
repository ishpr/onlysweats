import type { SetFields } from "./forms.ts";
import type { WorkoutRun } from "../../../../shared/workout-plans.ts";

export const MAX_TIMER_SECONDS = 86400;
export type WorkoutTimerView = { elapsedSeconds: number; running: boolean };

/** Foreground stopwatch only. The caller supplies a monotonic clock, never a workout target. */
export function createWorkoutTimer(input: { now: () => number; isCurrent: () => boolean }) {
  let elapsedMs = 0;
  let startedAt: number | null = null;
  let disposed = false;
  let isCurrent = input.isCurrent;
  const reset = () => {
    elapsedMs = 0;
    startedAt = null;
  };
  const current = () => {
    if (!disposed && isCurrent()) return true;
    reset();
    return false;
  };
  const sample = () => {
    const time = input.now();
    return Number.isFinite(time) && time >= 0 ? time : null;
  };
  const elapsed = (time: number | null) =>
    Math.min(
      MAX_TIMER_SECONDS * 1000,
      elapsedMs + (startedAt === null || time === null ? 0 : Math.max(0, time - startedAt)),
    );
  return {
    setCurrentGuard(guard: () => boolean) {
      isCurrent = guard;
      current();
    },
    read(): WorkoutTimerView {
      if (!current()) return { elapsedSeconds: 0, running: false };
      return { elapsedSeconds: Math.floor(elapsed(sample()) / 1000), running: startedAt !== null };
    },
    start() {
      if (!current() || startedAt !== null || elapsedMs >= MAX_TIMER_SECONDS * 1000) return;
      startedAt = sample();
    },
    pause() {
      if (!current()) return;
      elapsedMs = elapsed(sample());
      startedAt = null;
    },
    reset,
    /** Only the member's explicit confirmation may consume paused elapsed time. */
    confirmedDuration(): number | null {
      if (!current() || startedAt !== null) return null;
      const seconds = Math.floor(elapsedMs / 1000);
      return seconds >= 1 ? seconds : null;
    },
    dispose() {
      disposed = true;
      reset();
    },
  };
}

/** Owns the first start and foreground transitions for both exercise and rest timers. */
export function createWorkoutTimerLifecycle(input: {
  now: () => number;
  isCurrent: () => boolean;
  autoStart: boolean;
  disabled: boolean;
}) {
  const timer = createWorkoutTimer(input);
  let focused = false;
  let foreground = false;
  let disabled = input.disabled;
  let initialStartPending = input.autoStart;
  const enabled = () => focused && foreground && !disabled;
  const tryInitialStart = () => {
    if (!initialStartPending || !enabled()) return;
    initialStartPending = false;
    timer.start();
  };
  const pause = () => {
    initialStartPending = false;
    timer.pause();
  };
  return {
    read: timer.read,
    setCurrentGuard: timer.setCurrentGuard,
    setDisabled(value: boolean) {
      disabled = value;
      if (disabled) timer.pause();
      else tryInitialStart();
    },
    focus(active: boolean) {
      focused = true;
      foreground = active;
      tryInitialStart();
    },
    blur() {
      focused = false;
      pause();
    },
    foregroundChanged(active: boolean) {
      foreground = active;
      if (!active) pause();
      else tryInitialStart();
    },
    start() {
      if (!enabled()) return;
      initialStartPending = false;
      timer.start();
    },
    pause,
    reset() {
      initialStartPending = false;
      timer.reset();
    },
    confirmedDuration: () => (enabled() ? timer.confirmedDuration() : null),
  };
}

/** Acknowledging other sets changes the run revision, not this frozen set or its actuals. */
export function workoutSetTimerIdentity(run: WorkoutRun, exerciseId: string, setId: string) {
  if (run.status !== "in_progress") return null;
  const exercise = run.snapshot.exercises.find((item) => item.id === exerciseId);
  const set = exercise?.sets.find((item) => item.id === setId);
  if (!exercise || !set) return null;
  const actual = run.results.find((item) => item.exerciseId === exerciseId && item.setId === setId);
  return JSON.stringify([
    run.id,
    run.startedAt,
    run.planId,
    run.planRevision,
    run.snapshot.title,
    run.snapshot.activity,
    run.snapshot.instructions,
    exercise.id,
    exercise.name,
    exercise.instructions,
    set.id,
    set.reps,
    set.durationSeconds,
    set.distanceMeters,
    set.weight,
    set.unit,
    set.restSeconds,
    actual
      ? [
          actual.status,
          actual.reps,
          actual.durationSeconds,
          actual.distanceMeters,
          actual.weight,
          actual.unit,
        ]
      : null,
  ]);
}

/** Confirmation fills one editable field, never creates a completed-set result. */
export function fieldsWithTimedDuration(fields: SetFields, seconds: number): SetFields {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMER_SECONDS)
    throw new Error("Pause the timer after at least one second before using its duration.");
  return { ...fields, durationSeconds: String(seconds) };
}

export const formatTimerSeconds = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
