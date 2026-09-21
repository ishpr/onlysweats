import type {
  PlannedSet,
  WorkoutPlanContent,
  WorkoutSetResult,
} from "../../../../shared/workout-plans.ts";
import type { WorkoutPlanDraft } from "./draft-handoff.ts";

export type SetFields = {
  reps: string;
  durationSeconds: string;
  distanceMeters: string;
  weight: string;
  unit: PlannedSet["unit"];
  restSeconds: string;
};
export type PlanFields = Omit<WorkoutPlanContent, "exercises"> & {
  exercises: {
    id: string;
    name: string;
    instructions: string;
    sets: (SetFields & { id: string })[];
  }[];
};

export const emptySetFields = (): SetFields => ({
  reps: "",
  durationSeconds: "",
  distanceMeters: "",
  weight: "",
  unit: "kg",
  restSeconds: "60",
});
const text = (value: number | null) => (value === null ? "" : String(value));
export const setFields = (set: PlannedSet | WorkoutSetResult): SetFields => ({
  reps: text(set.reps),
  durationSeconds: text(set.durationSeconds),
  distanceMeters: text(set.distanceMeters),
  weight: text(set.weight),
  unit: set.unit,
  restSeconds: "restSeconds" in set ? String(set.restSeconds) : "0",
});
export function planFields(content: WorkoutPlanContent): PlanFields {
  return {
    ...content,
    exercises: content.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ id: set.id, ...setFields(set) })),
    })),
  };
}

function optionalNumber(value: string, label: string, max: number, whole = false, minimum = 0) {
  if (!value.trim()) return null;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < minimum ||
    number > max ||
    (whole && !Number.isInteger(number))
  )
    throw new Error(
      `${label} must be ${whole ? "a whole number" : "a number"} from ${minimum} to ${max}.`,
    );
  return number;
}
export function parseSetFields(fields: SetFields, performed = false) {
  const reps = optionalNumber(fields.reps, "Reps", 1000, true, 1);
  const durationSeconds = optionalNumber(
    fields.durationSeconds,
    "Duration in seconds",
    86400,
    true,
    1,
  );
  const distanceMeters = optionalNumber(
    fields.distanceMeters,
    "Distance in meters",
    1_000_000,
    false,
    0.01,
  );
  if (reps === null && durationSeconds === null && distanceMeters === null)
    throw new Error(
      performed
        ? "Enter the reps, time or distance you actually completed."
        : "Give each set a target: reps, time or distance.",
    );
  const weight =
    fields.unit === "bodyweight" ? null : optionalNumber(fields.weight, "Weight", 2000);
  const restSeconds = optionalNumber(fields.restSeconds, "Rest in seconds", 3600, true) ?? 0;
  return { reps, durationSeconds, distanceMeters, weight, unit: fields.unit, restSeconds };
}
export function planContent(fields: PlanFields): WorkoutPlanContent {
  if (!fields.title.trim()) throw new Error("Give this workout a name.");
  if (fields.exercises.length < 1 || fields.exercises.length > 12)
    throw new Error("Use 1 to 12 exercises in a workout.");
  if (fields.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) > 120)
    throw new Error("Use at most 120 sets across this workout.");
  return {
    title: fields.title.trim(),
    instructions: fields.instructions.trim(),
    activity: fields.activity,
    exercises: fields.exercises.map((exercise, index) => {
      if (!exercise.name.trim()) throw new Error(`Name exercise ${index + 1}.`);
      if (exercise.sets.length < 1 || exercise.sets.length > 20)
        throw new Error("Use 1 to 20 sets for each exercise.");
      return {
        id: exercise.id,
        name: exercise.name.trim(),
        instructions: exercise.instructions.trim(),
        sets: exercise.sets.map((set) => ({ id: set.id, ...parseSetFields(set) })),
      };
    }),
  };
}

/** Imported suggestions populate prescriptions only. Missing fields stay blank for review. */
export function fieldsFromImportedDraft(draft: WorkoutPlanDraft, makeId: () => string): PlanFields {
  if (
    draft.exercises.length > 12 ||
    draft.exercises.some(
      (exercise) =>
        exercise.sets !== null &&
        (!Number.isInteger(exercise.sets) || exercise.sets < 1 || exercise.sets > 20),
    ) ||
    draft.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? 1), 0) > 120
  )
    throw new Error(
      "This draft is too large for one plan. Use up to 12 exercises, 20 sets per exercise and 120 sets total. Review the original draft before importing it.",
    );
  return {
    title: draft.title ?? "",
    activity: "strength",
    instructions: draft.note,
    exercises: draft.exercises.map((exercise) => {
      const count = exercise.sets ?? 1;
      return {
        id: makeId(),
        name: exercise.name.slice(0, 100),
        instructions: "",
        sets: Array.from({ length: count }, () => ({
          ...emptySetFields(),
          id: makeId(),
          reps: text(exercise.reps),
          weight: text(exercise.weight),
          unit: exercise.unit ?? "kg",
          restSeconds: "",
        })),
      };
    }),
  };
}

export function prescriptionLabel(set: Omit<PlannedSet, "id"> | WorkoutSetResult) {
  const parts = [
    set.reps !== null ? `${set.reps} reps` : null,
    set.durationSeconds !== null ? `${set.durationSeconds}s` : null,
    set.distanceMeters !== null ? `${set.distanceMeters}m` : null,
    set.unit === "bodyweight"
      ? "bodyweight"
      : set.weight !== null
        ? `${set.weight} ${set.unit}`
        : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
