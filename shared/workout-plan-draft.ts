import type { AIWorkoutPlanDraft, WorkoutPlanContent } from "./workout-plans.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fields = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const text = (value: unknown, max: number, required = false): value is string =>
  typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Suggestions only. This validates shape and limits, not suitability or completion. */
export function isAIWorkoutPlanDraft(value: unknown): value is AIWorkoutPlanDraft {
  if (
    !record(value) ||
    !fields(value, ["title", "activity", "instructions", "exercises"]) ||
    !text(value.title, 120, true) ||
    !["run", "walk", "hike", "ride", "strength", "mobility"].includes(value.activity as string) ||
    !text(value.instructions, 1000) ||
    !Array.isArray(value.exercises) ||
    value.exercises.length < 1 ||
    value.exercises.length > 12
  )
    return false;
  let totalSets = 0;
  for (const exercise of value.exercises) {
    if (
      !record(exercise) ||
      !fields(exercise, [
        "name",
        "instructions",
        "sets",
        "reps",
        "durationSeconds",
        "restSeconds",
      ]) ||
      !text(exercise.name, 100, true) ||
      !text(exercise.instructions, 500) ||
      !integer(exercise.sets, 1, 20) ||
      !(exercise.reps === null || integer(exercise.reps, 1, 1000)) ||
      !(exercise.durationSeconds === null || integer(exercise.durationSeconds, 1, 86400)) ||
      !integer(exercise.restSeconds, 0, 3600) ||
      (exercise.reps === null && exercise.durationSeconds === null)
    )
      return false;
    totalSets += exercise.sets;
  }
  return totalSets <= 120;
}

/** Code expands prescriptions; no result, observation, completion time, or load is invented. */
export function planContentFromAIDraft(
  draft: AIWorkoutPlanDraft,
  makeId: () => string,
): WorkoutPlanContent {
  if (!isAIWorkoutPlanDraft(draft)) throw new Error("Review a valid workout draft first.");
  const ids = new Set<string>();
  const nextId = () => {
    const id = makeId().toLowerCase();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ||
      ids.has(id)
    )
      throw new Error("Unable to prepare this workout draft.");
    ids.add(id);
    return id;
  };
  return {
    title: draft.title.trim(),
    activity: draft.activity,
    instructions: draft.instructions.trim(),
    exercises: draft.exercises.map((exercise) => ({
      id: nextId(),
      name: exercise.name.trim(),
      instructions: exercise.instructions.trim(),
      sets: Array.from({ length: exercise.sets }, () => ({
        id: nextId(),
        reps: exercise.reps,
        durationSeconds: exercise.durationSeconds,
        distanceMeters: null,
        weight: null,
        // An empty load remains unspecified; this is only the editor's default unit.
        unit: "kg" as const,
        restSeconds: exercise.restSeconds,
      })),
    })),
  };
}
