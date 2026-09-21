import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { ClipboardList } from "lucide-react-native";
import { ActionCard } from "@/components/assistant-kit";
import { Spacing } from "@/constants/theme";
import { Button, Card, Chip, Field, Notice, Row, T } from "@/components/ui";
import { storeFitnessDraft } from "@/lib/assistant/draft-handoff";
import { storeWorkoutPlanDraft } from "@/lib/workout-plans/draft-handoff";
import type { ApiSession } from "@/lib/api";
import type { WeightUnit } from "../../../../shared/fitness";

export type ReviewableWorkoutDraft = {
  source: "text" | "photo";
  sourceText: string;
  title: string | null;
  intent: "planned" | "completed" | "unclear";
  note: string;
  exercises: {
    name: string;
    sets: number | null;
    reps: number | null;
    weight: number | null;
    unit: WeightUnit | null;
  }[];
};
type Fields = { name: string; sets: string; reps: string; weight: string; unit: WeightUnit | null };
function draftNumber(text: string, max: number, whole: boolean, label: string) {
  if (!text.trim()) return null;
  const value = Number(text);
  if (
    !Number.isFinite(value) ||
    value < (whole ? 1 : 0) ||
    value > max ||
    (whole && !Number.isInteger(value))
  )
    throw new Error(`Check ${label} before continuing.`);
  return value;
}
export function DraftReview({
  draft,
  ownerId,
  session,
  onDismiss,
}: {
  draft: ReviewableWorkoutDraft;
  ownerId: string;
  session: ApiSession;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState(draft.note.slice(0, 1000));
  const [error, setError] = useState<string | null>(null);
  const [sourceVisible, setSourceVisible] = useState(false);
  const [exercises, setExercises] = useState<Fields[]>(() =>
    draft.exercises.slice(0, 12).map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets?.toString() ?? "",
      reps: exercise.reps?.toString() ?? "",
      weight: exercise.weight?.toString() ?? "",
      unit: exercise.unit,
    })),
  );
  const update = (index: number, patch: Partial<Fields>) =>
    setExercises((all) => all.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const review = (exercise: Fields) => {
    try {
      if (!session.isCurrent()) return;
      if (!exercise.name.trim()) throw new Error("Enter the exercise name first.");
      const id = Crypto.randomUUID();
      storeFitnessDraft(
        id,
        ownerId,
        {
          source: draft.source,
          intent: draft.intent,
          exerciseName: exercise.name.trim(),
          note: `${exercise.name.trim()}${note.trim() ? ` · ${note.trim()}` : ""}`.slice(0, 1000),
          sets: draftNumber(exercise.sets, 50, true, "the number of sets"),
          reps: draftNumber(exercise.reps, 1000, true, "the repetitions"),
          weight:
            exercise.unit === "bodyweight"
              ? null
              : draftNumber(exercise.weight, 2000, false, "the weight"),
          unit: exercise.unit,
        },
        session.isCurrent,
      );
      router.push({ pathname: "/fitness", params: { draftId: id } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Check the draft and try again.");
    }
  };
  const reviewPlan = () => {
    try {
      if (!session.isCurrent()) return;
      const id = Crypto.randomUUID();
      const items = exercises.map((exercise) => {
        if (!exercise.name.trim()) throw new Error("Enter each exercise name first.");
        return {
          name: exercise.name.trim(),
          sets: draftNumber(exercise.sets, 20, true, "sets (up to 20 per exercise)"),
          reps: draftNumber(exercise.reps, 1000, true, "the repetitions"),
          weight:
            exercise.unit === "bodyweight"
              ? null
              : draftNumber(exercise.weight, 2000, false, "the weight"),
          unit: exercise.unit,
        };
      });
      if (items.reduce((sum, item) => sum + (item.sets ?? 1), 0) > 120)
        throw new Error("Use at most 120 planned sets. Review the set counts before continuing.");
      storeWorkoutPlanDraft(
        id,
        ownerId,
        { title: draft.title, note, exercises: items },
        session.isCurrent,
      );
      router.push({ pathname: "/workout-plan/new", params: { draftId: id } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Check the plan and try again.");
    }
  };
  return (
    <Card>
      <T variant="heading">Review your draft</T>
      <Notice>
        {draft.intent === "planned"
          ? "This appears to be a workout plan."
          : draft.intent === "completed"
            ? "This appears to describe a completed workout."
            : "It is unclear whether this workout was completed."}{" "}
        Check each field. Nothing has been saved or recorded as activity.
      </Notice>
      {draft.title ? <T variant="label">{draft.title}</T> : null}
      <Button
        label={sourceVisible ? "Hide source text" : "Compare with source text"}
        variant="ghost"
        onPress={() => setSourceVisible((value) => !value)}
      />
      {sourceVisible && (
        <T selectable color="textSecondary">
          {draft.sourceText || "No source text was found."}
        </T>
      )}
      <Field
        label="Your workout note"
        value={note}
        onChangeText={setNote}
        maxLength={1000}
        multiline
      />
      {exercises.length > 0 && (
        <ActionCard
          icon={ClipboardList}
          title="Keep the whole workout together"
          note="Review all exercises, add instructions and rest, then save a reusable plan. You can share it with buddies through a session."
          primary={{ label: "Review as a workout plan", onPress: reviewPlan }}
        />
      )}
      {exercises.map((exercise, index) => (
        <View key={index} style={{ gap: Spacing.two }}>
          <T variant="label">Exercise {index + 1}</T>
          <Field
            label="Exercise name"
            value={exercise.name}
            maxLength={100}
            onChangeText={(name) => update(index, { name })}
          />
          <Field
            label="Number of sets (leave blank if unknown)"
            value={exercise.sets}
            keyboardType="number-pad"
            onChangeText={(sets) => update(index, { sets })}
          />
          <Field
            label="Reps per set (leave blank if unknown)"
            value={exercise.reps}
            keyboardType="number-pad"
            onChangeText={(reps) => update(index, { reps })}
          />
          <Row style={{ flexWrap: "wrap" }}>
            {(["kg", "lb", "bodyweight"] as const).map((unit) => (
              <Chip
                key={unit}
                label={unit === "bodyweight" ? "Bodyweight" : unit}
                selected={exercise.unit === unit}
                onPress={() => update(index, { unit })}
              />
            ))}
          </Row>
          {exercise.unit !== "bodyweight" && (
            <Field
              label="Weight (leave blank if unknown)"
              value={exercise.weight}
              keyboardType="decimal-pad"
              onChangeText={(weight) => update(index, { weight })}
            />
          )}
          <ActionCard
            icon={ClipboardList}
            title={exercise.name || `Exercise ${index + 1}`}
            facts={[
              ...(exercise.sets.trim() ? [`${exercise.sets} sets`] : []),
              ...(exercise.reps.trim() ? [`${exercise.reps} reps per set`] : []),
            ]}
            note="Review individual sets and confirm completion in your fitness log before saving."
            primary={{ label: "Review in fitness log", onPress: () => review(exercise) }}
          />
        </View>
      ))}
      {exercises.length === 0 && (
        <Notice>
          No strength exercise was identified. You can enter an exercise by hand or review recorded
          activity in Apple Health.
        </Notice>
      )}
      {exercises.length < 12 && (
        <Button
          label="Add an exercise by hand"
          variant="soft"
          onPress={() =>
            setExercises((items) => [
              ...items,
              { name: "", sets: "", reps: "", weight: "", unit: null },
            ])
          }
        />
      )}
      {Boolean(error) && <Notice tone="danger">{error}</Notice>}
      <T variant="caption" color="textSecondary">
        The fitness editor lets you check individual sets, confirm completion and enter the time
        before saving a private log.
      </T>
      <Button label="Discard draft" variant="ghost" onPress={onDismiss} />
    </Card>
  );
}
