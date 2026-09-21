import { useState } from "react";
import * as Crypto from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { SectionTitle } from "@/components/list";
import { PlanPreview } from "@/components/workout-plans/plan-preview";
import { usePrivateAction } from "@/hooks/use-private-action";
import { useRefreshOnFocus } from "@/lib/queries";
import type {
  SessionWorkoutPlanView,
  WorkoutPlan,
  WorkoutRun,
} from "../../../../shared/workout-plans";

export default function SessionWorkoutRoute() {
  return <PrivateMember component={SessionWorkout} />;
}
function SessionWorkout({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [runId] = useState(Crypto.randomUUID);
  const [copyId] = useState(Crypto.randomUUID);
  const [removing, setRemoving] = useState(false);
  const key = ["session-workout-plan", member.id, id];
  const query = useQuery({
    queryKey: key,
    gcTime: 0,
    retry: false,
    refetchInterval: 30_000,
    queryFn: ({ signal }) =>
      session.request<SessionWorkoutPlanView>(`/sessions/${id}/workout-plan`, { signal }),
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
  const { plan, accountability, myRun, canAttach } = query.data;
  return (
    <Screen
      edges={["bottom"]}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <Stack.Screen options={{ title: "Our workout plan" }} />
      <T variant="title">{plan?.snapshot.title ?? "Our workout plan"}</T>
      <T color="textSecondary">One shared plan. Each person records their own workout.</T>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {!plan ? (
        <>
          <Notice>
            {canAttach
              ? "Add the first plan before this session starts. Buddies can review the exercises and instructions here before starting their workout."
              : "The host has not attached a workout plan to this session."}
          </Notice>
          {canAttach && (
            <Button
              label="Choose a workout plan"
              onPress={() => router.push({ pathname: "/workout-plans", params: { sessionId: id } })}
            />
          )}
        </>
      ) : (
        <>
          <Notice>
            Shared version {plan.planRevision}. Editing the original template does not change this
            session’s plan.
          </Notice>
          <PlanPreview plan={plan.snapshot} />
          {!myRun && (
            <T variant="caption" color="textSecondary">
              Review the targets and instructions above. Starting your workout uses this exact
              version.
            </T>
          )}
          {myRun ? (
            <Button
              label={myRun.status === "completed" ? "Review my workout" : "Continue my workout"}
              onPress={() =>
                router.push({ pathname: "/workout-run/[id]", params: { id: myRun.id } })
              }
            />
          ) : (
            <Button
              label="Start my workout from this plan"
              loading={action.busy}
              onPress={() =>
                void action.run(
                  (signal) =>
                    session.request<{ run: WorkoutRun }>("/fitness/runs", {
                      method: "POST",
                      json: {
                        id: runId,
                        sessionId: id,
                        expectedPlanId: plan.planId,
                        expectedPlanRevision: plan.planRevision,
                      },
                      signal,
                    }),
                  async ({ run }) => {
                    await client.invalidateQueries({
                      queryKey: ["private-workout-runs", member.id],
                    });
                    await client.invalidateQueries({ queryKey: key });
                    router.push({ pathname: "/workout-run/[id]", params: { id: run.id } });
                  },
                )
              }
            />
          )}
          <Button
            label="Save a private copy for next time"
            variant="soft"
            disabled={action.busy}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request<{ plan: WorkoutPlan }>(`/sessions/${id}/workout-plan/copy`, {
                    method: "POST",
                    json: {
                      id: copyId,
                      expectedPlanId: plan.planId,
                      expectedPlanRevision: plan.planRevision,
                    },
                    signal,
                  }),
                async ({ plan: copy }) => {
                  await client.invalidateQueries({
                    queryKey: ["private-workout-plans", member.id],
                  });
                  router.push({ pathname: "/workout-plan/[id]", params: { id: copy.id } });
                },
              )
            }
          />
          {canAttach && (
            <Button
              label="Remove plan from session"
              variant="ghost"
              disabled={action.busy}
              onPress={() => setRemoving(true)}
            />
          )}
          {canAttach && removing && (
            <Card>
              <Notice>
                Remove this shared copy? Your private template remains. You can choose another plan
                before anyone joins.
              </Notice>
              <Button
                label="Remove shared plan"
                variant="danger"
                disabled={action.busy}
                onPress={() =>
                  void action.run(
                    (signal) =>
                      session.request(`/sessions/${id}/workout-plan`, {
                        method: "DELETE",
                        json: {
                          expectedPlanId: plan.planId,
                          expectedPlanRevision: plan.planRevision,
                        },
                        signal,
                      }),
                    async () => {
                      setRemoving(false);
                      await query.refetch();
                    },
                  )
                }
              />
              <Button label="Keep this plan" variant="ghost" onPress={() => setRemoving(false)} />
            </Card>
          )}
          <SectionTitle>Our progress</SectionTitle>
          <T variant="caption" color="textSecondary">
            Only people who choose to share appear here. Set counts are self-reported; individual
            reps, loads, notes and Apple Health data stay private.
          </T>
          {accountability.length === 0 && (
            <Notice>No one is sharing progress yet. You can opt in from your own workout.</Notice>
          )}
          {accountability.map((person) => (
            <Card key={person.userId}>
              <T variant="label">
                {person.name}
                {person.userId === member.id ? " (you)" : ""}
              </T>
              <T color="textSecondary">
                {person.status === "completed" ? "Finished" : "In progress"} ·{" "}
                {person.completedSets} of {person.plannedSets} sets completed
                {person.skippedSets ? ` · ${person.skippedSets} skipped` : ""}
              </T>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
