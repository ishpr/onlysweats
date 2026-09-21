import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalCapability } from "@/components/assistant-chat/local-chat";
import { Button, Card, Field, Notice, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import type { ApiSession } from "@/lib/api";
import { createAssistantRun } from "@/lib/assistant/run";
import { draftWorkoutPlan, intelligenceReason, LOCAL_PLAN_NOTICE } from "@/lib/intelligence";
import type { AIWorkoutPlanDraft } from "../../../../shared/workout-plans";
import { summarizeAIWorkoutPlan } from "../../../../shared/workout-plan-summary";
import { PlanTimingSummary } from "./plan-timing-summary";

export function AIDraftPlan({
  session,
  disabled,
  onUse,
}: {
  session: ApiSession;
  disabled: boolean;
  onUse: (draft: AIWorkoutPlanDraft) => void;
}) {
  const { capability, refresh } = useLocalCapability(session);
  const runner = useMemo(() => createAssistantRun(session.isCurrent), [session]);
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIWorkoutPlanDraft | null>(null);
  useEffect(() => () => runner.cancel(), [runner]);
  return (
    <Card>
      <T variant="heading">Start with an AI draft</T>
      <T color="textSecondary">
        Describe the equipment, time and type of workout you want. Review the exercises and
        instructions before saving.
      </T>
      {!expanded ? (
        <Button
          label="Draft on this iPhone"
          variant="soft"
          disabled={disabled}
          onPress={() => setExpanded(true)}
        />
      ) : (
        <View style={{ gap: Spacing.two }}>
          <T variant="caption" color="textSecondary">
            {LOCAL_PLAN_NOTICE}
          </T>
          {capability && (!capability.available || !capability.planDrafting) && (
            <>
              <Notice>
                {!capability.planDrafting
                  ? "Install the newer iPhone build to draft plans on-device, or enter your plan below."
                  : intelligenceReason(capability.reason)}
              </Notice>
              <Button label="Check on-device availability" variant="ghost" onPress={refresh} />
            </>
          )}
          <Field
            label="Your workout request"
            value={prompt}
            onChangeText={setPrompt}
            maxLength={1000}
            multiline
            editable={!busy && !disabled}
            placeholder="A 30-minute beginner dumbbell workout for two people, taking turns. Include easy substitutions and instructions."
          />
          <Button
            label="Suggest a workout plan"
            loading={busy}
            disabled={
              disabled || !capability?.available || !capability.planDrafting || !prompt.trim()
            }
            onPress={() => {
              if (runner.busy || !session.isCurrent()) return;
              setBusy(true);
              setError(null);
              setDraft(null);
              void runner.start(
                async (signal, publish) => {
                  publish(await draftWorkoutPlan(prompt.trim(), { signal }));
                },
                (result: Awaited<ReturnType<typeof draftWorkoutPlan>>) => {
                  if (result.status === "available") setDraft(result.draft);
                  else setError(intelligenceReason(result.reason));
                },
                () => setError("The draft did not finish. You can retry or keep editing below."),
                () => setBusy(false),
              );
            }}
          />
          {busy && (
            <Button
              label="Cancel draft"
              variant="ghost"
              onPress={() => {
                runner.cancel();
                setBusy(false);
              }}
            />
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {draft && (
            <>
              <T variant="eyebrow" color="textSecondary">
                AI suggestion · Review required
              </T>
              <T variant="heading">{draft.title}</T>
              <PlanTimingSummary summary={summarizeAIWorkoutPlan(draft)} />
              <T variant="caption" color="textSecondary">
                Check that every phase and time you asked for is included.
              </T>
              <T color="textSecondary">{draft.instructions}</T>
              {draft.exercises.map((exercise, index) => (
                <View key={index} style={{ gap: Spacing.half }}>
                  <T variant="label">
                    {index + 1}. {exercise.name} · {exercise.sets} sets
                  </T>
                  <T variant="caption" color="textSecondary">
                    {[
                      exercise.reps !== null ? `${exercise.reps} reps` : null,
                      exercise.durationSeconds !== null ? `${exercise.durationSeconds}s` : null,
                      `${exercise.restSeconds}s rest`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </T>
                  <T variant="caption">{exercise.instructions}</T>
                </View>
              ))}
              <Notice>
                Using this draft replaces the fields below. It remains an unsaved suggestion until
                you review and save it.
              </Notice>
              <Button
                label="Use this draft in the editor"
                variant="soft"
                disabled={disabled}
                onPress={() => {
                  onUse(draft);
                  setDraft(null);
                  setExpanded(false);
                }}
              />
              <Button label="Discard AI draft" variant="ghost" onPress={() => setDraft(null)} />
            </>
          )}
        </View>
      )}
    </Card>
  );
}
