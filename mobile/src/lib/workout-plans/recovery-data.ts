import type { SetFields } from "./forms.ts";

export type WorkoutRecovery = {
  version: 1;
  ownerId: string;
  runId: string;
  revision: number;
  updatedAt: number;
  note: string;
  shareAccountability: boolean;
  active: { exerciseId: string; setId: string; fields: SetFields } | null;
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Recover only small, recent inputs belonging to this member and this run. */
export function readRecovery(
  value: unknown,
  ownerId: string,
  runId: string,
  now = Date.now(),
): WorkoutRecovery | null {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.ownerId !== ownerId ||
    value.runId !== runId ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt > now + 60_000 ||
    value.updatedAt + 24 * 60 * 60_000 <= now ||
    typeof value.note !== "string" ||
    value.note.length > 1000 ||
    typeof value.shareAccountability !== "boolean"
  )
    return null;
  if (value.active !== null) {
    const active = value.active;
    if (
      !object(active) ||
      typeof active.exerciseId !== "string" ||
      active.exerciseId.length > 100 ||
      typeof active.setId !== "string" ||
      active.setId.length > 100 ||
      !object(active.fields)
    )
      return null;
    const fields = active.fields;
    if (
      !["kg", "lb", "bodyweight"].includes(String(fields.unit)) ||
      ["reps", "durationSeconds", "distanceMeters", "weight", "restSeconds"].some(
        (key) => typeof fields[key] !== "string" || String(fields[key]).length > 30,
      )
    )
      return null;
  }
  return value as WorkoutRecovery;
}
