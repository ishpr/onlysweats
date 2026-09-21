import type { WorkoutRecord } from "./health.ts";

/** Private member-entered fitness data, separate from source measurements. */
export const EXERCISE_CATALOGUE = [
  { id: "bench_press", name: "Bench press" }, { id: "squat", name: "Squat" },
  { id: "deadlift", name: "Deadlift" }, { id: "row", name: "Row" },
  { id: "shoulder_press", name: "Shoulder press" }, { id: "pull_up", name: "Pull-up" },
  { id: "push_up", name: "Push-up" }, { id: "lunge", name: "Lunge" },
  { id: "biceps_curl", name: "Biceps curl" }, { id: "triceps_extension", name: "Triceps extension" },
  { id: "leg_press", name: "Leg press" }, { id: "lat_pulldown", name: "Lat pulldown" },
  { id: "other", name: "Other exercise" },
] as const;
export type ExerciseId = (typeof EXERCISE_CATALOGUE)[number]["id"];
export type WeightUnit = "kg" | "lb" | "bodyweight";
export type StrengthSet = { reps: number; weight: number | null; unit: WeightUnit };
export type StrengthLogInput = { startedAt: string; exerciseId: ExerciseId; note: string; sets: StrengthSet[] };
export type StrengthLog = StrengthLogInput & {
  id: string; revision: number; createdAt: string; updatedAt: string;
  totalRepetitions: number;
  /** External load only. Unknown for any bodyweight or unspecified-load set; never estimates body mass. */
  totalVolumeKg: number | null;
};
export type WorkoutCorrection = {
  workoutId: string; revision: number; title: string | null; note: string | null;
  activity: WorkoutRecord["activity"] | null; updatedAt: string;
};
export const FITNESS_AI_NOTICE_VERSION = "fitness-ai-v1" as const;
export const FITNESS_AI_CONSENT_NOTICE = "Allow SamePace to send the note you submit and, when requested, a summary of the selected workout to TypeSafe for editable exercise drafts and workout-note interpretation. This does not share your raw heart-rate samples, sleep, health history, or identity. Suggestions are not measurements or medical advice. Saving a draft and sharing a preference with another member remain your choices. You can turn this off at any time and saved AI interpretations will be removed.";
export type FitnessConsent = {
  enabled: boolean; generation: string | null; updatedAt: string | null;
  noticeVersion: typeof FITNESS_AI_NOTICE_VERSION; providerAvailable: boolean;
};
export type FitnessChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type FitnessAssessmentMetadata = {
  model: string; questionVersion: string; snapshotRevision: string; assessedAt: string;
  latencyMs: number; usage: { inputTokens: number; outputTokens: number };
  /** Distribution concentration is not proof of correctness or authorization. */
  answers: Record<string, FitnessChoiceAnswer>;
};
export type FitnessAssessmentStatus = "available" | "insufficient_data" | "provider_unavailable";
export type ExerciseDraft = {
  status: FitnessAssessmentStatus; exerciseId: ExerciseId | null;
  sets: number | null; reps: number | null; weight: number | null; unit: WeightUnit | null;
  missingFields: Array<"exercise" | "sets" | "reps" | "weight" | "unit">;
  metadata: FitnessAssessmentMetadata | null;
};
export type WorkoutAssessment = {
  workoutId: string; snapshotRevision: string; status: FitnessAssessmentStatus;
  interpretation: "goal_aligned" | "intentional_change" | "unclear" | null;
  metadata: FitnessAssessmentMetadata | null;
  /** Original member-authored context, included when retrieving a saved result. */
  request?: { goal: string; note: string };
};
export const WORKOUT_INTERPRETATION_LABELS = {
  goal_aligned: "Your note describes following your stated goal.",
  intentional_change: "Your note describes a deliberate change to your plan.",
  unclear: "There is not enough clear information to interpret this workout.",
} as const;
export type FitnessExportRecord =
  | { kind: "strength_log"; value: StrengthLog }
  | { kind: "workout_correction"; value: WorkoutCorrection }
  | { kind: "workout_assessment"; value: WorkoutAssessment & { request: { goal: string; note: string } } };
export type FitnessExportPage = { consent: FitnessConsent; records: FitnessExportRecord[]; nextCursor: string | null };
