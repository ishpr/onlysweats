import { useState } from "react";
import * as Crypto from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Notice, Screen, T } from "@/components/ui";
import { AIDraftPlan } from "@/components/workout-plans/ai-draft";
import { blankPlan, PlanEditor } from "@/components/workout-plans/plan-editor";
import { usePrivateAction } from "@/hooks/use-private-action";
import { planContentFromAIDraft } from "@/lib/intelligence";
import { takeWorkoutEditorDraft } from "@/lib/workout-plans/draft-handoff";
import { fieldsFromImportedDraft, planFields } from "@/lib/workout-plans/forms";
import type { WorkoutPlan } from "../../../../shared/workout-plans";

export default function NewWorkoutPlanRoute() {
  return <PrivateMember component={NewWorkoutPlan} />;
}
function NewWorkoutPlan({ member, session }: PrivateMemberProps) {
  const { draftId, sessionId } = useLocalSearchParams<{ draftId?: string; sessionId?: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [id] = useState(Crypto.randomUUID);
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
  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: "Create workout plan" }} />
      <T variant="title">Make it yours.</T>
      <T color="textSecondary">
        Build a private template with exercises and instructions your buddy can follow with you.
      </T>
      {draftId && !imported && (
        <Notice>
          This draft is no longer available. Create a plan below or return to the assistant.
        </Notice>
      )}
      {imported && (
        <Notice>
          Review every suggested field. Saving creates a planned workout; it does not record
          completed activity or share with anyone.
        </Notice>
      )}
      {starting.error && <Notice tone="danger">{starting.error}</Notice>}
      <AIDraftPlan
        session={session}
        disabled={action.busy}
        onUse={(draft) => {
          setValue(planFields(planContentFromAIDraft(draft, Crypto.randomUUID)));
          setVersion((current) => current + 1);
        }}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <PlanEditor
        key={version}
        value={value}
        onChange={setValue}
        busy={action.busy}
        onSave={(content) =>
          void action.run(
            (signal) =>
              session.request<{ plan: WorkoutPlan }>("/fitness/plans", {
                method: "POST",
                json: { id, ...content },
                signal,
              }),
            async ({ plan }) => {
              await client.invalidateQueries({ queryKey: ["private-workout-plans", member.id] });
              router.replace({
                pathname: "/workout-plan/[id]",
                params: { id: plan.id, ...(sessionId ? { sessionId } : {}) },
              });
            },
          )
        }
      />
    </Screen>
  );
}
