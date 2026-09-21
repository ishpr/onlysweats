import type { ApiSession } from "../api.ts";
import type {
  WorkoutPlan,
  WorkoutPlanContent,
  WorkoutRun,
} from "../../../../shared/workout-plans.ts";

export type WorkoutSubmission = {
  planId: string;
  runId: string;
  content: WorkoutPlanContent;
  start: boolean;
};

/** Keep this receipt until both replies arrive, including after a lost response. */
export function workoutSubmission(
  planId: string,
  runId: string,
  content: WorkoutPlanContent,
  start: boolean,
): WorkoutSubmission {
  return {
    planId,
    runId,
    start,
    content: {
      ...content,
      exercises: content.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => ({ ...set })),
      })),
    },
  };
}

export async function submitWorkout(
  submission: WorkoutSubmission,
  session: Pick<ApiSession, "request" | "isCurrent">,
  signal: AbortSignal,
): Promise<{ plan: WorkoutPlan; run: WorkoutRun | null }> {
  const ensureCurrent = () => {
    if (signal.aborted || !session.isCurrent())
      throw new Error("Your session changed. Reopen your workout plans to continue.");
  };
  ensureCurrent();
  const { plan } = await session.request<{ plan: WorkoutPlan }>("/fitness/plans", {
    method: "POST",
    json: { id: submission.planId, ...submission.content },
    signal,
  });
  ensureCurrent();
  if (!submission.start) return { plan, run: null };
  const { run } = await session.request<{ run: WorkoutRun }>("/fitness/runs", {
    method: "POST",
    json: {
      id: submission.runId,
      planId: plan.id,
      expectedPlanRevision: plan.revision,
    },
    signal,
  });
  ensureCurrent();
  return { plan, run };
}
