import { z } from "zod";

/** Freeform authoring only; health measurements and execution fields are excluded. */
export const workoutPlanDraftInput = z
  .strictObject({
    title: z.string().trim().min(1).max(120),
    activity: z.enum(["run", "walk", "hike", "ride", "strength", "mobility"]),
    instructions: z.string().trim().max(1000),
    exercises: z
      .array(
        z
          .strictObject({
            name: z.string().trim().min(1).max(100),
            instructions: z.string().trim().max(500),
            sets: z.number().int().min(1).max(20),
            reps: z.number().int().min(1).max(1000).nullable(),
            durationSeconds: z.number().int().min(1).max(86400).nullable(),
            restSeconds: z.number().int().min(0).max(3600),
          })
          .refine(
            (e) => e.reps !== null || e.durationSeconds !== null,
            "Give a rep or time target.",
          ),
      )
      .min(1)
      .max(12),
  })
  .refine((p) => p.exercises.reduce((sum, e) => sum + e.sets, 0) <= 120, "Use at most 120 sets.");

/** Model-facing units stay explicit; arithmetic and the public shape belong to code. */
export const workoutPlanModelInput = z.strictObject({
  title: z.string().trim().min(1).max(120),
  activity: z.enum(["run", "walk", "hike", "ride", "strength", "mobility"]),
  // Distinct top-level name avoids ambiguous nested tool serialization in GLM.
  overview: z.string().trim().max(1000),
  exercises: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(100),
        instructions: z.string().trim().max(500),
        sets: z.number().int().min(1).max(20),
        targetUnit: z.enum(["repetitions", "seconds", "minutes"]),
        targetAmount: z.number().int().min(1).max(86400),
        restSeconds: z.number().int().min(0).max(3600),
      }),
    )
    .min(1)
    .max(12),
});
export function normalizeWorkoutPlanModelDraft(input: z.infer<typeof workoutPlanModelInput>) {
  const draft = workoutPlanModelInput.parse(input);
  return workoutPlanDraftInput.parse({
    title: draft.title,
    activity: draft.activity,
    instructions: draft.overview,
    exercises: draft.exercises.map((exercise) => ({
      name: exercise.name,
      instructions: exercise.instructions,
      sets: exercise.sets,
      reps: exercise.targetUnit === "repetitions" ? exercise.targetAmount : null,
      durationSeconds:
        exercise.targetUnit === "repetitions"
          ? null
          : exercise.targetAmount * (exercise.targetUnit === "minutes" ? 60 : 1),
      restSeconds: exercise.restSeconds,
    })),
  });
}
