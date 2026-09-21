import type {
  WorkoutRun,
  WorkoutSetResult,
  UpdateWorkoutRunInput,
} from "../../../../shared/workout-plans.ts";
import type { SetFields } from "./forms.ts";
import {
  effectiveRunForTimer,
  readStoredWorkoutTimer,
  type StoredWorkoutTimer,
} from "./timer-record.ts";

export const OFFLINE_TTL = 7 * 24 * 60 * 60_000;
export const OFFLINE_LEASE = 24 * 60 * 60_000;
export const OFFLINE_CAPACITY = 10;
export type RunDraft = { results: WorkoutSetResult[]; note: string; finish: boolean };
export type ActiveSetDraft = { exerciseId: string; setId: string; fields: SetFields };
export type OfflineRun = {
  base: WorkoutRun;
  draft: RunDraft;
  active: ActiveSetDraft | null;
  /** Separate from actuals and upload payloads. Missing on legacy device documents. */
  timer?: StoredWorkoutTimer | null;
  version: number;
  updatedAt: number;
  pending: { mutationId: string; version: number; payload: UpdateWorkoutRunInput } | null;
  conflict: WorkoutRun | null;
  blocked: boolean;
  readBlocked: boolean;
  privateOnSync: boolean;
};
export type OfflineDocument = {
  schema: 1;
  binding: string;
  ownerId: string;
  verifiedAt: number;
  runs: OfflineRun[];
};
export const runDraft = (run: WorkoutRun): RunDraft => ({
  results: run.results,
  note: run.note,
  finish: run.status === "completed",
});
const resultKey = (result: WorkoutSetResult) =>
  JSON.stringify([
    result.exerciseId,
    result.setId,
    result.status,
    result.reps,
    result.durationSeconds,
    result.distanceMeters,
    result.weight,
    result.unit,
  ]);
const resultMap = (results: WorkoutSetResult[]) =>
  new Map(results.map((result) => [result.setId, resultKey(result)]));
export const sameDraft = (a: RunDraft, b: RunDraft) => {
  if (a.note !== b.note || a.finish !== b.finish || a.results.length !== b.results.length)
    return false;
  const other = resultMap(b.results);
  return a.results.every((result) => other.get(result.setId) === resultKey(result));
};
export const hasPendingRun = (entry: OfflineRun) =>
  entry.pending !== null ||
  (entry.privateOnSync && entry.base.shareAccountability) ||
  !sameDraft(entry.draft, runDraft(entry.base));
export const unsyncedSetCount = (entry: OfflineRun) => {
  const before = resultMap(entry.base.results);
  const after = resultMap(entry.draft.results);
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => before.get(id) !== after.get(id),
  ).length;
};
export function newOfflineRun(run: WorkoutRun, now: number): OfflineRun {
  return {
    base: run,
    draft: runDraft(run),
    active: null,
    timer: null,
    version: 0,
    updatedAt: now,
    pending: null,
    conflict: null,
    blocked: false,
    readBlocked: false,
    privateOnSync: false,
  };
}
/** Never replace a request whose response may have been lost. Later edits stay in draft. */
export function prepareUpload(entry: OfflineRun, mutationId: string): OfflineRun {
  if (
    entry.pending ||
    !hasPendingRun(entry) ||
    entry.conflict ||
    entry.blocked ||
    entry.readBlocked
  )
    return entry;
  return {
    ...entry,
    pending: {
      mutationId,
      version: entry.version,
      payload: {
        expectedRevision: entry.base.revision,
        results: entry.draft.results,
        note: entry.draft.note,
        finish: entry.draft.finish,
        shareAccountability: !entry.privateOnSync && entry.base.shareAccountability,
      },
    },
  };
}
export function acknowledgeUpload(
  entry: OfflineRun,
  mutationId: string,
  saved: WorkoutRun,
): OfflineRun {
  if (entry.pending?.mutationId !== mutationId) return entry;
  const updated: OfflineRun = {
    ...entry,
    base: saved,
    pending: null,
    conflict: null,
    blocked: false,
    privateOnSync: false,
    draft: entry.version === entry.pending.version ? runDraft(saved) : entry.draft,
  };
  return {
    ...updated,
    timer:
      updated.draft.finish || updated.readBlocked
        ? null
        : readStoredWorkoutTimer(updated.timer, effectiveRunForTimer(updated), updated.active),
  };
}
/** The member explicitly reviewed both versions. Preserve actuals, never prescriptions. */
export function resolveRunConflict(
  entry: OfflineRun,
  choice: "server" | "local" | "private",
  now: number,
): OfflineRun {
  if (!entry.conflict) throw new Error("Refresh the saved workout before reviewing a conflict.");
  const fresh = newOfflineRun(entry.conflict, now);
  return choice === "server"
    ? fresh
    : {
        ...fresh,
        draft: {
          ...entry.draft,
          finish: entry.draft.finish || entry.conflict.status === "completed",
        },
        active: entry.active,
        privateOnSync: choice === "private",
        version: entry.version + 1,
      };
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  finite(v) && Number.isInteger(v) && v >= min && v <= max;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const date = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const unit = (v: unknown) => typeof v === "string" && ["kg", "lb", "bodyweight"].includes(v);
const quantity = (v: unknown, max: number, whole = false, zero = false) =>
  v === null ||
  (finite(v) && v >= (zero ? 0 : Number.MIN_VALUE) && v <= max && (!whole || Number.isInteger(v)));
function amounts(v: Record<string, unknown>) {
  return (
    quantity(v.reps, 1000, true) &&
    quantity(v.durationSeconds, 86400) &&
    quantity(v.distanceMeters, 1_000_000) &&
    quantity(v.weight, 2000, false, true) &&
    unit(v.unit) &&
    (v.unit !== "bodyweight" || v.weight === null)
  );
}
const effort = (v: Record<string, unknown>) =>
  v.reps !== null || v.durationSeconds !== null || v.distanceMeters !== null;
function validResults(value: unknown, ids: Map<string, string>): value is WorkoutSetResult[] {
  if (!Array.isArray(value) || value.length > 120) return false;
  const seen = new Set<string>();
  for (const result of value) {
    if (
      !object(result) ||
      !uuid(result.setId) ||
      !uuid(result.exerciseId) ||
      ids.get(result.setId) !== result.exerciseId ||
      seen.has(result.setId) ||
      !amounts(result)
    )
      return false;
    if (
      result.status === "completed"
        ? !effort(result)
        : result.status !== "skipped" || effort(result) || result.weight !== null
    )
      return false;
    seen.add(result.setId);
  }
  return true;
}
const setIds = (run: WorkoutRun) =>
  new Map(
    run.snapshot.exercises.flatMap((exercise) =>
      exercise.sets.map((set) => [set.id, exercise.id] as const),
    ),
  );
export function validRun(run: unknown): run is WorkoutRun {
  if (
    !object(run) ||
    !uuid(run.id) ||
    !integer(run.revision, 1) ||
    !integer(run.planRevision, 1) ||
    !(run.planId === null || uuid(run.planId)) ||
    !(run.sessionId === null || bounded(run.sessionId, 200)) ||
    !date(run.startedAt) ||
    !date(run.updatedAt) ||
    !(run.finishedAt === null || date(run.finishedAt)) ||
    !object(run.snapshot) ||
    !bounded(run.snapshot.title, 120) ||
    !run.snapshot.title.trim() ||
    !bounded(run.snapshot.instructions, 2000) ||
    typeof run.snapshot.activity !== "string" ||
    !["run", "walk", "hike", "ride", "strength", "mobility"].includes(run.snapshot.activity) ||
    !Array.isArray(run.snapshot.exercises) ||
    run.snapshot.exercises.length < 1 ||
    run.snapshot.exercises.length > 12 ||
    !bounded(run.note, 1000) ||
    typeof run.status !== "string" ||
    !["in_progress", "completed"].includes(run.status) ||
    typeof run.shareAccountability !== "boolean" ||
    (run.status === "completed") !== (run.finishedAt !== null)
  )
    return false;
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const exercise of run.snapshot.exercises) {
    if (
      !object(exercise) ||
      !uuid(exercise.id) ||
      used.has(exercise.id) ||
      !bounded(exercise.name, 100) ||
      !exercise.name.trim() ||
      !bounded(exercise.instructions, 1000) ||
      !Array.isArray(exercise.sets) ||
      exercise.sets.length < 1 ||
      exercise.sets.length > 20
    )
      return false;
    used.add(exercise.id);
    for (const set of exercise.sets) {
      if (
        !object(set) ||
        !uuid(set.id) ||
        used.has(set.id) ||
        !amounts(set) ||
        !effort(set) ||
        !integer(set.restSeconds, 0, 3600)
      )
        return false;
      used.add(set.id);
      ids.set(set.id, exercise.id);
    }
  }
  return (
    ids.size <= 120 &&
    validResults(run.results, ids) &&
    (run.status !== "completed" || run.results.length > 0)
  );
}
function validDraft(value: unknown, run: WorkoutRun): value is RunDraft {
  return (
    object(value) &&
    validResults(value.results, setIds(run)) &&
    bounded(value.note, 1000) &&
    typeof value.finish === "boolean" &&
    (!value.finish || value.results.length > 0)
  );
}
export function readOfflineDocument(
  value: unknown,
  binding: string,
  now: number,
): OfflineDocument | null {
  if (
    !object(value) ||
    value.schema !== 1 ||
    value.binding !== binding ||
    !bounded(value.ownerId, 100) ||
    !value.ownerId ||
    !finite(value.verifiedAt) ||
    value.verifiedAt < 0 ||
    value.verifiedAt > now + 60_000 ||
    !Array.isArray(value.runs) ||
    value.runs.length > OFFLINE_CAPACITY
  )
    return null;
  const runs: OfflineRun[] = [];
  const seen = new Set<string>();
  for (const item of value.runs) {
    if (
      !object(item) ||
      !validRun(item.base) ||
      seen.has(item.base.id) ||
      !validDraft(item.draft, item.base) ||
      typeof item.blocked !== "boolean" ||
      typeof item.readBlocked !== "boolean" ||
      typeof item.privateOnSync !== "boolean" ||
      !integer(item.version, 0) ||
      !finite(item.updatedAt) ||
      item.updatedAt < 0 ||
      item.updatedAt > now + 60_000
    )
      return null;
    seen.add(item.base.id);
    if (
      item.pending !== null &&
      (!object(item.pending) ||
        !uuid(item.pending.mutationId) ||
        !object(item.pending.payload) ||
        typeof item.pending.payload.shareAccountability !== "boolean" ||
        item.pending.payload.expectedRevision !== item.base.revision ||
        !validDraft(item.pending.payload, item.base) ||
        !integer(item.pending.version, 0, item.version))
    )
      return null;
    if (
      item.conflict !== null &&
      (!validRun(item.conflict) ||
        item.conflict.id !== item.base.id ||
        item.conflict.revision < item.base.revision ||
        JSON.stringify(item.conflict.snapshot) !== JSON.stringify(item.base.snapshot))
    )
      return null;
    if (item.active !== null) {
      if (
        !object(item.active) ||
        !uuid(item.active.setId) ||
        setIds(item.base).get(item.active.setId) !== item.active.exerciseId ||
        !object(item.active.fields)
      )
        return null;
      const fields = item.active.fields;
      if (
        !unit(fields.unit) ||
        ["reps", "weight", "durationSeconds", "distanceMeters", "restSeconds"].some(
          (key) => !bounded(fields[key], 30),
        )
      )
        return null;
    }
    if (item.updatedAt + OFFLINE_TTL > now) {
      const entry = item as unknown as OfflineRun;
      runs.push({
        ...entry,
        timer:
          entry.conflict || entry.draft.finish || entry.readBlocked
            ? null
            : readStoredWorkoutTimer(entry.timer, effectiveRunForTimer(entry), entry.active),
      });
    }
  }
  return { schema: 1, binding, ownerId: value.ownerId, verifiedAt: value.verifiedAt, runs };
}

/** Only replace a displayed field when it still matches the previously rendered durable value. */
export const reconcileEditorField = <T>(current: T, previous: T, next: T): T =>
  current === previous ? next : current;

/** Re-open retained incomplete actual fields after review; never manufacture a completion. */
export function activeEditorFromEntry(entry: OfflineRun) {
  const exercise = entry.base.snapshot.exercises.find(
    (item) => item.id === entry.active?.exerciseId,
  );
  const set = exercise?.sets.find((item) => item.id === entry.active?.setId);
  return exercise && set && entry.active
    ? { exerciseId: exercise.id, set, fields: entry.active.fields }
    : null;
}
