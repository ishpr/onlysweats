import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  OfflineWorkoutMember,
  type OfflineWorkoutMemberProps,
} from "@/components/workout-plans/offline-member";
import { offlineWorkouts } from "@/lib/workout-plans/offline";
import { usePrivateAction } from "@/hooks/use-private-action";
import { useOfflineRuns } from "@/lib/workout-plans/use-offline-runs";
import { hasPendingRun, unsyncedSetCount } from "@/lib/workout-plans/offline-data";
import { SectionTitle } from "@/components/list";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { formatWhen } from "@/lib/format";
import { useRefreshOnFocus } from "@/lib/queries";
import type { WorkoutPlanPage, WorkoutRunPage } from "../../../shared/workout-plans";

export default function WorkoutPlansRoute() {
  return <OfflineWorkoutMember component={WorkoutPlans} />;
}
function WorkoutPlans({
  member,
  session,
  offlineIdentity,
  offlineStorageAvailable,
}: OfflineWorkoutMemberProps) {
  useRefreshOnFocus();
  const local = useOfflineRuns(member.id, session, offlineStorageAvailable);
  const router = useRouter();
  const action = usePrivateAction(session);
  const [discardId, setDiscardId] = useState<string | null>(null);
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
      {!offlineStorageAvailable && (
        <Notice>
          Protected offline storage is unavailable. Opened workouts require a connection to save.
        </Notice>
      )}
      {offlineIdentity && (
        <Notice>
          Limited cached mode: only workouts previously opened on this iPhone are available. Connect
          within 24 hours of the last account check.
        </Notice>
      )}
      {local.runs.length > 0 && <SectionTitle>Saved on this iPhone</SectionTitle>}
      {local.runs.map((entry) => (
        <Card key={entry.base.id}>
          {entry.readBlocked ? (
            <Notice>
              This saved workout needs an online access check. Your device copy is retained.
            </Notice>
          ) : (
            <>
              <T variant="heading">{entry.base.snapshot.title}</T>
              <T color="textSecondary">
                {entry.draft.finish ? "Finished" : "In progress"} ·{" "}
                {entry.draft.results.filter((item) => item.status === "completed").length} sets
                recorded
              </T>
              <T variant="caption">
                {hasPendingRun(entry)
                  ? `${unsyncedSetCount(entry)} set changes and workout details waiting to sync`
                  : "Saved copy available offline"}
                {entry.active ? " · Pending set fields" : ""}
              </T>
              {(entry.conflict || entry.blocked) && (
                <Notice>Review needed before sync can continue.</Notice>
              )}
            </>
          )}
          <Button
            label="Open saved workout"
            variant="soft"
            onPress={() =>
              router.push({ pathname: "/workout-run/[id]", params: { id: entry.base.id } })
            }
          />
          <Button
            label="Remove this device copy"
            variant="ghost"
            disabled={action.busy}
            onPress={() => setDiscardId(entry.base.id)}
          />
          {discardId === entry.base.id && (
            <>
              <Notice>
                Remove this iPhone’s copy and any unsynced sets or fields? Saved server results
                remain. Unsynced entries cannot be recovered after removal.
              </Notice>
              <Button
                label="Discard this device copy"
                variant="danger"
                disabled={action.busy}
                onPress={() =>
                  void action.run(
                    () => offlineWorkouts.remove(member.id, entry.base.id, session.isCurrent),
                    () => setDiscardId(null),
                  )
                }
              />
              <Button label="Keep it" variant="ghost" onPress={() => setDiscardId(null)} />
            </>
          )}
        </Card>
      ))}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {local.error && offlineStorageAvailable && <Notice>{local.error.message}</Notice>}
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
