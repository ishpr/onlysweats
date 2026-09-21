import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OfflineWorkoutMember,
  isConnectionFailure,
  type OfflineWorkoutMemberProps,
} from "@/components/workout-plans/offline-member";
import { Button, Card, Chip, Field, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { SetFields } from "@/components/workout-plans/set-fields";
import OnlineRun from "@/components/workout-plans/online-run";
import { RestTimer } from "@/components/workout-plans/rest-timer";
import type { TimerPersistence } from "@/components/workout-plans/use-workout-timer";
import {
  makeStoredWorkoutTimer,
  effectiveRunForTimer,
  scopeForWorkoutTimer,
  writeOfflineTimer,
} from "@/lib/workout-plans/timer-record";
import { ExerciseTimer } from "@/components/workout-plans/exercise-timer";
import {
  fieldsWithTimedDuration,
  workoutSetTimerIdentity,
} from "@/lib/workout-plans/workout-timer";
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
  offlineWorkouts,
  boundedWorkoutRequest,
  syncOfflineWorkout,
  refreshOfflineWorkout,
} from "@/lib/workout-plans/offline";
import {
  hasPendingRun,
  activeEditorFromEntry,
  resolveRunConflict,
  reconcileEditorField,
  unsyncedSetCount,
  type OfflineRun,
} from "@/lib/workout-plans/offline-data";
import { useOfflineRuns } from "@/lib/workout-plans/use-offline-runs";
import type { WorkoutRecovery } from "@/lib/workout-plans/recovery-data";
import { clearWorkoutRecovery, loadWorkoutRecovery } from "@/lib/workout-plans/recovery";
import type { PlannedSet, WorkoutRun, WorkoutSetResult } from "../../../../shared/workout-plans";

export default function WorkoutRunRoute() {
  return <OfflineWorkoutMember component={WorkoutRunDetail} />;
}
function WorkoutRunDetail(props: OfflineWorkoutMemberProps) {
  return props.offlineStorageAvailable ? (
    <OfflineRunDetail {...props} />
  ) : (
    <OnlineRun member={props.member} session={props.session} />
  );
}
function OfflineRunDetail(props: OfflineWorkoutMemberProps) {
  useRefreshOnFocus();
  const { id } = useLocalSearchParams<{ id: string }>();
  const local = useOfflineRuns(props.member.id, props.session);
  const query = useQuery({
    queryKey: ["private-workout-run", props.member.id, id],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => ({
      run: await refreshOfflineWorkout(props.member.id, id, props.session, signal),
    }),
  });
  const entry = local.runs.find((item) => item.base.id === id);
  if (!entry || entry.readBlocked || (query.error && !isConnectionFailure(query.error)))
    return (
      <Screen edges={["bottom"]}>
        <StateView
          loading={!local.ready || query.isPending}
          error={local.error ?? query.error}
          onRetry={() => void query.refetch()}
        />
        {entry?.readBlocked && (
          <Notice>
            Access to this saved workout needs a fresh online check. Your unsynced device copy is
            retained.
          </Notice>
        )}
        {local.ready && !entry && (
          <Notice>
            Open an already-started workout while connected before using it offline. Deleted or
            expired device copies cannot be reopened offline.
          </Notice>
        )}
      </Screen>
    );
  return (
    <RunEditor
      key={id}
      {...props}
      entry={entry}
      offline={props.offlineIdentity || !!query.error}
      refreshing={query.isRefetching}
      refresh={() => void query.refetch()}
    />
  );
}

function RunEditor({
  entry,
  member,
  session,
  offline,
  refresh,
  refreshing,
}: OfflineWorkoutMemberProps & {
  entry: OfflineRun;
  offline: boolean;
  refresh: () => void;
  refreshing: boolean;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const run = effectiveRunForTimer(entry);
  const [note, setNote] = useState(entry.draft.note);
  const [share, setShare] = useState(entry.base.shareAccountability);
  const previousNote = useRef(entry.draft.note);
  const previousShare = useRef(entry.base.shareAccountability);
  useEffect(() => {
    const oldNote = previousNote.current;
    const oldShare = previousShare.current;
    setNote((current) => reconcileEditorField(current, oldNote, entry.draft.note));
    setShare((current) => reconcileEditorField(current, oldShare, entry.base.shareAccountability));
    previousNote.current = entry.draft.note;
    previousShare.current = entry.base.shareAccountability;
  }, [entry.draft.note, entry.base.shareAccountability]);
  const [active, setActive] = useState<{
    exerciseId: string;
    set: PlannedSet;
    fields: ActualFields;
    timerIdentity?: string;
  } | null>(() => activeEditorFromEntry(entry));
  const [legacyRecovery, setLegacyRecovery] = useState<WorkoutRecovery | null>(null);
  useEffect(() => {
    let current = true;
    void loadWorkoutRecovery(member.id, run.id, session.isCurrent)
      .then((value) => {
        if (current && session.isCurrent()) setLegacyRecovery(value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [member.id, run.id, session]);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const rest = entry.timer?.kind === "rest" ? entry.timer : null;
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [fieldWrites, setFieldWrites] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [onlineChecked, setOnlineChecked] = useState(!offline);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const pending = hasPendingRun(entry);
  const totalSets = run.snapshot.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const completed = run.results.filter((result) => result.status === "completed").length;
  const skipped = run.results.filter((result) => result.status === "skipped").length;
  const remaining = totalSets - completed - skipped;
  const ended = run.status === "completed";
  const blocked = action.busy || entry.conflict !== null;
  const timerScope = useRef<string | null>(null);
  const activeTimerIdentity = active
    ? workoutSetTimerIdentity(run, active.exerciseId, active.set.id)
    : null;
  const currentTimerScope = !entry.conflict && !ended ? activeTimerIdentity : null;
  useLayoutEffect(() => {
    timerScope.current = currentTimerScope;
    return () => {
      timerScope.current = null;
    };
  }, [currentTimerScope]);
  const timerCurrent = (identity: string | null) =>
    identity !== null && session.isCurrent() && timerScope.current === identity;
  const timerPersistence = (
    kind: "exercise" | "rest",
    exerciseId: string,
    setId: string,
  ): TimerPersistence => {
    const scope = scopeForWorkoutTimer(run, kind, exerciseId, setId);
    const record = entry.timer?.clock.scope === scope ? entry.timer : null;
    return {
      record,
      currentId: entry.timer?.id ?? null,
      save: async (id, clock, expectedId) => {
        if (!session.isCurrent()) throw new Error("Your account changed.");
        await offlineWorkouts.update(member.id, run.id, session.isCurrent, (current) => {
          const target = makeStoredWorkoutTimer(
            effectiveRunForTimer(current),
            kind,
            exerciseId,
            setId,
            id,
            Date.now(),
            false,
          );
          return writeOfflineTimer(current, { ...target, clock }, expectedId);
        });
      },
    };
  };
  const skipRest = () => {
    if (!rest || blocked) return;
    void action.run(() =>
      offlineWorkouts.update(member.id, run.id, session.isCurrent, (current) =>
        writeOfflineTimer(current, null, rest.id),
      ),
    );
  };
  const invalidate = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ["private-workout-runs", member.id] });
    await client.invalidateQueries({ queryKey: ["private-fitness", member.id, "summary"] });
    if (run.sessionId)
      await client.invalidateQueries({
        queryKey: ["session-workout-plan", member.id, run.sessionId],
      });
  }, [client, member.id, run.sessionId]);
  const sync = useCallback(
    async (retry = false) => {
      if (!session.isCurrent()) return;
      setSyncing(true);
      try {
        await syncOfflineWorkout(member.id, run.id, session, retry);
        if (!alive.current || !session.isCurrent()) return;
        await refreshOfflineWorkout(member.id, run.id, session);
        if (alive.current && session.isCurrent()) {
          setError(null);
          setOnlineChecked(true);
        }
        await invalidate();
      } catch (failure) {
        if (alive.current && session.isCurrent()) {
          setOnlineChecked(false);
          setError(
            failure instanceof Error
              ? failure.message
              : "Sync did not finish. Your device copy is retained.",
          );
        }
      } finally {
        if (alive.current && session.isCurrent()) setSyncing(false);
      }
    },
    [session, member.id, run.id, invalidate],
  );
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);
  useEffect(() => {
    void syncRef.current();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void syncRef.current();
    }, 30_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncRef.current();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  const persistFields = (nextNote: string, nextActive: typeof active) => {
    setFieldWrites((count) => count + 1);
    void offlineWorkouts
      .update(member.id, run.id, session.isCurrent, (current) => ({
        ...current,
        version: current.version + 1,
        draft: { ...current.draft, note: nextNote },
        active: nextActive
          ? {
              exerciseId: nextActive.exerciseId,
              setId: nextActive.set.id,
              fields: nextActive.fields,
            }
          : null,
      }))
      .then(() => {
        if (alive.current && session.isCurrent()) setFieldError(null);
      })
      .catch(() => {
        if (alive.current && session.isCurrent())
          setFieldError(
            "Your latest fields could not be saved on this device. Keep this screen open and retry saving.",
          );
      })
      .finally(() => {
        if (alive.current && session.isCurrent()) setFieldWrites((count) => count - 1);
      });
  };
  const changeActive = (next: typeof active) => {
    setActive(next);
    persistFields(note, next);
  };
  const save = (
    results: WorkoutSetResult[] | ((current: WorkoutSetResult[]) => WorkoutSetResult[]) = (
      current,
    ) => current,
    finish = ended,
    restAfter?: { exerciseId: string; setId: string },
  ) => {
    if (blocked) return;
    void action.run(
      () =>
        offlineWorkouts.update(member.id, run.id, session.isCurrent, (current) => {
          const next: OfflineRun = {
            ...current,
            version: current.version + 1,
            draft: {
              results: typeof results === "function" ? results(current.draft.results) : results,
              note,
              finish,
            },
            active: null,
            timer: finish || current.timer?.kind === "exercise" ? null : current.timer,
          };
          if (restAfter && !finish)
            next.timer = makeStoredWorkoutTimer(
              effectiveRunForTimer(next),
              "rest",
              restAfter.exerciseId,
              restAfter.setId,
              Crypto.randomUUID(),
              Date.now(),
            );
          return next;
        }),
      async (next) => {
        setNote(next.draft.note);
        setActive(null);
        setFinishing(false);
        setError(null);
        await clearWorkoutRecovery(member.id, run.id).catch(() => undefined);
        void sync();
      },
    );
  };
  const record = (exerciseId: string, set: PlannedSet, result: WorkoutSetResult) => {
    save(
      (results) => [
        ...results.filter((current) => current.setId !== set.id),
        { ...result, exerciseId, setId: set.id },
      ],
      ended,
      result.status === "completed" && set.restSeconds > 0
        ? { exerciseId, setId: set.id }
        : undefined,
    );
  };
  const resolve = (choice: "server" | "local" | "private") => {
    if (fieldWrites > 0 || fieldError || action.busy) return;
    void action.run(
      () =>
        offlineWorkouts.update(member.id, run.id, session.isCurrent, (current) => {
          if (current.conflict?.revision !== entry.conflict?.revision)
            throw new Error("The saved version changed again. Review it before choosing.");
          return resolveRunConflict(current, choice, Date.now());
        }),
      (next) => {
        setShare(next.base.shareAccountability);
        setNote(next.draft.note);
        setActive(activeEditorFromEntry(next));
        setFinishing(false);
        setError(null);
        if (choice !== "server") void sync();
      },
    );
  };
  return (
    <Screen edges={["bottom"]} onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: ended ? "Your workout" : "Follow your workout" }} />
      <T variant="title">{run.snapshot.title}</T>
      <T color="textSecondary">
        {ended ? "Finished" : "In progress"} · Started {formatWhen(run.startedAt)}
      </T>
      <Card>
        <T variant="heading">
          {pending
            ? `${unsyncedSetCount(entry)} set changes waiting to sync`
            : "Saved on this iPhone"}
        </T>
        <T color="textSecondary">
          {pending
            ? "Your workout changes are protected on this device. They are not yet confirmed by SamePace."
            : "This opened workout is available offline. Start new workouts while connected."}
        </T>
        {(offline || !onlineChecked) && (
          <Notice>
            Limited cached access. Current server access cannot be checked offline; reconnect within
            24 hours of your last account check.
          </Notice>
        )}
        <T variant="caption" color="textFaint">
          Device copies expire after 7 days without use. Signing out removes them. Unsynced changes
          stay on this device. Accepted sync follows your saved progress-sharing choice. Sharing
          changes require a connection.
        </T>
        <Button
          label={syncing ? "Syncing…" : "Sync / retry now"}
          variant="soft"
          disabled={syncing || !!entry.conflict}
          onPress={() => void sync(true)}
        />
      </Card>
      {legacyRecovery && (
        <Card>
          <T variant="heading">Earlier unsaved fields are available</T>
          <T color="textSecondary">
            These fields were kept by the previous workout editor. Review them before recording a
            completed set. The old sharing choice is not restored.
          </T>
          <T variant="caption">Note: {legacyRecovery.note || "None"}</T>
          {legacyRecovery.active && (
            <T variant="caption">
              Actual fields: {legacyRecovery.active.fields.reps || "—"} reps ·{" "}
              {legacyRecovery.active.fields.durationSeconds || "—"} seconds ·{" "}
              {legacyRecovery.active.fields.distanceMeters || "—"} meters ·{" "}
              {legacyRecovery.active.fields.weight || "—"} {legacyRecovery.active.fields.unit}
            </T>
          )}
          {legacyRecovery.revision !== entry.base.revision && (
            <Notice>
              The saved version changed. Compare these earlier fields with the saved entries before
              recording them again.
            </Notice>
          )}
          <Button
            label="Restore earlier fields for review"
            variant="soft"
            disabled={blocked || pending || active !== null || fieldWrites > 0}
            onPress={() =>
              void action.run(
                () =>
                  offlineWorkouts.update(member.id, run.id, session.isCurrent, (current) => ({
                    ...current,
                    version: current.version + 1,
                    draft: { ...current.draft, note: legacyRecovery.note },
                    active: legacyRecovery.active,
                  })),
                async (next) => {
                  setNote(next.draft.note);
                  const exercise = next.base.snapshot.exercises.find(
                    (item) => item.id === next.active?.exerciseId,
                  );
                  const set = exercise?.sets.find((item) => item.id === next.active?.setId);
                  if (exercise && set && next.active)
                    setActive({ exerciseId: exercise.id, set, fields: next.active.fields });
                  await clearWorkoutRecovery(member.id, run.id);
                  setLegacyRecovery(null);
                },
              )
            }
          />
          <Button
            label="Discard earlier fields"
            variant="ghost"
            disabled={action.busy}
            onPress={() =>
              void action.run(
                () => clearWorkoutRecovery(member.id, run.id),
                () => setLegacyRecovery(null),
              )
            }
          />
        </Card>
      )}
      {fieldWrites > 0 && <T variant="caption">Saving your latest fields on this iPhone…</T>}
      {fieldError && <Notice tone="danger">{fieldError}</Notice>}
      {entry.blocked && !entry.conflict && (
        <Notice>
          Automatic sync is paused. Your entries are retained; connect and retry to review the
          latest saved version.
        </Notice>
      )}
      {entry.conflict && (
        <Card>
          <T variant="heading">Review changes from another device</T>
          <Notice>
            Your local results are retained. Nothing will overwrite the newer saved workout until
            you choose.
          </Notice>
          <T>
            Server revision {entry.conflict.revision}:{" "}
            {entry.conflict.status === "completed" ? "Finished" : "In progress"}
          </T>
          <T>Server note: {entry.conflict.note || "None"}</T>
          <T>Your note: {entry.draft.note || "None"}</T>
          {run.snapshot.exercises.map((exercise) => (
            <View key={exercise.id}>
              <T variant="label">{exercise.name}</T>
              {exercise.sets.map((set, index) => {
                const ours = entry.draft.results.find((item) => item.setId === set.id);
                const theirs = entry.conflict!.results.find((item) => item.setId === set.id);
                const label = (result?: WorkoutSetResult) =>
                  !result
                    ? "Unrecorded"
                    : result.status === "skipped"
                      ? "Skipped"
                      : prescriptionLabel(result);
                return (
                  <T key={set.id} variant="caption">
                    Set {index + 1} · Saved: {label(theirs)} · Yours: {label(ours)}
                  </T>
                );
              })}
            </View>
          ))}
          <T variant="caption">
            Applying your version replaces the saved actual entries with your reviewed entries using
            the latest saved sharing choice. A completed workout remains completed.
          </T>
          <Button
            label="Discard local edits and use saved version"
            variant="soft"
            disabled={action.busy || fieldWrites > 0 || !!fieldError}
            onPress={() => resolve("server")}
          />
          {!entry.blocked && (
            <Button
              label="Apply my reviewed entries to latest version"
              disabled={action.busy || fieldWrites > 0 || !!fieldError}
              onPress={() => resolve("local")}
            />
          )}
          <Button
            label="Apply my reviewed entries privately"
            disabled={action.busy || fieldWrites > 0 || !!fieldError}
            onPress={() => resolve("private")}
          />
        </Card>
      )}
      <Card>
        <T variant="heading">
          {completed} of {totalSets} set{totalSets === 1 ? "" : "s"} completed
        </T>
        <T color="textSecondary">
          {skipped} skipped · {remaining} not recorded
        </T>
        <T variant="caption" color="textFaint">
          Your entries are separate from Apple Health measurements and session attendance.
        </T>
      </Card>
      {run.snapshot.instructions ? <AssistantMarkdown text={run.snapshot.instructions} /> : null}
      {(action.error || error) && <Notice tone="danger">{error ?? action.error}</Notice>}
      {action.error && (
        <Button
          label="Check latest saved version"
          variant="soft"
          disabled={action.busy}
          onPress={refresh}
        />
      )}
      {!ended && rest && (
        <RestTimer
          key={`${rest.id}:${JSON.stringify(rest.clock)}`}
          scope={rest.clock.scope}
          seconds={rest.targetSeconds}
          persistence={timerPersistence("rest", rest.exerciseId, rest.setId)}
          onSkip={skipRest}
          disabled={blocked}
          isCurrent={session.isCurrent}
        />
      )}
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
          {exercise.instructions ? <AssistantMarkdown text={exercise.instructions} /> : null}
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
                    {!ended && set.durationSeconds !== null && (
                      <ExerciseTimer
                        key={`${member.id}:${activeTimerIdentity}:${entry.timer?.kind === "exercise" ? `${entry.timer.id}:${JSON.stringify(entry.timer.clock)}` : "new"}`}
                        scope={scopeForWorkoutTimer(run, "exercise", exercise.id, set.id)!}
                        targetSeconds={set.durationSeconds}
                        persistence={timerPersistence("exercise", exercise.id, set.id)}
                        autoStart={active.timerIdentity === activeTimerIdentity}
                        disabled={blocked || fieldWrites > 0 || !!fieldError}
                        isCurrent={() => timerCurrent(activeTimerIdentity)}
                        onUseDuration={(seconds) => {
                          if (!timerCurrent(activeTimerIdentity)) return;
                          changeActive({
                            ...active,
                            fields: fieldsWithTimedDuration(active.fields, seconds),
                          });
                        }}
                      />
                    )}
                    <Notice>
                      Enter what you actually did. Planned values are not automatically recorded.
                    </Notice>
                    <SetFields
                      performed
                      value={active.fields}
                      disabled={blocked}
                      onChange={(patch) =>
                        changeActive({ ...active, fields: { ...active.fields, ...patch } })
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
                      onPress={() => changeActive(null)}
                    />
                  </>
                ) : (
                  <>
                    {!ended && set.durationSeconds !== null && result?.status !== "completed" && (
                      <Button
                        label="Start timer for this set"
                        variant="soft"
                        disabled={blocked || active !== null}
                        onPress={() => {
                          if (blocked || !session.isCurrent()) return;
                          setError(null);
                          changeActive({
                            exerciseId: exercise.id,
                            set,
                            fields: { ...emptySetFields(), unit: set.unit, restSeconds: "0" },
                            timerIdentity:
                              workoutSetTimerIdentity(run, exercise.id, set.id) ?? undefined,
                          });
                        }}
                      />
                    )}
                    <Button
                      label={
                        result?.status === "completed" ? "Correct this set" : "Record completed set"
                      }
                      variant="soft"
                      disabled={blocked || active !== null}
                      onPress={() => {
                        setError(null);
                        changeActive({
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
                        onPress={() =>
                          save((results) => results.filter((item) => item.setId !== set.id))
                        }
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
          onChangeText={(value) => {
            setNote(value);
            persistFields(value, active);
          }}
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
                disabled={blocked || pending || syncing || offline || !onlineChecked}
                onPress={() => {
                  setShare(false);
                }}
              />
              <Chip
                label="Share my set counts"
                selected={share}
                disabled={blocked || pending || syncing || offline || !onlineChecked}
                onPress={() => {
                  setShare(true);
                }}
              />
            </Row>
            {share !== run.shareAccountability && (
              <Notice>Sharing changes need a live connection and fully synced results.</Notice>
            )}
          </>
        ) : (
          <T variant="caption" color="textSecondary">
            This is a private solo workout.
          </T>
        )}
        <Button
          label="Save note on this iPhone"
          variant="soft"
          disabled={blocked || active !== null}
          onPress={() => save()}
        />
      </Card>
      {run.sessionId && (
        <Button
          label="Update sharing online"
          variant="soft"
          disabled={
            blocked ||
            pending ||
            syncing ||
            offline ||
            !onlineChecked ||
            active !== null ||
            fieldWrites > 0 ||
            !!fieldError
          }
          onPress={() =>
            void action.run(
              async (signal) => {
                const freshLocal = (await offlineWorkouts.list(member.id, session.isCurrent)).find(
                  (item) => item.base.id === run.id,
                );
                if (!freshLocal || hasPendingRun(freshLocal) || freshLocal.active)
                  throw new Error("Sync your local edits before changing sharing.");
                const { run: latest } = await boundedWorkoutRequest<{ run: WorkoutRun }>(
                  session,
                  `/fitness/runs/${run.id}`,
                  { signal },
                );
                if (latest.revision !== entry.base.revision) {
                  await offlineWorkouts.remember(member.id, latest, session.isCurrent);
                  throw new Error("The saved workout changed. Review it before changing sharing.");
                }
                const { run: saved } = await boundedWorkoutRequest<{ run: WorkoutRun }>(
                  session,
                  `/fitness/runs/${run.id}`,
                  {
                    method: "PUT",
                    signal,
                    json: {
                      mutationId: Crypto.randomUUID(),
                      expectedRevision: latest.revision,
                      results: latest.results,
                      note: latest.note,
                      finish: latest.status === "completed",
                      shareAccountability: share,
                    },
                  },
                );
                await offlineWorkouts.remember(member.id, saved, session.isCurrent);
                return saved;
              },
              async (saved) => {
                setShare(saved.shareAccountability);
                await invalidate();
                refresh();
              },
            )
          }
        />
      )}
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
          <T variant="heading">
            Finish with {completed} completed set{completed === 1 ? "" : "s"}?
          </T>
          <T color="textSecondary">
            {skipped} set{skipped === 1 ? "" : "s"} skipped. {remaining} set
            {remaining === 1 ? " remains" : "s remain"} unrecorded and will not count as completed.
            Your session attendance is handled separately.
          </T>
          <Button
            label="Finish and save my workout"
            disabled={blocked}
            onPress={() => save((results) => results, true)}
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
            Delete your recorded sets, unsynced device changes and note? A connection is required.
            Any shared progress summary is removed. The shared plan and attendance record stay as
            they are.
          </Notice>
          <Button
            label="Delete this workout record"
            variant="danger"
            disabled={action.busy}
            onPress={() =>
              void action.run(
                (signal) =>
                  boundedWorkoutRequest(session, `/fitness/runs/${run.id}`, {
                    method: "DELETE",
                    signal,
                  }),
                async () => {
                  await offlineWorkouts.remove(member.id, run.id, session.isCurrent);
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
