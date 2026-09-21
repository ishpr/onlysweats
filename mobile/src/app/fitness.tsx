import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FitnessPilotPermissions, FitnessPilotResult } from "@/components/fitness-pilot";
import type {
  FitnessPilotConsent,
  FitnessLoggingSession,
  FitnessDraftMeasurement,
} from "../../../shared/fitness-outcomes";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Card, Chip, Field, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { takeFitnessDraft, type FitnessDraftHandoff } from "@/lib/assistant/draft-handoff";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import { useRefreshOnFocus } from "@/lib/queries";
import { localDateTime, parseLocalDateTime } from "@/lib/local-datetime";
import { prepareFitnessExport } from "@/lib/health/export";
import { sharePrivateExport } from "@/lib/health/export-share";
import {
  EXERCISE_CATALOGUE,
  FITNESS_AI_CONSENT_NOTICE,
  type ExerciseDraft,
  type ExerciseId,
  type FitnessConsent,
  type StrengthLog,
  type StrengthLogInput,
  type WeightUnit,
} from "../../../shared/fitness";

export default function FitnessRoute() {
  return <PrivateMember component={Fitness} />;
}

function Fitness({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const params = useLocalSearchParams<{ draftId?: string }>();
  const [importedDraft] = useState(() =>
    typeof params.draftId === "string" ? takeFitnessDraft(params.draftId, member.id) : null,
  );
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<StrengthLog | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [outcomeId, setOutcomeId] = useState<string | null>(null);
  const [showAiPermissions, setShowAiPermissions] = useState(false);
  const key = ["private-fitness", member.id];
  const consent = useQuery({
    queryKey: [...key, "consent"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ consent: FitnessConsent }>("/fitness/consent", { signal }),
  });
  const pilot = useQuery({
    queryKey: [...key, "pilot-consent"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ consent: FitnessPilotConsent }>("/fitness/pilot-consent", { signal }),
  });
  const logs = useQuery({
    queryKey: [...key, "logs", cursor],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ logs: StrengthLog[]; nextCursor: string | null }>(
        `/fitness/logs?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      ),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
  };
  const saved = async (measurementId?: string) => {
    setOutcomeId(measurementId ?? null);
    setEditing(null);
    setCursor(null);
    setFormVersion((value) => value + 1);
    await refresh();
  };
  return (
    <Screen onRefresh={() => void refresh()} refreshing={logs.isRefetching}>
      <Stack.Screen options={{ title: "Fitness log" }} />
      <T variant="heading">Your training, in your words</T>
      <T color="textSecondary">
        Log the exercise and sets you completed. Your entries stay private and separate from Apple
        Health measurements.
      </T>
      {params.draftId && !importedDraft && (
        <Notice>
          This local draft is no longer available. Enter your workout below, or return to the
          assistant to prepare it again.
        </Notice>
      )}
      <Button label="Apple Health workouts" variant="soft" onPress={() => router.push("/health")} />
      <Card>
        <T variant="heading">Optional AI assistance</T>
        {(consent.isPending || consent.error) && (
          <StateView
            loading={consent.isPending}
            error={consent.error}
            onRetry={() => void consent.refetch()}
          />
        )}
        {consent.data && (
          <>
            <T variant="label">
              {consent.data.consent.enabled ? "AI assistance is on" : "AI assistance is off"}
            </T>
            {!consent.data.consent.providerAvailable && (
              <Notice>AI assistance isn’t available yet. Logging by hand works without it.</Notice>
            )}
            <Button
              label={showAiPermissions ? "Hide AI permissions" : "Review AI permissions"}
              variant="soft"
              onPress={() => setShowAiPermissions((current) => !current)}
            />
            {showAiPermissions && (
              <>
                <T variant="caption" color="textSecondary">
                  {FITNESS_AI_CONSENT_NOTICE}
                </T>
                <Button
                  label={
                    consent.data.consent.enabled
                      ? "Turn off AI and remove interpretations"
                      : "Allow AI assistance (TypeSafe)"
                  }
                  variant="soft"
                  disabled={action.busy}
                  onPress={() =>
                    void action.run(
                      (signal) =>
                        session.request("/fitness/consent", {
                          method: "PUT",
                          json: { enabled: !consent.data!.consent.enabled },
                          signal,
                        }),
                      refresh,
                    )
                  }
                />
              </>
            )}
          </>
        )}
      </Card>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {pilot.data && (
        <FitnessPilotPermissions
          consent={pilot.data.consent}
          aiEnabled={Boolean(consent.data?.consent.enabled && !consent.error)}
          session={session}
          onChanged={refresh}
        />
      )}
      {pilot.error && (
        <Notice>
          The optional timing study isn’t available right now. You can keep logging exercises.
        </Notice>
      )}
      <LogEditor
        key={`${editing?.id ?? "new"}:${formVersion}:${consent.data?.consent.generation ?? "off"}`}
        session={session}
        consent={consent.error ? undefined : consent.data?.consent}
        pilotConsent={pilot.error ? undefined : pilot.data?.consent}
        initial={editing}
        importedDraft={!editing && formVersion === 0 ? importedDraft : null}
        disabled={action.busy}
        onSaved={saved}
        onCancel={() => {
          setEditing(null);
          setFormVersion((value) => value + 1);
        }}
      />
      <T variant="heading">Saved exercises</T>
      {(logs.isPending || logs.error) && (
        <StateView
          loading={logs.isPending}
          error={logs.error}
          onRetry={() => void logs.refetch()}
        />
      )}
      {logs.data?.logs.length === 0 && (
        <Notice>No exercises saved yet. Start with one exercise above.</Notice>
      )}
      {logs.data?.logs.map((log) => (
        <Card key={log.id}>
          <T variant="heading">
            {EXERCISE_CATALOGUE.find((exercise) => exercise.id === log.exerciseId)?.name ??
              "Exercise"}
          </T>
          <T variant="caption" color="textSecondary">
            Entered by you · {new Date(log.startedAt).toLocaleString()}
          </T>
          {log.sets.map((set, index) => (
            <T key={index}>
              Set {index + 1}: {set.reps} reps ·{" "}
              {set.unit === "bodyweight"
                ? "Bodyweight"
                : set.weight === null
                  ? "Weight not entered"
                  : `${set.weight} ${set.unit}`}
            </T>
          ))}
          <T variant="caption" color="textSecondary">
            {log.totalRepetitions} total reps
            {log.totalVolumeKg !== null
              ? ` · ${log.totalVolumeKg.toFixed(1)} kg of external load × reps`
              : " · Load total unavailable"}
          </T>
          {log.note ? <T>{log.note}</T> : null}
          {log.measurementSessionId &&
            pilot.data?.consent.enabled &&
            !pilot.error &&
            (outcomeId === log.measurementSessionId ? (
              <FitnessPilotResult
                key={outcomeId}
                id={outcomeId}
                ownerId={member.id}
                session={session}
                onDismiss={() => setOutcomeId(null)}
              />
            ) : (
              <Button
                label="Review logging outcome and optional feedback"
                variant="ghost"
                onPress={() => setOutcomeId(log.measurementSessionId!)}
              />
            ))}
          <Row>
            <Button
              label="Edit exercise"
              variant="soft"
              disabled={action.busy}
              onPress={() => setEditing(log)}
            />
            <Button
              label="Delete"
              variant="ghost"
              disabled={action.busy}
              onPress={() => setRemoveId(log.id)}
            />
          </Row>
          {removeId === log.id && (
            <>
              <Notice>Delete this exercise and its saved sets?</Notice>
              <Button
                label="Delete exercise"
                variant="danger"
                disabled={action.busy}
                onPress={() =>
                  void action.run(
                    (signal) =>
                      session.request(`/fitness/logs/${log.id}`, { method: "DELETE", signal }),
                    async () => {
                      setRemoveId(null);
                      if (editing?.id === log.id) setEditing(null);
                      await refresh();
                    },
                  )
                }
              />
              <Button label="Keep exercise" variant="ghost" onPress={() => setRemoveId(null)} />
            </>
          )}
        </Card>
      ))}
      {logs.data?.nextCursor && (
        <Button
          label="Older exercises"
          variant="soft"
          onPress={() => setCursor(logs.data!.nextCursor)}
        />
      )}
      {cursor && (
        <Button label="Most recent exercises" variant="ghost" onPress={() => setCursor(null)} />
      )}
      <Card>
        <T variant="label">Export your fitness log</T>
        <T variant="caption" color="textSecondary">
          Save all exercise logs, workout corrections, stored AI interpretations and optional pilot
          outcomes. Apple Health source records have their own export on the Apple Health screen.
        </T>
        <Button
          label="Export fitness data"
          variant="soft"
          loading={action.busy}
          disabled={action.busy}
          onPress={() =>
            void action.run(async (signal) => {
              const contents = await prepareFitnessExport(session, signal);
              await sharePrivateExport(contents, () => session.isCurrent() && !signal.aborted);
            })
          }
        />
      </Card>
    </Screen>
  );
}

type SetFields = { reps: string; weight: string; unit: WeightUnit | null };
const emptySet = (): SetFields => ({ reps: "", weight: "", unit: "kg" });

function LogEditor({
  session,
  consent,
  pilotConsent,
  initial,
  importedDraft,
  disabled,
  onSaved,
  onCancel,
}: {
  session: ApiSession;
  consent?: FitnessConsent;
  pilotConsent?: FitnessPilotConsent;
  initial: StrengthLog | null;
  importedDraft?: FitnessDraftHandoff | null;
  disabled: boolean;
  onSaved: (measurementId?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const action = usePrivateAction(session);
  const [exerciseId, setExercise] = useState<ExerciseId | null>(
    initial?.exerciseId ?? (importedDraft ? draftExerciseId(importedDraft.exerciseName) : null),
  );
  const [startedAt, setStartedAt] = useState(() =>
    importedDraft ? "" : localDateTime(initial?.startedAt),
  );
  const [note, setNote] = useState(initial?.note ?? importedDraft?.note ?? "");
  const [completionConfirmed, setCompletionConfirmed] = useState(!importedDraft);
  const [sets, setSets] = useState<SetFields[]>(
    () =>
      initial?.sets.map((set) => ({
        reps: String(set.reps),
        weight: set.weight === null ? "" : String(set.weight),
        unit: set.unit,
      })) ??
      (importedDraft
        ? Array.from({ length: importedDraft.sets ?? 0 }, () => ({
            reps: importedDraft.reps === null ? "" : String(importedDraft.reps),
            weight: importedDraft.weight === null ? "" : String(importedDraft.weight),
            unit: importedDraft.unit,
          }))
        : [emptySet()]),
  );
  const [measurement, setMeasurement] = useState<{
    session: FitnessLoggingSession;
    generation: string | null;
  } | null>(null);
  const [appliedDraft, setAppliedDraft] = useState<FitnessDraftMeasurement | null>(null);
  const [measurementError, setMeasurementError] = useState<string | null>(null);
  const activeMeasurement =
    pilotConsent?.enabled && measurement?.generation === pilotConsent.generation && !initial
      ? measurement?.session
      : null;
  const [draft, setDraft] = useState<ExerciseDraft | null>(null);
  const busy = disabled || action.busy;
  const updateSet = (index: number, patch: Partial<SetFields>) =>
    setSets((current) => current.map((set, i) => (i === index ? { ...set, ...patch } : set)));
  const save = () =>
    action.run(
      async (signal) => {
        if (!completionConfirmed)
          throw new Error("Confirm that you completed these sets before saving.");
        if (!exerciseId) throw new Error("Choose the exercise you completed.");
        if (exerciseId === "other" && !note.trim())
          throw new Error("Describe the exercise in your note.");
        if (!sets.length) throw new Error("Add the sets you completed.");
        const input: StrengthLogInput = {
          startedAt: parseLocalDateTime(startedAt),
          exerciseId,
          note: note.trim(),
          sets: sets.map((set, index) => {
            if (!set.unit)
              throw new Error(`Choose the weight unit or bodyweight for set ${index + 1}.`);
            const reps = Number(set.reps);
            const weight =
              set.unit === "bodyweight" || !set.weight.trim() ? null : Number(set.weight);
            if (!set.reps.trim() || !Number.isInteger(reps) || reps < 1 || reps > 1000)
              throw new Error(`Enter 1–1000 whole reps for set ${index + 1}.`);
            if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 2000))
              throw new Error(`Check the weight for set ${index + 1}.`);
            return { reps, weight, unit: set.unit };
          }),
        };
        return session.request<{ log: StrengthLog }>(
          initial ? `/fitness/logs/${initial.id}` : "/fitness/logs",
          {
            method: initial ? "PUT" : "POST",
            json: initial
              ? { ...input, expectedRevision: initial.revision }
              : {
                  ...input,
                  ...(activeMeasurement
                    ? {
                        measurement: {
                          sessionId: activeMeasurement.id,
                          ...(appliedDraft?.sessionId === activeMeasurement.id
                            ? { draftId: appliedDraft.draftId }
                            : {}),
                        },
                      }
                    : {}),
                },
            signal,
          },
        );
      },
      async ({ log }) => {
        await onSaved(log.measurementSessionId);
      },
    );
  return (
    <Card>
      <T variant="heading">{initial ? "Edit your exercise" : "Log an exercise"}</T>
      {importedDraft && (
        <>
          <Notice>
            {importedDraft.intent === "planned"
              ? "Imported from a workout plan."
              : importedDraft.intent === "completed"
                ? "Imported from a description of completed activity."
                : "The source did not establish whether this workout was completed."}{" "}
            Review the draft, enter when you trained and confirm only sets you actually completed.
          </Notice>
          <Chip
            label="I completed these sets"
            selected={completionConfirmed}
            disabled={busy}
            onPress={() => setCompletionConfirmed((value) => !value)}
          />
        </>
      )}
      {pilotConsent?.enabled && !initial && (
        <>
          <T variant="caption" color="textSecondary">
            {activeMeasurement
              ? "This attempt has optional pilot measurement on. Timing includes pauses; save your exercise whenever you are ready."
              : "Optionally start a measurement for this new attempt. Your exercise saves even if measurement is unavailable."}
          </T>
          {!activeMeasurement && (
            <Button
              label="Measure this logging attempt"
              variant="ghost"
              disabled={busy}
              onPress={() =>
                void action.run(
                  async (signal) => {
                    setMeasurementError(null);
                    try {
                      return await session.request<{ measurement: FitnessLoggingSession | null }>(
                        "/fitness/logging-sessions",
                        { method: "POST", json: {}, signal },
                      );
                    } catch {
                      return { measurement: null };
                    }
                  },
                  (result) => {
                    if (result.measurement) {
                      setMeasurement({
                        session: result.measurement,
                        generation: pilotConsent.generation,
                      });
                      setAppliedDraft(null);
                    } else
                      setMeasurementError(
                        "Measurement could not start. You can still save your exercise normally.",
                      );
                  },
                )
              }
            />
          )}
          {measurementError && <Notice>{measurementError}</Notice>}
        </>
      )}
      <Field
        label="What did you do?"
        placeholder="For example: bench press, 3 sets of 8 at 60 kg"
        multiline
        maxLength={1000}
        value={note}
        editable={!busy}
        onChangeText={(value) => {
          setNote(value);
          setDraft(null);
        }}
      />
      {consent?.enabled && (
        <Button
          label="Prepare editable draft with Jev"
          variant="soft"
          loading={action.busy}
          disabled={busy || !note.trim() || !consent.providerAvailable}
          onPress={() =>
            void action.run(
              (signal) => {
                setAppliedDraft(null);
                return session.request<{ draft: ExerciseDraft }>("/fitness/draft", {
                  method: "POST",
                  json: {
                    note,
                    ...(activeMeasurement ? { loggingSessionId: activeMeasurement.id } : {}),
                  },
                  signal,
                });
              },
              ({ draft: result }) => {
                setDraft(result);
                if (result.status !== "available") return;
                setAppliedDraft(result.measurement ?? null);
                setExercise(result.exerciseId);
                const count =
                  result.sets !== null && result.sets >= 1 && result.sets <= 50 ? result.sets : 0;
                setSets(
                  Array.from({ length: count }, () => ({
                    reps: result.reps === null ? "" : String(result.reps),
                    weight: result.weight === null ? "" : String(result.weight),
                    unit: result.unit,
                  })),
                );
              },
            )
          }
        />
      )}
      {draft && (
        <Notice>
          {draft.status === "provider_unavailable"
            ? "Jev is unavailable. You can enter the exercise manually."
            : draft.status === "insufficient_data"
              ? "The note did not contain enough clear information. Please fill the fields yourself."
              : `This is an AI draft, not a measured workout. Check every field before saving.${draft.missingFields.length ? ` Still needed: ${draft.missingFields.join(", ")}.` : ""}`}
        </Notice>
      )}
      <T variant="label">Exercise</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {EXERCISE_CATALOGUE.map((exercise) => (
          <Chip
            key={exercise.id}
            label={exercise.name}
            selected={exerciseId === exercise.id}
            disabled={busy}
            onPress={() => setExercise(exercise.id)}
          />
        ))}
      </View>
      <Field
        label="Started at (YYYY-MM-DD HH:mm, local time)"
        value={startedAt}
        onChangeText={setStartedAt}
        editable={!busy}
        autoCapitalize="none"
      />
      {sets.map((set, index) => (
        <View key={index} style={{ gap: 8 }}>
          <T variant="label">Set {index + 1}</T>
          <Field
            label={`Reps in set ${index + 1}`}
            value={set.reps}
            keyboardType="number-pad"
            editable={!busy}
            onChangeText={(reps) => updateSet(index, { reps })}
          />
          <Row style={{ flexWrap: "wrap" }}>
            {(["kg", "lb", "bodyweight"] as const).map((unit) => (
              <Chip
                key={unit}
                label={unit === "bodyweight" ? "Bodyweight" : unit}
                selected={set.unit === unit}
                disabled={busy}
                onPress={() =>
                  updateSet(index, { unit, ...(unit === "bodyweight" ? { weight: "" } : {}) })
                }
              />
            ))}
          </Row>
          {set.unit && set.unit !== "bodyweight" && (
            <Field
              label={`Weight in ${set.unit} (optional)`}
              value={set.weight}
              keyboardType="decimal-pad"
              editable={!busy}
              onChangeText={(weight) => updateSet(index, { weight })}
            />
          )}
          {sets.length > 1 && (
            <Button
              label={`Remove set ${index + 1}`}
              variant="ghost"
              disabled={busy}
              onPress={() => setSets((current) => current.filter((_, i) => i !== index))}
            />
          )}
        </View>
      ))}
      <Button
        label="Add set"
        variant="soft"
        disabled={busy || sets.length >= 50}
        onPress={() => setSets((current) => [...current, emptySet()])}
      />
      <T variant="caption" color="textSecondary">
        Empty weights remain unknown. Totals use your saved entries; we never estimate your body
        weight or fill missing reps.
      </T>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button
        label={initial ? "Save changes" : "Save exercise"}
        disabled={busy || !completionConfirmed}
        loading={action.busy}
        onPress={() => void save()}
      />
      <Button
        label={initial ? "Cancel editing" : "Clear form"}
        variant="ghost"
        disabled={busy}
        onPress={onCancel}
      />
    </Card>
  );
}

function draftExerciseId(name: string): ExerciseId | null {
  const normalized = name.trim().toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  return (
    EXERCISE_CATALOGUE.find(
      (item) =>
        item.id.replace(/_/g, " ") === normalized ||
        item.name.toLowerCase().replace(/-/g, " ") === normalized,
    )?.id ?? null
  );
}
