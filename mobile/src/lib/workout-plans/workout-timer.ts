import type { SetFields } from "./forms.ts";
import type { WorkoutRun } from "../../../../shared/workout-plans.ts";

export const MAX_TIMER_SECONDS = 86400;
export const MAX_TIMER_SCOPE_LENGTH = 16384;
const MAX_TIMER_MS = MAX_TIMER_SECONDS * 1000;
const CLOCK_DRIFT_TOLERANCE_MS = 5000;
export type WorkoutTimerReviewReason = "clock_changed" | "duration_limit" | "invalid_checkpoint";
export type WorkoutTimerCheckpoint = {
  schema: 1;
  scope: string;
  elapsedMs: number;
  startedAtMs: number | null;
  checkpointAtMs: number;
  reviewReason: WorkoutTimerReviewReason | null;
};
export type WorkoutTimerView = {
  elapsedSeconds: number | null;
  running: boolean;
  reviewReason: WorkoutTimerReviewReason | null;
};
const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validScope = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TIMER_SCOPE_LENGTH;

/** Validate before restoring from protected storage; never coerce missing timer readings. */
export function readWorkoutTimerCheckpoint(
  value: unknown,
  scope: string,
): WorkoutTimerCheckpoint | null {
  if (!validScope(scope) || typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const item = value as Record<string, unknown>;
  if (
    item.schema !== 1 ||
    item.scope !== scope ||
    !timestamp(item.elapsedMs) ||
    item.elapsedMs > MAX_TIMER_MS ||
    !timestamp(item.checkpointAtMs) ||
    !(
      item.startedAtMs === null ||
      (timestamp(item.startedAtMs) && item.startedAtMs <= item.checkpointAtMs)
    ) ||
    !(
      item.reviewReason === null ||
      ["clock_changed", "duration_limit", "invalid_checkpoint"].includes(
        item.reviewReason as string,
      )
    ) ||
    (item.reviewReason !== null && item.startedAtMs !== null) ||
    (item.startedAtMs !== null &&
      item.elapsedMs + item.checkpointAtMs - item.startedAtMs > MAX_TIMER_MS)
  )
    return null;
  return {
    schema: 1,
    scope,
    elapsedMs: item.elapsedMs,
    startedAtMs: item.startedAtMs,
    checkpointAtMs: item.checkpointAtMs,
    reviewReason: item.reviewReason as WorkoutTimerReviewReason | null,
  };
}

type WorkoutTimerInput = {
  /** Epoch milliseconds. Unlike a process-relative clock, this survives process restart. */
  now: () => number;
  isCurrent: () => boolean;
  scope: string;
  checkpoint?: unknown;
  /** Optional same-process drift detector; cannot prove that device wall time was unchanged while closed. */
  monotonicNow?: () => number;
};

/** Serializable wall-time aid. Elapsed timer time is never an exercise completion or measured activity. */
export function createWorkoutTimer(input: WorkoutTimerInput) {
  let elapsedMs = 0;
  let startedAtMs: number | null = null;
  let reviewReason: WorkoutTimerReviewReason | null = null;
  let lastObservedAt: number | null = null;
  let lastSafeElapsedMs = 0;
  let lastMonotonic: number | null = null;
  let disposed = false;
  let isCurrent = input.isCurrent;
  const clear = () => {
    elapsedMs = 0;
    startedAtMs = null;
    reviewReason = null;
    lastObservedAt = null;
    lastSafeElapsedMs = 0;
    lastMonotonic = null;
  };
  const current = () => {
    if (!disposed && validScope(input.scope) && isCurrent()) return true;
    clear();
    return false;
  };
  const sample = () => {
    const value = input.now();
    return timestamp(value) ? value : null;
  };
  const monotonic = () => {
    const value = input.monotonicNow?.();
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const requireReview = (reason: WorkoutTimerReviewReason) => {
    elapsedMs = lastSafeElapsedMs;
    startedAtMs = null;
    reviewReason = reason;
    lastMonotonic = null;
    return null;
  };
  const elapsed = (): number | null => {
    if (reviewReason) return null;
    if (startedAtMs === null) return elapsedMs;
    const time = sample();
    const monotonicTime = monotonic();
    if (
      time === null ||
      time < startedAtMs ||
      (lastObservedAt !== null && time < lastObservedAt) ||
      (input.monotonicNow && monotonicTime === null) ||
      (lastMonotonic !== null &&
        monotonicTime !== null &&
        lastObservedAt !== null &&
        (monotonicTime < lastMonotonic ||
          Math.abs(time - lastObservedAt - (monotonicTime - lastMonotonic)) >
            CLOCK_DRIFT_TOLERANCE_MS))
    )
      return requireReview("clock_changed");
    const total = elapsedMs + time - startedAtMs;
    if (total > MAX_TIMER_MS) return requireReview("duration_limit");
    lastSafeElapsedMs = total;
    lastObservedAt = time;
    lastMonotonic = monotonicTime;
    return total;
  };
  const restore = (value: unknown) => {
    if (!current()) return false;
    clear();
    const checkpoint = readWorkoutTimerCheckpoint(value, input.scope);
    if (!checkpoint) {
      reviewReason = "invalid_checkpoint";
      return false;
    }
    elapsedMs = checkpoint.elapsedMs;
    startedAtMs = checkpoint.startedAtMs;
    lastObservedAt = checkpoint.checkpointAtMs;
    lastSafeElapsedMs =
      elapsedMs + (startedAtMs === null ? 0 : checkpoint.checkpointAtMs - startedAtMs);
    reviewReason = checkpoint.reviewReason;
    elapsed();
    return true;
  };
  if (input.checkpoint !== undefined) restore(input.checkpoint);
  return {
    setCurrentGuard(guard: () => boolean) {
      isCurrent = guard;
      current();
    },
    read(): WorkoutTimerView {
      if (!current()) return { elapsedSeconds: null, running: false, reviewReason: null };
      const total = elapsed();
      return {
        elapsedSeconds: total === null ? null : Math.floor(total / 1000),
        running: startedAtMs !== null,
        reviewReason,
      };
    },
    start() {
      if (!current() || reviewReason || startedAtMs !== null || elapsedMs >= MAX_TIMER_MS) return;
      const time = sample();
      const monotonicTime = monotonic();
      if (time === null || (input.monotonicNow && monotonicTime === null)) {
        requireReview("clock_changed");
        return;
      }
      startedAtMs = time;
      lastObservedAt = time;
      lastMonotonic = monotonicTime;
    },
    pause() {
      if (!current()) return;
      const total = elapsed();
      if (total === null) return;
      elapsedMs = total;
      lastSafeElapsedMs = total;
      startedAtMs = null;
      lastMonotonic = null;
    },
    reset() {
      clear();
    },
    /** Call after explicit transitions. Polling read() never asks storage to write. */
    checkpoint(): WorkoutTimerCheckpoint | null {
      if (!current()) return null;
      const total = elapsed();
      const checkpointAtMs =
        startedAtMs !== null ? lastObservedAt! : (sample() ?? lastObservedAt ?? 0);
      return {
        schema: 1,
        scope: input.scope,
        elapsedMs: total ?? elapsedMs,
        startedAtMs: startedAtMs === null ? null : checkpointAtMs,
        checkpointAtMs,
        reviewReason,
      };
    },
    restore,
    /** Only an explicit confirmation of a paused, certain reading may fill an editable actual field. */
    confirmedDuration(): number | null {
      if (!current() || reviewReason || startedAtMs !== null) return null;
      const seconds = Math.floor(elapsedMs / 1000);
      return seconds >= 1 ? seconds : null;
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

/** Focus gates interaction, not elapsed wall time. A persisted start continues while locked or closed. */
export function createWorkoutTimerLifecycle(
  input: WorkoutTimerInput & {
    autoStart: boolean;
    disabled: boolean;
  },
) {
  const timer = createWorkoutTimer(input);
  let focused = false;
  let foreground = false;
  let disabled = input.disabled;
  let initialStartPending = input.autoStart && input.checkpoint === undefined;
  const enabled = () => focused && foreground && !disabled;
  const tryInitialStart = () => {
    if (!initialStartPending || !enabled()) return;
    initialStartPending = false;
    timer.start();
  };
  return {
    read: timer.read,
    setCurrentGuard: timer.setCurrentGuard,
    checkpoint: timer.checkpoint,
    restore(value: unknown) {
      initialStartPending = false;
      return timer.restore(value);
    },
    setDisabled(value: boolean) {
      disabled = value;
      if (!disabled) tryInitialStart();
    },
    focus(active: boolean) {
      focused = true;
      foreground = active;
      tryInitialStart();
    },
    blur() {
      focused = false;
      initialStartPending = false;
    },
    foregroundChanged(active: boolean) {
      foreground = active;
      if (!active) initialStartPending = false;
      else tryInitialStart();
    },
    start() {
      if (!enabled()) return;
      initialStartPending = false;
      timer.start();
    },
    pause() {
      if (!enabled()) return;
      initialStartPending = false;
      timer.pause();
    },
    reset() {
      if (!enabled()) return;
      initialStartPending = false;
      timer.reset();
    },
    dispose: timer.dispose,
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
