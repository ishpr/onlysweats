import type { AIWorkoutPlanDraft, WorkoutPlanContent } from "./workout-plans.ts";

export type WorkoutPlanSummary = {
  totalSetCount: number;
  timedTargetSeconds: number;
  plannedRestSeconds: number;
  hasUntimedSets: boolean;
};

type TargetGroup = { count: number; durationSeconds: number | null; restSeconds: number };

/** Add explicit prescriptions only. Reps, distance and prose never become estimated minutes. */
function summarize(groups: TargetGroup[]): WorkoutPlanSummary {
  return groups.reduce<WorkoutPlanSummary>(
    (summary, group) => ({
      totalSetCount: summary.totalSetCount + group.count,
      timedTargetSeconds:
        summary.timedTargetSeconds +
        (group.durationSeconds === null ? 0 : group.durationSeconds * group.count),
      plannedRestSeconds: summary.plannedRestSeconds + group.restSeconds * group.count,
      hasUntimedSets: summary.hasUntimedSets || group.durationSeconds === null,
    }),
    { totalSetCount: 0, timedTargetSeconds: 0, plannedRestSeconds: 0, hasUntimedSets: false },
  );
}

export function summarizeWorkoutPlan(
  plan: Pick<WorkoutPlanContent, "exercises">,
): WorkoutPlanSummary {
  return summarize(
    plan.exercises.flatMap((exercise) =>
      exercise.sets.map((set) => ({
        count: 1,
        durationSeconds: set.durationSeconds,
        restSeconds: set.restSeconds,
      })),
    ),
  );
}

export function summarizeAIWorkoutPlan(
  draft: Pick<AIWorkoutPlanDraft, "exercises">,
): WorkoutPlanSummary {
  return summarize(
    draft.exercises.map((exercise) => ({
      count: exercise.sets,
      durationSeconds: exercise.durationSeconds,
      restSeconds: exercise.restSeconds,
    })),
  );
}
