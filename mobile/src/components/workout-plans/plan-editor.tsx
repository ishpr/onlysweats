import { useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { Button, Card, Chip, Field, Notice, Row, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { ACTIVITIES } from "@/lib/types";
import { emptySetFields, planContent, type PlanFields } from "@/lib/workout-plans/forms";
import type { WorkoutPlanContent } from "../../../../shared/workout-plans";
import { summarizeWorkoutPlan } from "../../../../shared/workout-plan-summary";
import { PlanTimingSummary } from "./plan-timing-summary";
import { SetFields } from "./set-fields";

function currentSummary(value: PlanFields) {
  try {
    return summarizeWorkoutPlan(planContent(value));
  } catch {
    return null;
  }
}

export function blankPlan(): PlanFields {
  return {
    title: "",
    activity: "strength",
    instructions: "",
    exercises: [
      {
        id: Crypto.randomUUID(),
        name: "",
        instructions: "",
        sets: [{ id: Crypto.randomUUID(), ...emptySetFields() }],
      },
    ],
  };
}

export function PlanEditor({
  value,
  onChange,
  busy,
  onSave,
  onCancel,
  reviewSuggested = false,
}: {
  value: PlanFields;
  onChange: (value: PlanFields) => void;
  busy: boolean;
  onSave: (plan: WorkoutPlanContent) => void;
  onCancel?: () => void;
  reviewSuggested?: boolean;
}) {
  const [active, setActive] = useState<string | null>(() => value.exercises[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const totalSets = value.exercises.reduce((count, exercise) => count + exercise.sets.length, 0);
  const summary = currentSummary(value);
  const changeExercise = (id: string, patch: Partial<PlanFields["exercises"][number]>) =>
    onChange({
      ...value,
      exercises: value.exercises.map((exercise) =>
        exercise.id === id ? { ...exercise, ...patch } : exercise,
      ),
    });
  return (
    <View style={{ gap: Spacing.three }}>
      <Card>
        <Field
          label="Workout name"
          value={value.title}
          onChangeText={(title) => onChange({ ...value, title })}
          maxLength={120}
          editable={!busy}
          placeholder="Saturday strength together"
        />
        <Row style={{ flexWrap: "wrap" }}>
          {(Object.keys(ACTIVITIES) as (keyof typeof ACTIVITIES)[]).map((activity) => (
            <Chip
              key={activity}
              label={ACTIVITIES[activity].label}
              selected={value.activity === activity}
              onPress={() => onChange({ ...value, activity })}
              disabled={busy}
            />
          ))}
        </Row>
        <Field
          label="Workout instructions"
          value={value.instructions}
          onChangeText={(instructions) => onChange({ ...value, instructions })}
          multiline
          maxLength={2000}
          editable={!busy}
          placeholder="How to warm up, take turns and adapt this workout."
        />
        <T variant="caption" color="textSecondary">
          These are planned targets. Each person records their own actual sets when they train.
        </T>
      </Card>
      {value.exercises.map((exercise, index) => (
        <Card key={exercise.id}>
          <Row>
            <T variant="eyebrow" color="accent">
              {String(index + 1).padStart(2, "0")}
            </T>
            <T variant="heading" style={{ flex: 1 }}>
              {exercise.name || "New exercise"}
            </T>
          </Row>
          <T variant="caption" color="textSecondary">
            {exercise.sets.length} {exercise.sets.length === 1 ? "set" : "sets"}
          </T>
          {active !== exercise.id ? (
            <Button
              label={`Edit ${exercise.name || `exercise ${index + 1}`}`}
              variant="soft"
              disabled={busy}
              onPress={() => setActive(exercise.id)}
            />
          ) : (
            <>
              <Field
                label="Exercise name"
                value={exercise.name}
                onChangeText={(name) => changeExercise(exercise.id, { name })}
                maxLength={100}
                editable={!busy}
                placeholder="Squat, easy run, mobility…"
              />
              <Field
                label="Exercise instructions"
                value={exercise.instructions}
                onChangeText={(instructions) => changeExercise(exercise.id, { instructions })}
                multiline
                maxLength={1000}
                editable={!busy}
                placeholder="Setup, movement cues and options for your buddy."
              />
              {exercise.sets.map((set, setIndex) => (
                <View key={set.id} style={{ gap: Spacing.two }}>
                  <T variant="label">Set {setIndex + 1}</T>
                  <SetFields
                    value={set}
                    disabled={busy}
                    onChange={(patch) =>
                      changeExercise(exercise.id, {
                        sets: exercise.sets.map((current) =>
                          current.id === set.id ? { ...current, ...patch } : current,
                        ),
                      })
                    }
                  />
                  {exercise.sets.length > 1 && (
                    <Button
                      label={`Remove set ${setIndex + 1}`}
                      variant="ghost"
                      disabled={busy}
                      onPress={() =>
                        changeExercise(exercise.id, {
                          sets: exercise.sets.filter((current) => current.id !== set.id),
                        })
                      }
                    />
                  )}
                </View>
              ))}
              <Button
                label="Add another set"
                variant="soft"
                disabled={busy || exercise.sets.length >= 20 || totalSets >= 120}
                onPress={() =>
                  changeExercise(exercise.id, {
                    sets: [
                      ...exercise.sets,
                      { ...(exercise.sets.at(-1) ?? emptySetFields()), id: Crypto.randomUUID() },
                    ],
                  })
                }
              />
              <Row>
                <Button
                  label="Move up"
                  variant="ghost"
                  disabled={busy || index === 0}
                  onPress={() => {
                    const exercises = [...value.exercises];
                    [exercises[index - 1], exercises[index]] = [
                      exercises[index],
                      exercises[index - 1],
                    ];
                    onChange({ ...value, exercises });
                  }}
                />
                <Button
                  label="Move down"
                  variant="ghost"
                  disabled={busy || index === value.exercises.length - 1}
                  onPress={() => {
                    const exercises = [...value.exercises];
                    [exercises[index + 1], exercises[index]] = [
                      exercises[index],
                      exercises[index + 1],
                    ];
                    onChange({ ...value, exercises });
                  }}
                />
              </Row>
              {value.exercises.length > 1 && (
                <Button
                  label="Remove exercise"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => {
                    onChange({
                      ...value,
                      exercises: value.exercises.filter((current) => current.id !== exercise.id),
                    });
                    setActive(null);
                  }}
                />
              )}
              <Button label="Collapse exercise" variant="ghost" onPress={() => setActive(null)} />
            </>
          )}
        </Card>
      ))}
      <Button
        label="Add exercise"
        variant="soft"
        disabled={busy || value.exercises.length >= 12 || totalSets >= 120}
        onPress={() => {
          const exercise = {
            id: Crypto.randomUUID(),
            name: "",
            instructions: "",
            sets: [{ id: Crypto.randomUUID(), ...emptySetFields() }],
          };
          onChange({ ...value, exercises: [...value.exercises, exercise] });
          setActive(exercise.id);
        }}
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <Card>
        <T variant="heading">Review your plan</T>
        {summary ? (
          <PlanTimingSummary summary={summary} />
        ) : (
          <T variant="caption" color="textSecondary">
            Complete the plan fields with valid targets to see the set and timing summary. Missing
            targets are not estimated.
          </T>
        )}
        {reviewSuggested && (
          <T variant="caption" color="textSecondary">
            Check that every phase and time you asked for is included before saving this suggestion.
          </T>
        )}
      </Card>
      <Button
        label="Save private workout plan"
        loading={busy}
        onPress={() => {
          try {
            const content = planContent(value);
            setError(null);
            onSave(content);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Check the workout fields and try again.",
            );
          }
        }}
      />
      {onCancel && (
        <Button label="Discard edits" variant="ghost" disabled={busy} onPress={onCancel} />
      )}
    </View>
  );
}
