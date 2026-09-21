import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { WorkoutLocalRecap } from "@/components/workout-local-recap";
import { Button, Card, Chip, Field, Notice, Screen, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import { useRefreshOnFocus } from "@/lib/queries";
import type { PrivateWorkout, WorkoutRecord } from "../../../../shared/health";
import {
  WORKOUT_INTERPRETATION_LABELS,
  type FitnessConsent,
  type WorkoutAssessment,
  type WorkoutCorrection,
} from "../../../../shared/fitness";

export default function WorkoutRoute() {
  return <PrivateMember component={Workout} />;
}

function Workout({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const query = useQuery({
    queryKey: ["private-health", member.id, "detail", id],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ workout: PrivateWorkout }>(`/health/workouts/${encodeURIComponent(id)}`, {
        signal,
      }),
  });
  const correction = useQuery({
    queryKey: ["private-fitness", member.id, "correction", id],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ correction: WorkoutCorrection | null }>(
        `/fitness/workouts/${encodeURIComponent(id)}/correction`,
        { signal },
      ),
  });
  const consent = useQuery({
    queryKey: ["private-fitness", member.id, "consent"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ consent: FitnessConsent }>("/fitness/consent", { signal }),
  });
  return (
    <Screen>
      <Stack.Screen options={{ title: "Workout details" }} />
      {(query.isPending || query.error) && (
        <StateView
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && !query.error && (
        <>
          <WorkoutFacts workout={query.data.workout} correction={correction.data?.correction} />
          <WorkoutLocalRecap
            key={JSON.stringify([query.data.workout, correction.data?.correction ?? null])}
            session={session}
            summary={{
              activity: query.data.workout.record.activity,
              durationSeconds: query.data.workout.record.durationSeconds,
              distanceMeters: query.data.workout.record.distanceMeters,
              averageHeartRateBpm: query.data.workout.heartRate.sampleMeanBpm,
              activeEnergyKcal: query.data.workout.record.activeEnergyKilocalories,
              memberNote: correction.error
                ? undefined
                : (correction.data?.correction?.note ?? undefined),
            }}
          />
          {(correction.isPending || correction.error) && (
            <StateView
              loading={correction.isPending}
              error={correction.error}
              onRetry={() => void correction.refetch()}
            />
          )}
          {correction.data && !correction.error && (
            <CorrectionEditor
              key={`${id}:${correction.data.correction?.revision ?? 0}`}
              session={session}
              workoutId={id}
              initial={correction.data.correction}
              onSaved={() => correction.refetch()}
            />
          )}
          <WorkoutReflection
            key={`${id}:${query.data.workout.revision}:${JSON.stringify(query.data.workout.heartRate)}:${correction.data?.correction?.revision ?? 0}:${consent.data?.consent.generation ?? "off"}`}
            session={session}
            ownerId={member.id}
            workoutId={id}
            consent={consent.error ? undefined : consent.data?.consent}
          />
        </>
      )}
    </Screen>
  );
}

function WorkoutFacts({
  workout,
  correction,
}: {
  workout: PrivateWorkout;
  correction?: WorkoutCorrection | null;
}) {
  const pace =
    workout.paceSecondsPerKilometer === null ? null : Math.round(workout.paceSecondsPerKilometer);
  return (
    <Card>
      <T variant="heading">
        {correction?.title ?? correction?.activity ?? workout.record.activity}
      </T>
      <T variant="caption" color="textSecondary">
        {new Date(workout.record.startAt).toLocaleString()} · {workout.record.source.name}
      </T>
      <T variant="label">Recorded in Apple Health</T>
      <T>Activity: {workout.record.activity}</T>
      <T>
        {(workout.record.durationSeconds / 60).toFixed(1)} active minutes ·{" "}
        {(workout.elapsedSeconds / 60).toFixed(1)} elapsed minutes
      </T>
      <T>
        {workout.record.distanceMeters === null
          ? "Distance unavailable"
          : `${(workout.record.distanceMeters / 1000).toFixed(2)} km`}
      </T>
      <T>
        {workout.record.activeEnergyKilocalories === null
          ? "Active energy unavailable"
          : `${Math.round(workout.record.activeEnergyKilocalories)} kcal active energy`}
      </T>
      {pace !== null && (
        <T>
          Calculated active pace: {Math.floor(pace / 60)}:{String(pace % 60).padStart(2, "0")} /km
        </T>
      )}
      <T variant="label">Heart-rate samples</T>
      <T>
        {workout.heartRate.sampleMeanBpm === null
          ? "No matching readings"
          : `${Math.round(workout.heartRate.sampleMeanBpm)} bpm average · ${workout.heartRate.minBpm}–${workout.heartRate.maxBpm} bpm range`}
      </T>
      <T variant="caption" color="textSecondary">
        {workout.heartRate.sampleCount} readings from the workout’s recording source. The average is
        calculated across samples, not over time. This is recorded history, not a live pulse.
      </T>
      {workout.record.zones?.map((group) => (
        <View key={group.metric} style={{ gap: 4 }}>
          <T variant="label">
            {group.metric === "heart_rate" ? "Heart-rate" : "Cycling-power"} zones
          </T>
          <T variant="caption" color="textSecondary">
            Recorded thresholds ·{" "}
            {group.source === "system"
              ? "Apple Health system"
              : group.source === "user"
                ? "Your Health settings"
                : "Recording app"}
          </T>
          {group.zones.map((zone) => (
            <T key={zone.index}>
              Zone {zone.index + 1}: {zone.minimum ?? "below"}–{zone.maximum ?? "and above"}{" "}
              {group.unit} ·{" "}
              {zone.durationSeconds === null
                ? "duration unavailable"
                : `${(zone.durationSeconds / 60).toFixed(1)} min`}
            </T>
          ))}
        </View>
      ))}
      {!workout.record.zones?.length && (
        <T variant="caption" color="textSecondary">
          Source-reported workout zones unavailable. We do not estimate missing zones.
        </T>
      )}
      {correction && (
        <>
          <T variant="label">Your correction</T>
          {correction.activity && <T>Activity: {correction.activity}</T>}
          {correction.note && <T>{correction.note}</T>}
          <T variant="caption" color="textSecondary">
            Saved separately from the source. Future syncs keep this correction.
          </T>
        </>
      )}
    </Card>
  );
}

function CorrectionEditor({
  session,
  workoutId,
  initial,
  onSaved,
}: {
  session: ApiSession;
  workoutId: string;
  initial: WorkoutCorrection | null;
  onSaved: () => Promise<unknown>;
}) {
  const action = usePrivateAction(session);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [activity, setActivity] = useState<WorkoutRecord["activity"] | null>(
    initial?.activity ?? null,
  );
  return (
    <Card>
      <T variant="heading">Add a correction</T>
      <T variant="caption" color="textSecondary">
        Give the workout a name, correct its activity, or leave a note. The original measurements
        stay visible above.
      </T>
      <Field
        label="Your workout name (optional)"
        maxLength={100}
        value={title}
        onChangeText={setTitle}
        editable={!action.busy}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip
          label="Keep source activity"
          selected={activity === null}
          disabled={action.busy}
          onPress={() => setActivity(null)}
        />
        {(["run", "walk", "ride", "hike", "strength", "mobility", "other"] as const).map((type) => (
          <Chip
            key={type}
            label={type}
            selected={activity === type}
            disabled={action.busy}
            onPress={() => setActivity(type)}
          />
        ))}
      </View>
      <Field
        label="Your note (optional)"
        multiline
        maxLength={1000}
        value={note}
        onChangeText={setNote}
        editable={!action.busy}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button
        label="Save correction"
        loading={action.busy}
        disabled={action.busy}
        onPress={() =>
          void action.run(
            (signal) =>
              session.request(`/fitness/workouts/${encodeURIComponent(workoutId)}/correction`, {
                method: "PUT",
                json: {
                  expectedRevision: initial?.revision ?? 0,
                  title: title.trim() || null,
                  note: note.trim() || null,
                  activity,
                },
                signal,
              }),
            async () => {
              await onSaved();
            },
          )
        }
      />
    </Card>
  );
}

function WorkoutReflection({
  session,
  ownerId,
  workoutId,
  consent,
}: {
  session: ApiSession;
  ownerId: string;
  workoutId: string;
  consent?: FitnessConsent;
}) {
  const router = useRouter();
  const action = usePrivateAction(session);
  const [goal, setGoal] = useState("");
  const [note, setNote] = useState("");
  const [assessment, setAssessment] = useState<WorkoutAssessment | null>(null);
  const saved = useQuery({
    queryKey: ["private-fitness", ownerId, "assessment", workoutId, consent?.generation],
    gcTime: 0,
    retry: false,
    enabled: consent?.enabled === true,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      session.request<{ assessment: WorkoutAssessment | null }>(
        `/fitness/workouts/${encodeURIComponent(workoutId)}/assessment`,
        { signal },
      ),
  });
  const current = consent?.enabled
    ? (assessment ?? (!goal && !note && !saved.error ? (saved.data?.assessment ?? null) : null))
    : null;
  return (
    <Card>
      <T variant="heading">Reflect on this workout</T>
      <T variant="caption" color="textSecondary">
        Jev can interpret how your note relates to a goal you enter. This does not assess recovery,
        health or physiological effort.
      </T>
      {!consent?.enabled ? (
        <Button
          label="Choose AI preferences in Fitness log"
          variant="soft"
          onPress={() => router.push("/fitness")}
        />
      ) : (
        <>
          {!consent.providerAvailable && (
            <Notice>AI assistance is not available on this server yet.</Notice>
          )}
          <Field
            label="What was your goal?"
            value={goal}
            maxLength={300}
            editable={!action.busy}
            onChangeText={(value) => {
              setGoal(value);
              setAssessment(null);
            }}
          />
          <Field
            label="How did it go?"
            multiline
            value={note}
            maxLength={1000}
            editable={!action.busy}
            onChangeText={(value) => {
              setNote(value);
              setAssessment(null);
            }}
          />
          <Button
            label="Interpret my note with Jev"
            loading={action.busy}
            disabled={action.busy || !goal.trim() || !note.trim() || !consent.providerAvailable}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request<{ assessment: WorkoutAssessment }>(
                    `/fitness/workouts/${encodeURIComponent(workoutId)}/assessment`,
                    {
                      method: "POST",
                      json: { goal, note },
                      signal,
                    },
                  ),
                ({ assessment: result }) => setAssessment(result),
              )
            }
          />
        </>
      )}
      {current?.request && (
        <View style={{ gap: 4 }}>
          <T variant="label">Saved reflection</T>
          <T>Goal: {current.request.goal}</T>
          <T>Your note: {current.request.note}</T>
        </View>
      )}
      {current && (
        <Notice>
          {current.status === "provider_unavailable"
            ? "Jev could not respond. Your workout is unchanged."
            : current.interpretation
              ? WORKOUT_INTERPRETATION_LABELS[current.interpretation]
              : "There is not enough information for an interpretation."}
        </Notice>
      )}
      {current?.metadata && (
        <T variant="caption" color="textSecondary">
          AI interpretation · {current.metadata.model} ·{" "}
          {new Date(current.metadata.assessedAt).toLocaleString()}. This does not change your
          workout or sharing preferences.
        </T>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button label="Log exercise sets" variant="ghost" onPress={() => router.push("/fitness")} />
    </Card>
  );
}
