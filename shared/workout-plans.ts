import type { Activity } from "../src/lib/pace/types.ts";
import type { WeightUnit } from "./fitness.ts";

/** Prescriptions are suggestions, never observations or proof of completion. */
export type PlannedSet = {
  id: string;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  weight: number | null;
  unit: WeightUnit;
  restSeconds: number;
};
export type PlannedExercise = {
  id: string;
  name: string;
  instructions: string;
  sets: PlannedSet[];
};
export type WorkoutPlanContent = {
  title: string;
  activity: Activity;
  instructions: string;
  exercises: PlannedExercise[];
};
export type WorkoutPlan = WorkoutPlanContent & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type CreateWorkoutPlanInput = WorkoutPlanContent & { id: string };
export type UpdateWorkoutPlanInput = WorkoutPlanContent & { expectedRevision: number };
export type SessionWorkoutPlan = {
  sessionId: string;
  planId: string;
  planRevision: number;
  snapshot: WorkoutPlanContent;
  attachedAt: string;
};
export type WorkoutSetResult = {
  exerciseId: string;
  setId: string;
  status: "completed" | "skipped";
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  weight: number | null;
  unit: WeightUnit;
};
export type WorkoutRun = {
  id: string;
  revision: number;
  planId: string | null;
  planRevision: number;
  sessionId: string | null;
  snapshot: WorkoutPlanContent;
  status: "in_progress" | "completed";
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
  results: WorkoutSetResult[];
  note: string;
  shareAccountability: boolean;
};
export type StartWorkoutRunInput = {
  id: string;
  planId?: string;
  /** The exact frozen session plan the member reviewed before starting. */
  expectedPlanId?: string;
  expectedPlanRevision?: number;
  sessionId?: string;
};
export type UpdateWorkoutRunInput = {
  expectedRevision: number;
  /** Keep the same ID and payload until the server acknowledges a retry. */
  mutationId?: string;
  results: WorkoutSetResult[];
  note: string;
  shareAccountability: boolean;
  finish: boolean;
};
/** Explicitly shared attendance-style progress; never load, reps, notes or health. */
export type WorkoutAccountability = {
  userId: string;
  name: string;
  status: WorkoutRun["status"];
  completedSets: number;
  skippedSets: number;
  plannedSets: number;
  updatedAt: string;
};
export type WorkoutPlanPage = { plans: WorkoutPlan[]; nextCursor: string | null };
export type WorkoutRunPage = { runs: WorkoutRun[]; nextCursor: string | null };
export type SessionWorkoutPlanView = {
  plan: SessionWorkoutPlan | null;
  accountability: WorkoutAccountability[];
  myRun: WorkoutRun | null;
  canAttach: boolean;
};

/** Editable, unsaved output. UUIDs are assigned by application code after validation. */
export type AIWorkoutPlanDraft = {
  title: string;
  activity: Activity;
  instructions: string;
  exercises: Array<{
    name: string;
    instructions: string;
    sets: number;
    reps: number | null;
    durationSeconds: number | null;
    restSeconds: number;
  }>;
};
