import { z } from "zod";
import { EXERCISE_CATALOGUE } from "../../../shared/fitness.ts";

export class FitnessError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = "FitnessError"; this.status = status; }
}
export const fitnessId = z.uuid().transform((value) => value.toLowerCase());
export const consentInput = z.strictObject({ enabled: z.boolean() });
export const noteInput = z.strictObject({ note: z.string().trim().min(1).max(1000) });
export const assessmentInput = z.strictObject({ goal: z.string().trim().min(1).max(300), note: z.string().trim().max(1000) });
export const strengthSet = z.strictObject({
  reps: z.number().int().min(1).max(1000), weight: z.number().min(0).max(2000).nullable(),
  unit: z.enum(["kg", "lb", "bodyweight"]),
}).refine((set) => set.unit !== "bodyweight" || set.weight === null,
  { message: "Bodyweight uses no external weight." });
export const strengthLogInput = z.strictObject({
  startedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
  exerciseId: z.enum(EXERCISE_CATALOGUE.map((exercise) => exercise.id)),
  note: z.string().trim().max(1000), sets: z.array(strengthSet).min(1).max(50),
}).refine((log) => log.exerciseId !== "other" || log.note.length > 0, { message: "Name the other exercise in your note." });
export const updateStrengthLogInput = strengthLogInput.safeExtend({ expectedRevision: z.number().int().positive() });
export const correctionInput = z.strictObject({
  expectedRevision: z.number().int().min(0), title: z.string().trim().min(1).max(100).nullable(),
  note: z.string().trim().max(1000).nullable(),
  activity: z.enum(["run", "walk", "ride", "hike", "strength", "mobility", "other"]).nullable(),
});
export const fitnessPageInput = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).max(1000).optional(),
});
export type FitnessPageArgs = z.infer<typeof fitnessPageInput>;
