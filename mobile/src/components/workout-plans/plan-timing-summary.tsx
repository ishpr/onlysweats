import { View } from "react-native";
import { T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import type { WorkoutPlanSummary } from "../../../../shared/workout-plan-summary";

function plannedTime(seconds: number) {
  if (seconds > 0 && seconds < 0.01) return "<0.01 sec";
  const rounded = Math.round(seconds * 100) / 100;
  const minutes = Math.floor(rounded / 60);
  const remainder = Math.round((rounded % 60) * 100) / 100;
  if (remainder === 0 && minutes > 0) return `${minutes} min`;
  return `${minutes > 0 ? `${minutes} min ` : ""}${remainder} sec`;
}

export function PlanTimingSummary({ summary }: { summary: WorkoutPlanSummary }) {
  return (
    <View style={{ gap: Spacing.half }}>
      <T variant="label">
        {summary.totalSetCount} planned {summary.totalSetCount === 1 ? "set" : "sets"}
      </T>
      <T variant="caption" color="textSecondary">
        Timed targets:{" "}
        {summary.timedTargetSeconds > 0
          ? plannedTime(summary.timedTargetSeconds)
          : "None specified"}{" "}
        · Planned rest: {plannedTime(summary.plannedRestSeconds)}
      </T>
      <T variant="caption" color="textFaint">
        {summary.hasUntimedSets
          ? "These sums exclude untimed sets and time described only in instructions."
          : "These sums exclude time described only in instructions."}
      </T>
    </View>
  );
}
