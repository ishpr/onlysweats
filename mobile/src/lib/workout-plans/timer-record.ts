import type { WorkoutRun } from "../../../../shared/workout-plans.ts";
import type { ActiveSetDraft, OfflineRun } from "./offline-data.ts";
import {
  createWorkoutTimer,
  readWorkoutTimerCheckpoint,
  workoutSetTimerIdentity,
  type WorkoutTimerCheckpoint,
} from "./workout-timer.ts";

export type StoredWorkoutTimer = {
  id: string;
  kind: "exercise" | "rest";
  exerciseId: string;
  setId: string;
  targetSeconds: number;
  clock: WorkoutTimerCheckpoint;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function effectiveRunForTimer(entry: OfflineRun): WorkoutRun {
  return {
    ...entry.base,
    results: entry.draft.results,
    note: entry.draft.note,
    status: entry.draft.finish || entry.base.status === "completed" ? "completed" : "in_progress",
  };
}

export function scopeForWorkoutTimer(
  run: WorkoutRun,
  kind: StoredWorkoutTimer["kind"],
  exerciseId: string,
  setId: string,
): string | null {
  if (kind !== "exercise" && kind !== "rest") return null;
  const identity = workoutSetTimerIdentity(run, exerciseId, setId);
  return identity ? `${kind}:${identity}` : null;
}

function targetFor(
  run: WorkoutRun,
  kind: StoredWorkoutTimer["kind"],
  exerciseId: string,
  setId: string,
) {
  const set = run.snapshot.exercises
    .find((exercise) => exercise.id === exerciseId)
    ?.sets.find((item) => item.id === setId);
  if (!set) return null;
  const target = kind === "rest" ? set.restSeconds : set.durationSeconds;
  return typeof target === "number" &&
    Number.isInteger(target) &&
    target >= 1 &&
    target <= (kind === "rest" ? 3600 : 86400)
    ? target
    : null;
}

/** Restore only a clock attached to the current set; malformed clocks never erase workout actuals. */
export function readStoredWorkoutTimer(
  value: unknown,
  run: WorkoutRun,
  active: ActiveSetDraft | null,
): StoredWorkoutTimer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).some(
      (key) => !["id", "kind", "exerciseId", "setId", "targetSeconds", "clock"].includes(key),
    ) ||
    !uuid(item.id) ||
    !uuid(item.exerciseId) ||
    !uuid(item.setId) ||
    (item.kind !== "exercise" && item.kind !== "rest")
  )
    return null;
  const target = targetFor(run, item.kind, item.exerciseId, item.setId);
  const scope = scopeForWorkoutTimer(run, item.kind, item.exerciseId, item.setId);
  if (target === null || target !== item.targetSeconds || scope === null) return null;
  if (item.kind === "exercise") {
    if (active?.exerciseId !== item.exerciseId || active.setId !== item.setId) return null;
  } else if (
    !run.results.some(
      (actual) =>
        actual.exerciseId === item.exerciseId &&
        actual.setId === item.setId &&
        actual.status === "completed",
    )
  )
    return null;
  const clock = readWorkoutTimerCheckpoint(item.clock, scope);
  return clock
    ? {
        id: item.id,
        kind: item.kind,
        exerciseId: item.exerciseId,
        setId: item.setId,
        targetSeconds: target,
        clock,
      }
    : null;
}

/** A prescription supplies a countdown target, never elapsed time or a completed result. */
export function makeStoredWorkoutTimer(
  run: WorkoutRun,
  kind: StoredWorkoutTimer["kind"],
  exerciseId: string,
  setId: string,
  id: string,
  now: number,
  start = true,
): StoredWorkoutTimer {
  const scope = scopeForWorkoutTimer(run, kind, exerciseId, setId);
  const targetSeconds = targetFor(run, kind, exerciseId, setId);
  if (
    !uuid(id) ||
    !uuid(exerciseId) ||
    !uuid(setId) ||
    !scope ||
    targetSeconds === null ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new Error("This set no longer has a valid timer target. Reopen the workout.");
  const timer = createWorkoutTimer({ now: () => now, isCurrent: () => true, scope });
  if (start) timer.start();
  const clock = timer.checkpoint();
  if (!clock) throw new Error("The workout timer could not be started.");
  return { id, kind, exerciseId, setId, targetSeconds, clock };
}

/** Compare-and-set a protected clock without creating a workout mutation or extending its lease. */
export function writeOfflineTimer(
  entry: OfflineRun,
  record: StoredWorkoutTimer | null,
  expectedTimerId: string | null,
): OfflineRun {
  const existingId = entry.timer?.id ?? null;
  if (existingId !== expectedTimerId && (record === null || record.id !== existingId))
    throw new Error("The workout timer changed. Reopen it before continuing.");
  if (record === null) return { ...entry, timer: null };
  const validated =
    !entry.conflict && !entry.readBlocked && !entry.draft.finish
      ? readStoredWorkoutTimer(record, effectiveRunForTimer(entry), entry.active)
      : null;
  if (!validated) throw new Error("This timer no longer matches the current workout set.");
  return { ...entry, timer: validated };
}
