import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiSession } from "@/lib/api";
import { Button, Card, Chip, Field, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { SetFields } from "@/components/workout-plans/set-fields";
import { RestTimer } from "@/components/workout-plans/rest-timer";
import { Spacing } from "@/constants/theme";
import { usePrivateAction } from "@/hooks/use-private-action";
import { formatWhen } from "@/lib/format";
import {
  emptySetFields,
  parseSetFields,
  prescriptionLabel,
  setFields,
  type SetFields as ActualFields,
} from "@/lib/workout-plans/forms";
import { useRefreshOnFocus } from "@/lib/queries";
import {
  clearWorkoutRecovery,
  loadWorkoutRecovery,
  saveWorkoutRecovery,
} from "@/lib/workout-plans/recovery";
import type { WorkoutRecovery } from "@/lib/workout-plans/recovery-data";
import type { PlannedSet, WorkoutRun, WorkoutSetResult } from "../../../../shared/workout-plans";

type PrivateMemberProps = { member: { id: string }; session: ApiSession };

/** Online-only fallback when device-protected offline storage is unavailable. */
export default function OnlineRun(props: PrivateMemberProps) {
  useRefreshOnFocus();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["private-workout-run", props.member.id, id],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      props.session.request<{ run: WorkoutRun }>(`/fitness/runs/${id}`, { signal }),
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
  return (
    <RunEditor
      key={id}
      {...props}
      initial={query.data.run}
      refreshing={query.isRefetching}
      refresh={() => void query.refetch()}
    />
  );
}

function RunEditor({
  initial,
  member,
  session,
  refresh,
  refreshing,
}: PrivateMemberProps & { initial: WorkoutRun; refresh: () => void; refreshing: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [run, setRun] = useState(initial);
  const [note, setNote] = useState(initial.note);
  const [share, setShare] = useState(initial.shareAccountability);
  const [active, setActive] = useState<{
    exerciseId: string;
    set: PlannedSet;
    fields: ActualFields;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [rest, setRest] = useState<{ seconds: number; key: number } | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recovered, setRecovered] = useState<WorkoutRecovery | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void loadWorkoutRecovery(member.id, initial.id, session.isCurrent)
      .then((value) => {
        if (mounted && session.isCurrent()) {
          setRecovered(value);
          setRecoveryReady(true);
        }
      })
      .catch(() => {
        if (mounted && session.isCurrent()) {
          setRecoveryReady(true);
          setRecoveryError(
            "Device recovery is unavailable. Keep this screen open until your set is saved to SamePace.",
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [member.id, initial.id, session]);
  useEffect(() => {
    if (!recoveryReady || recovered || !session.isCurrent()) return;
    let mounted = true;
    const dirty = active !== null || note !== run.note || share !== run.shareAccountability;
    if (!dirty) {
      void clearWorkoutRecovery(member.id, run.id).catch(() => undefined);
      return;
    }
    void saveWorkoutRecovery(
      {
        version: 1,
        ownerId: member.id,
        runId: run.id,
        revision: run.revision,
        updatedAt: Date.now(),
        note,
        shareAccountability: share,
        active: active
          ? { exerciseId: active.exerciseId, setId: active.set.id, fields: active.fields }
          : null,
      },
      session.isCurrent,
    )
      .then((saved) => {
        if (mounted && session.isCurrent())
          setRecoveryError(
            saved
              ? null
              : "These edits are only in memory. Keep this screen open until your set is saved to SamePace.",
          );
      })
      .catch(() => {
        if (mounted && session.isCurrent())
          setRecoveryError(
            "These edits could not be saved on this device. Keep this screen open and retry the server save.",
          );
      });
    return () => {
      mounted = false;
    };
  }, [
    active,
    note,
    share,
    run.id,
    run.note,
    run.shareAccountability,
    run.revision,
    recoveryReady,
    recovered,
    session,
    member.id,
  ]);
  const totalSets = run.snapshot.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const completed = run.results.filter((result) => result.status === "completed").length;
  const skipped = run.results.filter((result) => result.status === "skipped").length;
  const remaining = totalSets - completed - skipped;
  const ended = run.status === "completed";
  const blocked =
    action.busy || !recoveryReady || recovered !== null || initial.revision > run.revision;
  const save = (results = run.results, finish = ended, restSeconds?: number) => {
    if (blocked) return;
    void action.run(
      (signal) =>
        session.request<{ run: WorkoutRun }>(`/fitness/runs/${run.id}`, {
          method: "PUT",
          json: {
            expectedRevision: run.revision,
            results,
            note,
            shareAccountability: share,
            finish,
          },
          signal,
        }),
      async ({ run: saved }) => {
        setRun(saved);
        setNote(saved.note);
        setShare(saved.shareAccountability);
        setActive(null);
        setFinishing(false);
        setError(null);
        void clearWorkoutRecovery(member.id, run.id).catch(() => undefined);
        client.setQueryData(["private-workout-run", member.id, run.id], { run: saved });
        if (restSeconds && !finish)
          setRest((current) => ({ seconds: restSeconds, key: (current?.key ?? 0) + 1 }));
        if (finish) setRest(null);
        await client.invalidateQueries({ queryKey: ["private-workout-runs", member.id] });
        await client.invalidateQueries({ queryKey: ["private-fitness", member.id, "summary"] });
        if (run.sessionId)
          await client.invalidateQueries({
            queryKey: ["session-workout-plan", member.id, run.sessionId],
          });
      },
    );
  };
  const record = (exerciseId: string, set: PlannedSet, result: WorkoutSetResult) => {
    const results = run.results.filter((current) => current.setId !== set.id);
    save(
      [...results, { ...result, exerciseId, setId: set.id }],
      ended,
      result.status === "completed" ? set.restSeconds : undefined,
    );
  };
  const resetToLatest = () => {
    setRun(initial);
    setNote(initial.note);
    setShare(initial.shareAccountability);
    setActive(null);
    setFinishing(false);
    setError(null);
  };
  return (
    <Screen edges={["bottom"]} onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: ended ? "Your workout" : "Follow your workout" }} />
      <Notice>Offline storage is unavailable. Saving workout results requires a connection.</Notice>
      <T variant="title">{run.snapshot.title}</T>
      <T color="textSecondary">
        {ended ? "Finished" : "In progress"} · Started {formatWhen(run.startedAt)}
      </T>
      {!recoveryReady && <StateView loading />}
      {recoveryError && <Notice>{recoveryError}</Notice>}
      {recovered && (
        <Card>
          <T variant="heading">Recover your unsaved fields?</T>
          <T color="textSecondary">
            This iPhone kept an encrypted copy of your pending set, note and sharing choice.
            Recovering it does not record another set. Compare it with your saved entries before
            saving.
          </T>
          {recovered.revision !== run.revision && (
            <Notice>
              The saved workout has changed since these fields were entered. Compare the recovered
              values with the saved set before choosing to save them again.
            </Notice>
          )}
          {recovered.active && (
            <T variant="caption" color="textSecondary">
              Pending actual entry: {recovered.active.fields.reps || "—"} reps ·{" "}
              {recovered.active.fields.durationSeconds || "—"} seconds ·{" "}
              {recovered.active.fields.distanceMeters || "—"} meters ·{" "}
              {recovered.active.fields.weight || "—"} {recovered.active.fields.unit}
            </T>
          )}
          {recovered.note !== run.note && (
            <>
              <T variant="caption" color="textSecondary">
                Saved note: {run.note || "None"}
              </T>
              <T variant="caption">Recovered note: {recovered.note || "None"}</T>
            </>
          )}
          <Button
            label="Recover fields for review"
            variant="soft"
            onPress={() => {
              const exercise = run.snapshot.exercises.find(
                (item) => item.id === recovered.active?.exerciseId,
              );
              const set = exercise?.sets.find((item) => item.id === recovered.active?.setId);
              setNote(recovered.note);
              setShare(recovered.shareAccountability);
              if (exercise && set && recovered.active)
                setActive({ exerciseId: exercise.id, set, fields: recovered.active.fields });
              setRecovered(null);
            }}
          />
          <Button
            label="Discard recovered fields"
            variant="ghost"
            onPress={() => {
              setRecovered(null);
              void clearWorkoutRecovery(member.id, run.id).catch(() => undefined);
            }}
          />
        </Card>
      )}
      <Card>
        <T variant="heading">
          {completed} of {totalSets} sets completed
        </T>
        <T color="textSecondary">
          {skipped} skipped · {remaining} not recorded
        </T>
        <T variant="caption" color="textFaint">
          Your entries are separate from Apple Health measurements and session attendance.
        </T>
      </Card>
      {initial.revision > run.revision && (
        <Card>
          <Notice>
            This workout changed on another screen or device. Reload the latest saved version before
            making more changes. Unsaved fields will be discarded.
          </Notice>
          <Button
            label="Reload saved workout"
            variant="soft"
            disabled={action.busy}
            onPress={resetToLatest}
          />
        </Card>
      )}
      {run.snapshot.instructions ? <T color="textSecondary">{run.snapshot.instructions}</T> : null}
      {(action.error || error) && <Notice tone="danger">{error ?? action.error}</Notice>}
      {action.error && (
        <Button
          label="Check latest saved version"
          variant="soft"
          disabled={action.busy}
          onPress={refresh}
        />
      )}
      {!ended && rest && <RestTimer key={rest.key} seconds={rest.seconds} />}
      {run.snapshot.exercises.map((exercise, exerciseIndex) => (
        <Card key={exercise.id}>
          <Row>
            <T variant="eyebrow" color="accent">
              {String(exerciseIndex + 1).padStart(2, "0")}
            </T>
            <T variant="heading" style={{ flex: 1 }}>
              {exercise.name}
            </T>
          </Row>
          {exercise.instructions ? <T color="textSecondary">{exercise.instructions}</T> : null}
          {exercise.sets.map((set, setIndex) => {
            const result = run.results.find(
              (item) => item.exerciseId === exercise.id && item.setId === set.id,
            );
            const editing = active?.set.id === set.id;
            return (
              <View key={set.id} style={{ gap: Spacing.two }}>
                <T variant="label">
                  Set {setIndex + 1} ·{" "}
                  {result?.status === "completed"
                    ? "Completed"
                    : result?.status === "skipped"
                      ? "Skipped"
                      : "Not recorded"}
                </T>
                <T variant="caption" color="textSecondary">
                  Planned: {prescriptionLabel(set)}
                  {set.restSeconds ? ` · ${set.restSeconds}s rest` : ""}
                </T>
                {result?.status === "completed" && (
                  <T variant="label" color="accent">
                    Actual: {prescriptionLabel(result)}
                  </T>
                )}
                {editing && active ? (
                  <>
                    <Notice>
                      Enter what you actually did. Planned values are not automatically recorded.
                    </Notice>
                    <SetFields
                      performed
                      value={active.fields}
                      disabled={blocked}
                      onChange={(patch) =>
                        setActive({ ...active, fields: { ...active.fields, ...patch } })
                      }
                    />
                    <Button
                      label="Save completed set"
                      disabled={blocked}
                      onPress={() => {
                        try {
                          const actual = parseSetFields(active.fields, true);
                          setError(null);
                          record(exercise.id, set, {
                            exerciseId: exercise.id,
                            setId: set.id,
                            status: "completed",
                            reps: actual.reps,
                            durationSeconds: actual.durationSeconds,
                            distanceMeters: actual.distanceMeters,
                            weight: actual.weight,
                            unit: actual.unit,
                          });
                        } catch (failure) {
                          setError(
                            failure instanceof Error
                              ? failure.message
                              : "Check your actual set values.",
                          );
                        }
                      }}
                    />
                    <Button
                      label="Cancel set changes"
                      variant="ghost"
                      disabled={action.busy}
                      onPress={() => setActive(null)}
                    />
                  </>
                ) : (
                  <>
                    <Button
                      label={
                        result?.status === "completed" ? "Correct this set" : "Record completed set"
                      }
                      variant="soft"
                      disabled={blocked || active !== null}
                      onPress={() => {
                        setError(null);
                        setActive({
                          exerciseId: exercise.id,
                          set,
                          fields:
                            result?.status === "completed"
                              ? setFields(result)
                              : { ...emptySetFields(), unit: set.unit, restSeconds: "0" },
                        });
                      }}
                    />
                    {result?.status !== "skipped" && (
                      <Button
                        label="Mark set skipped"
                        variant="ghost"
                        disabled={blocked || active !== null}
                        onPress={() =>
                          record(exercise.id, set, {
                            exerciseId: exercise.id,
                            setId: set.id,
                            status: "skipped",
                            reps: null,
                            durationSeconds: null,
                            distanceMeters: null,
                            weight: null,
                            unit: set.unit,
                          })
                        }
                      />
                    )}
                    {result && (
                      <Button
                        label="Clear set entry"
                        variant="ghost"
                        disabled={blocked || active !== null || (ended && run.results.length === 1)}
                        onPress={() => save(run.results.filter((item) => item.setId !== set.id))}
                      />
                    )}
                  </>
                )}
              </View>
            );
          })}
        </Card>
      ))}
      <Card>
        <Field
          label="Private workout note"
          value={note}
          onChangeText={setNote}
          maxLength={1000}
          multiline
          editable={!blocked}
          placeholder="How this workout went, or what you changed."
        />
        {run.sessionId ? (
          <>
            <T variant="label">Accountability with this session</T>
            <T variant="caption" color="textSecondary">
              Share your name, workout status and completed/skipped set counts with the session’s
              members. Your reps, weights, notes and health data stay private. Turning this off
              removes the shared summary.
            </T>
            <Row style={{ flexWrap: "wrap" }}>
              <Chip
                label="Keep my progress private"
                selected={!share}
                disabled={blocked}
                onPress={() => setShare(false)}
              />
              <Chip
                label="Share my set counts"
                selected={share}
                disabled={blocked}
                onPress={() => setShare(true)}
              />
            </Row>
            {share !== run.shareAccountability && (
              <Notice>Your sharing choice takes effect when you save.</Notice>
            )}
          </>
        ) : (
          <T variant="caption" color="textSecondary">
            This is a private solo workout.
          </T>
        )}
        <Button
          label="Save note and sharing choice"
          variant="soft"
          disabled={blocked || active !== null}
          onPress={() => save()}
        />
      </Card>
      {!ended && (
        <Button
          label="Finish my workout"
          disabled={blocked || active !== null || run.results.length === 0}
          onPress={() => {
            setFinishing(true);
            setActive(null);
          }}
        />
      )}
      {!ended && run.results.length === 0 && (
        <T variant="caption" color="textSecondary">
          Record or skip a set before finishing. Delete the workout if you did not start.
        </T>
      )}
      {finishing && (
        <Card>
          <T variant="heading">Finish with {completed} completed sets?</T>
          <T color="textSecondary">
            {skipped} sets skipped. {remaining} sets remain unrecorded and will not count as
            completed. Your session attendance is handled separately.
          </T>
          <Button
            label="Finish and save my workout"
            disabled={blocked}
            onPress={() => save(run.results, true)}
          />
          <Button label="Keep working out" variant="ghost" onPress={() => setFinishing(false)} />
        </Card>
      )}
      {run.sessionId && (
        <Button
          label="View our shared plan and progress"
          variant="soft"
          onPress={() =>
            router.push({ pathname: "/session-workout/[id]", params: { id: run.sessionId! } })
          }
        />
      )}
      <Button
        label="Delete my workout record"
        variant="ghost"
        disabled={action.busy}
        onPress={() => setRemoving(true)}
      />
      {removing && (
        <Card>
          <Notice>
            Delete your recorded sets and note? Any shared progress summary is removed. The shared
            plan and attendance record stay as they are.
          </Notice>
          <Button
            label="Delete this workout record"
            variant="danger"
            disabled={action.busy}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request(`/fitness/runs/${run.id}`, { method: "DELETE", signal }),
                async () => {
                  await clearWorkoutRecovery(member.id, run.id).catch(() => undefined);
                  await client.invalidateQueries({ queryKey: ["private-workout-runs", member.id] });
                  await client.invalidateQueries({
                    queryKey: ["private-fitness", member.id, "summary"],
                  });
                  if (run.sessionId)
                    await client.invalidateQueries({
                      queryKey: ["session-workout-plan", member.id, run.sessionId],
                    });
                  router.replace("/workout-plans");
                },
              )
            }
          />
          <Button label="Keep workout record" variant="ghost" onPress={() => setRemoving(false)} />
        </Card>
      )}
    </Screen>
  );
}
