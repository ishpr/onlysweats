import { useState } from "react";
import * as Crypto from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { PlanEditor } from "@/components/workout-plans/plan-editor";
import { PlanPreview } from "@/components/workout-plans/plan-preview";
import { usePrivateAction } from "@/hooks/use-private-action";
import { planFields, type PlanFields } from "@/lib/workout-plans/forms";
import { useRefreshOnFocus } from "@/lib/queries";
import type { WorkoutPlan, WorkoutRun } from "../../../../shared/workout-plans";

export default function WorkoutPlanRoute() {
  return <PrivateMember component={WorkoutPlanDetail} />;
}
function WorkoutPlanDetail({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const { id, sessionId } = useLocalSearchParams<{ id: string; sessionId?: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [edit, setEdit] = useState<{ revision: number; value: PlanFields } | null>(null);
  const [remove, setRemove] = useState(false);
  const [runId, setRunId] = useState(Crypto.randomUUID);
  const key = ["private-workout-plan", member.id, id];
  const query = useQuery({
    queryKey: key,
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ plan: WorkoutPlan }>(`/fitness/plans/${id}`, { signal }),
  });
  if (!query.data || query.error)
    return (
      <Screen edges={["bottom"]}>
        <StateView
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  const plan = query.data.plan;
  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: edit ? "Edit workout plan" : "Workout plan" }} />
      <T variant="title">{plan.title}</T>
      <T color="textSecondary">Private template · Version {plan.revision}</T>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {edit ? (
        <>
          <Notice>Existing session copies and workout records keep their original plan.</Notice>
          <PlanEditor
            value={edit.value}
            onChange={(value) => setEdit({ ...edit, value })}
            busy={action.busy}
            onCancel={() => setEdit(null)}
            onSave={(content) =>
              void action.run(
                (signal) =>
                  session.request<{ plan: WorkoutPlan }>(`/fitness/plans/${id}`, {
                    method: "PUT",
                    json: { ...content, expectedRevision: edit.revision },
                    signal,
                  }),
                async (saved) => {
                  client.setQueryData(key, saved);
                  setEdit(null);
                  setRunId(Crypto.randomUUID());
                  await client.invalidateQueries({
                    queryKey: ["private-workout-plans", member.id],
                  });
                },
              )
            }
          />
        </>
      ) : (
        <>
          <Button
            label="Start my workout"
            loading={action.busy}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request<{ run: WorkoutRun }>("/fitness/runs", {
                    method: "POST",
                    json: { id: runId, planId: plan.id, expectedPlanRevision: plan.revision },
                    signal,
                  }),
                async ({ run }) => {
                  setRunId(Crypto.randomUUID());
                  await client.invalidateQueries({ queryKey: ["private-workout-runs", member.id] });
                  router.push({ pathname: "/workout-run/[id]", params: { id: run.id } });
                },
              )
            }
          />
          <PlanPreview plan={plan} />
          {sessionId && (
            <Card>
              <T variant="heading">Share this plan with your session</T>
              <T color="textSecondary">
                Session buddies can review this exact version, including the instructions and
                planned sets above, before starting their workout. Keep personal information out of
                the plan.
              </T>
              <T variant="caption" color="textSecondary">
                Only confirmed session buddies can view this plan. They can save their own copy.
                Your workout results stay private unless you choose to share progress.
              </T>
              <Button
                label="Attach this plan to the session"
                disabled={action.busy}
                onPress={() =>
                  void action.run(
                    (signal) =>
                      session.request(`/sessions/${sessionId}/workout-plan`, {
                        method: "PUT",
                        json: { planId: plan.id, expectedPlanRevision: plan.revision },
                        signal,
                      }),
                    async () => {
                      await client.invalidateQueries({
                        queryKey: ["session-workout-plan", member.id, sessionId],
                      });
                      router.replace({
                        pathname: "/session-workout/[id]",
                        params: { id: sessionId },
                      });
                    },
                  )
                }
              />
            </Card>
          )}
          <Button
            label="Edit template"
            variant="soft"
            disabled={action.busy}
            onPress={() => {
              setEdit({ revision: plan.revision, value: planFields(plan) });
              setRemove(false);
            }}
          />
          <Button
            label="Delete template"
            variant="ghost"
            disabled={action.busy}
            onPress={() => setRemove(true)}
          />
          {remove && (
            <Card>
              <Notice>
                Delete this private template? Copies already shared with sessions and saved workout
                records remain available.
              </Notice>
              <Button
                label="Delete private template"
                variant="danger"
                disabled={action.busy}
                onPress={() =>
                  void action.run(
                    (signal) =>
                      session.request(`/fitness/plans/${id}`, { method: "DELETE", signal }),
                    async () => {
                      await client.invalidateQueries({
                        queryKey: ["private-workout-plans", member.id],
                      });
                      router.replace("/workout-plans");
                    },
                  )
                }
              />
              <Button label="Keep template" variant="ghost" onPress={() => setRemove(false)} />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
