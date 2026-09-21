import { View } from "react-native";
import { Card, Row, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { prescriptionLabel } from "@/lib/workout-plans/forms";
import type { WorkoutPlanContent } from "../../../../shared/workout-plans";

export function PlanPreview({
  plan,
  compact = false,
}: {
  plan: WorkoutPlanContent;
  compact?: boolean;
}) {
  return (
    <View style={{ gap: Spacing.two }}>
      {plan.instructions ? <T color="textSecondary">{plan.instructions}</T> : null}
      {plan.exercises.map((exercise, index) => (
        <Card key={exercise.id}>
          <Row>
            <T variant="eyebrow" color="accent">
              {String(index + 1).padStart(2, "0")}
            </T>
            <T variant="heading" style={{ flex: 1 }}>
              {exercise.name}
            </T>
          </Row>
          {exercise.instructions ? <T color="textSecondary">{exercise.instructions}</T> : null}
          {(compact ? exercise.sets.slice(0, 3) : exercise.sets).map((set, setIndex) => (
            <Row key={set.id}>
              <T variant="caption" color="textFaint" style={{ width: 42 }}>
                Set {setIndex + 1}
              </T>
              <T variant="label" style={{ flex: 1 }}>
                {prescriptionLabel(set)}
              </T>
              {set.restSeconds > 0 && (
                <T variant="caption" color="textSecondary">
                  {set.restSeconds}s rest
                </T>
              )}
            </Row>
          ))}
          {compact && exercise.sets.length > 3 && (
            <T variant="caption" color="textFaint">
              +{exercise.sets.length - 3} more sets
            </T>
          )}
        </Card>
      ))}
    </View>
  );
}
