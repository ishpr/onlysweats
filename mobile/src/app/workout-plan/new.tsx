import { useState } from "react";
import * as Crypto from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Notice, Screen, T } from "@/components/ui";
import { AIDraftPlan } from "@/components/workout-plans/ai-draft";
import { blankPlan, PlanEditor } from "@/components/workout-plans/plan-editor";
import { PlanPreview } from "@/components/workout-plans/plan-preview";
import { usePrivateAction } from "@/hooks/use-private-action";
import { planContentFromAIDraft } from "@/lib/intelligence";
import {
  submitWorkout,
  workoutSubmission,
  type WorkoutSubmission,
} from "@/lib/workout-plans/create-workout";
import { takeWorkoutEditorDraft } from "@/lib/workout-plans/draft-handoff";
import { fieldsFromImportedDraft, planContent, planFields } from "@/lib/workout-plans/forms";
import type { WorkoutPlanContent } from "../../../../shared/workout-plans";

export default function NewWorkoutPlanRoute() {
  return <PrivateMember component={NewWorkoutPlan} />;
}
function NewWorkoutPlan({ member, session }: PrivateMemberProps) {
  const { draftId, sessionId } = useLocalSearchParams<{ draftId?: string; sessionId?: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [id] = useState(Crypto.randomUUID);
  const [runId] = useState(Crypto.randomUUID);
  const [imported] = useState(() =>
    typeof draftId === "string" ? takeWorkoutEditorDraft(draftId, member.id) : null,
  );
  const [starting] = useState(() => {
    try {
      return {
        value: imported
          ? imported.kind === "generated"
            ? planFields(planContentFromAIDraft(imported.draft, Crypto.randomUUID))
            : fieldsFromImportedDraft(imported.draft, Crypto.randomUUID)
          : blankPlan(),
        error: null,
      };
    } catch (failure) {
      return {
        value: blankPlan(),
        error:
          failure instanceof Error
            ? failure.message
            : "This draft could not be imported. Review the original before continuing.",
      };
    }
  });
  const [value, setValue] = useState(starting.value);
  const [version, setVersion] = useState(0);
  const [reviewSuggested, setReviewSuggested] = useState(imported !== null);
  const [review, setReview] = useState<WorkoutPlanContent | null>(() => {
    if (!imported || starting.error) return null;
    try {
      return planContent(starting.value);
    } catch {
      // Extracted notes may lack targets; the editor keeps those fields blank for review.
      return null;
    }
  });
  const [submission, setSubmission] = useState<WorkoutSubmission | null>(null);
  const submit = (start: boolean) => {
    if (!review) return;
    const receipt = submission ?? workoutSubmission(id, runId, review, start);
    setSubmission(receipt);
    void action.run(
      (signal) => submitWorkout(receipt, session, signal),
      async ({ plan, run }) => {
        await Promise.all([
          client.invalidateQueries({ queryKey: ["private-workout-plans", member.id] }),
          ...(run
            ? [client.invalidateQueries({ queryKey: ["private-workout-runs", member.id] })]
            : []),
        ]);
        if (!session.isCurrent()) return;
        router.replace(
          run
            ? { pathname: "/workout-run/[id]", params: { id: run.id } }
            : {
                pathname: "/workout-plan/[id]",
                params: { id: plan.id, ...(sessionId ? { sessionId } : {}) },
              },
        );
      },
    );
  };
  return (
    <Screen
      edges={["bottom"]}
      footer={
        review ? (
          <>
            <Button
              label={
                submission
                  ? submission.start
                    ? "Retry save & start"
                    : "Retry saving plan"
                  : sessionId
                    ? "Save plan to continue"
                    : "Save & start workout"
              }
              loading={action.busy}
              onPress={() => submit(submission?.start ?? !sessionId)}
            />
            {!submission && !sessionId && (
              <Button
                label="Save for later"
                variant="ghost"
                disabled={action.busy}
                onPress={() => submit(false)}
              />
            )}
          </>
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: review ? "Review workout" : "Create workout plan" }} />
      <T variant="title">{review ? review.title : "Make it yours."}</T>
      <T color="textSecondary">
        {review
          ? "Check the targets. Start when you’re ready."
          : "Build a plan with exercises, targets and instructions."}
      </T>
      {Boolean(draftId) && !imported && (
        <Notice>
          This draft is no longer available. Create a plan below or return to the coach.
        </Notice>
      )}
      {starting.error && <Notice tone="danger">{starting.error}</Notice>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {review ? (
        <>
          <PlanPreview plan={review} />
          <T variant="caption" color="textSecondary">
            A private plan. Nothing is marked complete until you record it during your workout.
          </T>
          {!submission && (
            <Button
              label="Edit exercises & targets"
              variant="soft"
              disabled={action.busy}
              onPress={() => setReview(null)}
            />
          )}
          {submission && action.error && (
            <>
              <T variant="caption" color="textSecondary">
                Retry to finish this same workout. A saved plan may already be in your Plans.
              </T>
              <Button
                label="Open my plans"
                variant="ghost"
                onPress={() => router.replace("/workout-plans")}
              />
            </>
          )}
        </>
      ) : (
        <>
          <AIDraftPlan
            session={session}
            disabled={action.busy}
            onUse={(draft) => {
              setValue(planFields(planContentFromAIDraft(draft, Crypto.randomUUID)));
              setReviewSuggested(true);
              setVersion((current) => current + 1);
            }}
          />
          <PlanEditor
            key={version}
            value={value}
            onChange={setValue}
            busy={action.busy}
            reviewSuggested={reviewSuggested}
            saveLabel="Review workout"
            onSave={setReview}
          />
        </>
      )}
    </Screen>
  );
}
