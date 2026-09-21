import { ListChecks } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Button, Card, Row, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ACTIVITIES } from "@/lib/types";
import type { AIWorkoutPlanDraft } from "../../../../shared/workout-plans";
import { summarizeAIWorkoutPlan } from "../../../../shared/workout-plan-summary";

function target(exercise: AIWorkoutPlanDraft["exercises"][number]) {
  return [
    exercise.reps === null ? null : `${exercise.reps} reps`,
    exercise.durationSeconds === null
      ? null
      : exercise.durationSeconds % 60 === 0
        ? `${exercise.durationSeconds / 60} min`
        : `${exercise.durationSeconds} sec`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The validated prescription is actionable data; prose is never parsed into activity. */
export function WorkoutPlanDraftCard({
  draft,
  onReview,
  busy = false,
}: {
  draft: AIWorkoutPlanDraft;
  onReview: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  const summary = summarizeAIWorkoutPlan(draft);
  return (
    <Card>
      <Row>
        <ListChecks size={19} color={theme.accent} />
        <T variant="eyebrow" color="accent">
          Your workout draft
        </T>
      </Row>
      <T variant="heading">{draft.title}</T>
      <T variant="caption" color="textSecondary">
        {ACTIVITIES[draft.activity].label} · {draft.exercises.length}{" "}
        {draft.exercises.length === 1 ? "exercise" : "exercises"} · {summary.totalSetCount}{" "}
        {summary.totalSetCount === 1 ? "set" : "sets"}
      </T>
      <View style={styles.exercises}>
        {draft.exercises.slice(0, 4).map((exercise, index) => (
          <Row key={`${index}-${exercise.name}`} style={styles.exercise}>
            <T variant="caption" color="textFaint" style={styles.number}>
              {index + 1}
            </T>
            <View style={styles.flex}>
              <T variant="label">{exercise.name}</T>
              <T variant="caption" color="textSecondary">
                {exercise.sets} {exercise.sets === 1 ? "set" : "sets"} × {target(exercise)}
                {exercise.restSeconds > 0 ? ` · ${exercise.restSeconds}s rest` : ""}
              </T>
            </View>
          </Row>
        ))}
        {draft.exercises.length > 4 && (
          <T variant="caption" color="textSecondary">
            +{draft.exercises.length - 4} more in the plan
          </T>
        )}
      </View>
      <Button label="Review & start" onPress={onReview} disabled={busy} />
      <T variant="caption" color="textFaint">
        Review first. Then time your workout and check off sets.
      </T>
    </Card>
  );
}

const styles = StyleSheet.create({
  exercises: { gap: Spacing.two },
  exercise: { alignItems: "flex-start" },
  number: { width: 18, paddingTop: 1 },
  flex: { flex: 1, minWidth: 0 },
});
