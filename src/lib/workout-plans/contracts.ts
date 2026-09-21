import { z } from "zod";

export const workoutPlanId = z.uuid().transform((id) => id.toLowerCase());
const numberOrNull = (max: number, integer = false) =>
  (integer ? z.number().int() : z.number()).positive().max(max).nullable();
const quantities = {
  reps: numberOrNull(1000, true),
  durationSeconds: numberOrNull(86400),
  distanceMeters: numberOrNull(1_000_000),
  weight: z.number().min(0).max(2000).nullable(),
  unit: z.enum(["kg", "lb", "bodyweight"]),
};
const hasEffort = (value: {
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}) => value.reps !== null || value.durationSeconds !== null || value.distanceMeters !== null;
export const plannedSetInput = z
  .strictObject({
    id: workoutPlanId,
    ...quantities,
    restSeconds: z.number().int().min(0).max(3600),
  })
  .refine(hasEffort, "Describe repetitions, duration, or distance for every planned set.")
  .refine(
    (set) => set.unit !== "bodyweight" || set.weight === null,
    "Bodyweight uses no external load.",
  );
export const workoutPlanContentInput = z
  .strictObject({
    title: z.string().trim().min(1).max(120),
    activity: z.enum(["run", "walk", "hike", "ride", "strength", "mobility"]),
    instructions: z.string().trim().max(2000),
    exercises: z
      .array(
        z.strictObject({
          id: workoutPlanId,
          name: z.string().trim().min(1).max(100),
          instructions: z.string().trim().max(1000),
          sets: z.array(plannedSetInput).min(1).max(20),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine((plan, context) => {
    const ids = plan.exercises.flatMap((exercise) => [
      exercise.id,
      ...exercise.sets.map((set) => set.id),
    ]);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Every exercise and set needs a different identifier.",
      });
    if (plan.exercises.reduce((n, exercise) => n + exercise.sets.length, 0) > 120)
      context.addIssue({ code: "custom", message: "A plan can contain up to 120 sets." });
  });
export const createPlanInput = workoutPlanContentInput.safeExtend({ id: workoutPlanId });
export const updatePlanInput = workoutPlanContentInput.safeExtend({
  expectedRevision: z.number().int().positive(),
});
export const attachPlanInput = z.strictObject({
  planId: workoutPlanId,
  expectedPlanRevision: z.number().int().positive(),
});
export const copySessionPlanInput = z.strictObject({
  id: workoutPlanId,
  expectedPlanId: workoutPlanId,
  expectedPlanRevision: z.number().int().positive(),
});
export const removeSessionPlanInput = z.strictObject({
  expectedPlanId: workoutPlanId,
  expectedPlanRevision: z.number().int().positive(),
});
export const startRunInput = z
  .strictObject({
    id: workoutPlanId,
    planId: workoutPlanId.optional(),
    expectedPlanId: workoutPlanId.optional(),
    expectedPlanRevision: z.number().int().positive().optional(),
    sessionId: z.string().min(1).max(200).optional(),
  })
  .refine(
    (input) =>
      input.sessionId
        ? input.planId === undefined &&
          input.expectedPlanId !== undefined &&
          input.expectedPlanRevision !== undefined
        : input.planId !== undefined &&
          input.expectedPlanId === undefined &&
          input.expectedPlanRevision !== undefined,
    "Choose a session or a library plan with its revision.",
  );
export const workoutSetResultInput = z
  .strictObject({
    exerciseId: workoutPlanId,
    setId: workoutPlanId,
    status: z.enum(["completed", "skipped"]),
    ...quantities,
  })
  .refine(
    (set) => (set.status === "skipped" ? !hasEffort(set) && set.weight === null : hasEffort(set)),
    "Enter an actual amount for completed sets; skipped sets have no actual amounts.",
  )
  .refine(
    (set) => set.unit !== "bodyweight" || set.weight === null,
    "Bodyweight uses no external load.",
  );
export const updateRunInput = z
  .strictObject({
    expectedRevision: z.number().int().positive(),
    results: z.array(workoutSetResultInput).max(120),
    note: z.string().trim().max(1000),
    shareAccountability: z.boolean(),
    finish: z.boolean(),
  })
  .refine(
    (input) => !input.finish || input.results.length > 0,
    "Record at least one set decision before finishing.",
  )
  .refine(
    (input) => new Set(input.results.map((set) => set.setId)).size === input.results.length,
    "A set can only have one result.",
  );
export const workoutPageInput = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(500).optional(),
});
export type WorkoutPageArgs = z.input<typeof workoutPageInput>;
