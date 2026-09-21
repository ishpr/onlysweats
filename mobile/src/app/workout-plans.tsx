import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { SectionTitle } from "@/components/list";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { formatWhen } from "@/lib/format";
import { useRefreshOnFocus } from "@/lib/queries";
import type { WorkoutPlanPage, WorkoutRunPage } from "../../../shared/workout-plans";

export default function WorkoutPlansRoute() {
  return <PrivateMember component={WorkoutPlans} />;
}
function WorkoutPlans({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [runCursor, setRunCursor] = useState<string | null>(null);
  const plans = useQuery({
    queryKey: ["private-workout-plans", member.id, cursor],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<WorkoutPlanPage>(
        `/fitness/plans?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      ),
  });
  const runs = useQuery({
    queryKey: ["private-workout-runs", member.id, runCursor],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<WorkoutRunPage>(
        `/fitness/runs?limit=10${runCursor ? `&cursor=${encodeURIComponent(runCursor)}` : ""}`,
        { signal },
      ),
  });
  return (
    <Screen
      edges={["bottom"]}
      onRefresh={() => {
        void plans.refetch();
        void runs.refetch();
      }}
      refreshing={plans.isRefetching || runs.isRefetching}
    >
      <Stack.Screen options={{ title: "Workout plans" }} />
      <T variant="title">A plan to follow together.</T>
      <T color="textSecondary">
        Build your exercises, sets and instructions once. Keep a private template, then share a
        fixed copy with your session.
      </T>
      {sessionId && (
        <Notice>
          Choose a workout to review before sharing it with this session. The host can add the first
          plan before the session starts. Once attached, a plan stays fixed after anyone joins.
        </Notice>
      )}
      <Button
        label="Create a workout plan"
        onPress={() =>
          router.push({ pathname: "/workout-plan/new", params: sessionId ? { sessionId } : {} })
        }
      />
      <SectionTitle>Your private templates</SectionTitle>
      {(plans.isPending || plans.error) && (
        <StateView
          loading={plans.isPending}
          error={plans.error}
          onRetry={() => void plans.refetch()}
        />
      )}
      {!plans.error && plans.data?.plans.length === 0 && (
        <Notice>No templates yet. Create a plan by hand or ask AI for a draft you can edit.</Notice>
      )}
      {!plans.error &&
        plans.data?.plans.map((plan) => (
          <Card key={plan.id}>
            <T variant="heading">{plan.title}</T>
            <T color="textSecondary">
              {plan.exercises.length} exercises ·{" "}
              {plan.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)} sets
            </T>
            <T variant="caption" color="textFaint">
              Private · Updated {formatWhen(plan.updatedAt)}
            </T>
            <Button
              label={sessionId ? "Review for this session" : "Open workout plan"}
              variant="soft"
              onPress={() =>
                router.push({
                  pathname: "/workout-plan/[id]",
                  params: { id: plan.id, ...(sessionId ? { sessionId } : {}) },
                })
              }
            />
          </Card>
        ))}
      {plans.data?.nextCursor && (
        <Button
          label="Older plans"
          variant="soft"
          onPress={() => setCursor(plans.data!.nextCursor)}
        />
      )}
      {cursor && (
        <Button label="Most recent plans" variant="ghost" onPress={() => setCursor(null)} />
      )}
      <SectionTitle>Your workout history</SectionTitle>
      <T variant="caption" color="textSecondary">
        Your own set entries. These stay separate from Apple Health measurements and the session’s
        attendance record.
      </T>
      {(runs.isPending || runs.error) && (
        <StateView
          loading={runs.isPending}
          error={runs.error}
          onRetry={() => void runs.refetch()}
        />
      )}
      {!runs.error && runs.data?.runs.length === 0 && (
        <Notice>Start a saved plan to record your first workout.</Notice>
      )}
      {!runs.error &&
        runs.data?.runs.map((run) => (
          <Card key={run.id}>
            <T variant="heading">{run.snapshot.title}</T>
            <T color="textSecondary">
              {run.status === "completed" ? "Finished" : "In progress"} ·{" "}
              {run.results.filter((result) => result.status === "completed").length} sets recorded
            </T>
            <T variant="caption" color="textFaint">
              {formatWhen(run.startedAt)}
              {run.sessionId ? " · Buddy session" : ""}
            </T>
            <Button
              label={run.status === "completed" ? "Review my workout" : "Continue my workout"}
              variant="soft"
              onPress={() => router.push({ pathname: "/workout-run/[id]", params: { id: run.id } })}
            />
          </Card>
        ))}
      {runs.data?.nextCursor && (
        <Button
          label="Older workouts"
          variant="soft"
          onPress={() => setRunCursor(runs.data!.nextCursor)}
        />
      )}
      {runCursor && (
        <Button label="Most recent workouts" variant="ghost" onPress={() => setRunCursor(null)} />
      )}
    </Screen>
  );
}
