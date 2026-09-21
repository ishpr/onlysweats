import { useState } from "react";
import { Switch, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { useHealthSync } from "@/hooks/use-health-sync";
import { useTheme } from "@/hooks/use-theme";
import { captureApiSession, type ApiSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMe } from "@/lib/queries";
import { clearPrivateHealthCache } from "@/lib/health/cache";
import { usePrivateAction } from "@/hooks/use-private-action";
import { prepareHealthExport } from "@/lib/health/export";
import { sharePrivateExport } from "@/lib/health/export-share";
import type { HealthDataType, PrivateWorkout } from "../../../shared/health";

const OPTIONAL_TYPES: { type: HealthDataType; label: string }[] = [
  { type: "heart_rate", label: "Heart rate" },
  { type: "resting_heart_rate", label: "Resting heart rate" },
  { type: "heart_rate_variability", label: "Heart rate variability (SDNN)" },
  { type: "heart_rate_variability_rmssd", label: "Heart rate variability (RMSSD, iOS 27)" },
  { type: "cycling_power", label: "Cycling power" },
  { type: "sleep", label: "Sleep" },
  { type: "steps", label: "Steps" },
  { type: "distance", label: "Walking and running distance" },
  { type: "active_energy", label: "Active energy" },
  { type: "blood_glucose", label: "Blood glucose" },
];

/** Standalone integration route; the redesign can link here or reuse the hook. */
export default function HealthRoute() {
  const { signedIn } = useAuth();
  if (signedIn === null) return null;
  if (!signedIn) return <Redirect href="/sign-in" />;
  return <MemberHealth />;
}

function MemberHealth() {
  const me = useMe();
  if (!me.data) {
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  return <HealthSession key={me.data.id} ownerId={me.data.id} />;
}

function HealthSession({ ownerId }: { ownerId: string }) {
  const [session] = useState(captureApiSession);
  if (!session)
    return (
      <Screen>
        <Notice>Sign in again to open your private workouts.</Notice>
      </Screen>
    );
  return <HealthSettings ownerId={ownerId} session={session} />;
}

function HealthSettings({ ownerId, session }: { ownerId: string; session: ApiSession }) {
  const router = useRouter();
  const theme = useTheme();
  const health = useHealthSync({ ownerId, session });
  const exporting = usePrivateAction(session);
  const [exportCount, setExportCount] = useState(0);
  const [automaticChoice, setAutomaticChoice] = useState<boolean | null>(null);
  const automaticSync = automaticChoice ?? health.connection?.automaticSync ?? false;
  const [selection, setSelection] = useState<{
    generation: string | null;
    types: HealthDataType[];
  } | null>(null);
  const generation = health.connection?.generation ?? null;
  const types: HealthDataType[] =
    selection && selection.generation === generation
      ? selection.types
      : (health.connection?.types ?? ["workout", "heart_rate"]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [viewRevision, setViewRevision] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [confirmation, setConfirmation] = useState<
    { action: "disconnect" } | { action: "remove"; id: string } | null
  >(null);
  const queryClient = useQueryClient();
  const workouts = useQuery({
    queryKey: ["private-health", ownerId, "workouts", viewRevision, cursor],
    queryFn: ({ signal }) =>
      session.request<{ workouts: PrivateWorkout[]; nextCursor: string | null }>(
        `/health/workouts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      ),
    retry: false,
  });
  const busy =
    removing ||
    exporting.busy ||
    ["loading", "connecting", "syncing", "disconnecting"].includes(health.phase);
  const selectionChanged = Boolean(
    health.connection &&
    ([...types].sort().join(",") !== [...health.connection.types].sort().join(",") ||
      automaticSync !== (health.connection.automaticSync === true)),
  );
  const refreshWorkouts = async () => {
    await clearPrivateHealthCache(queryClient, ownerId);
    if (!session.isCurrent()) return;
    setCursor(null);
    setViewRevision((current) => current + 1);
  };
  const sync = async () => {
    await health.sync();
    await refreshWorkouts();
  };
  const connect = async () => {
    await health.connect(types, automaticSync);
    await refreshWorkouts();
  };
  const confirmRemoval = async () => {
    if (!confirmation) return;
    setRemoving(true);
    setActionError(null);
    try {
      if (confirmation.action === "disconnect") await health.disconnect();
      else
        await session.request(`/health/workouts/${encodeURIComponent(confirmation.id)}`, {
          method: "DELETE",
        });
      await refreshWorkouts();
      if (session.isCurrent()) setConfirmation(null);
    } catch {
      if (session.isCurrent()) setActionError("Could not remove the data. Please try again.");
    } finally {
      if (session.isCurrent()) setRemoving(false);
    }
  };
  const confirmControls = confirmation && (
    <View style={{ gap: 8 }}>
      <T variant="label">
        {confirmation.action === "disconnect"
          ? "Disconnect and delete synced data?"
          : "Remove this workout?"}
      </T>
      <T color="textSecondary">
        {confirmation.action === "disconnect"
          ? "This removes your imported workouts and readings from SamePace. You can reconnect later to import again. Apple Health stays unchanged."
          : "This workout stays in Apple Health. Regular syncing will not bring it back to SamePace."}
      </T>
      <Button
        label={confirmation.action === "disconnect" ? "Disconnect and delete" : "Remove workout"}
        variant="danger"
        loading={removing}
        disabled={busy}
        onPress={() => void confirmRemoval()}
      />
      <Button
        label="Keep data"
        variant="ghost"
        disabled={busy}
        onPress={() => setConfirmation(null)}
      />
    </View>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: "Apple Health" }} />
      <T variant="heading">Your workouts, in one place</T>
      <T color="textSecondary">
        Connect Apple Health to sync workouts and your selected readings to your private SamePace
        account. They are not shared with other members. AI assistance has a separate opt-in under
        Fitness log.
      </T>
      <Card>
        <T variant="label">Record with Apple Watch</T>
        <T variant="caption" color="textSecondary">
          Start and finish on your Watch. Saved workouts arrive through Apple Health; a connection
          here is required to display readings or import them.
        </T>
        {health.watchSnapshot && (
          <View style={{ gap: 4 }}>
            <T>
              {health.watchSnapshot.state === "paused" ? "Paused" : "Recording"} ·{" "}
              {health.watchSnapshot.activity}
            </T>
            <T>
              {Math.floor(health.watchSnapshot.elapsedSeconds / 60)} minutes ·{" "}
              {health.watchSnapshot.heartRateBpm === null
                ? "Heart rate unavailable"
                : `${Math.round(health.watchSnapshot.heartRateBpm)} bpm`}
            </T>
            {health.watchSnapshot.distanceMeters !== null && (
              <T>{(health.watchSnapshot.distanceMeters / 1000).toFixed(2)} km</T>
            )}
          </View>
        )}
        <Button
          label="Open Watch recorder"
          variant="soft"
          disabled={health.availability !== "available"}
          onPress={() =>
            void health
              .openWatch()
              .catch(() =>
                setActionError(
                  "Could not open the Watch app. Check that SamePace is installed on your paired Apple Watch.",
                ),
              )
          }
        />
      </Card>
      <Card>
        <T variant="label">Choose what to sync</T>
        <T variant="caption" color="textSecondary">
          Workouts are included. Add only the readings you want to keep here.
        </T>
        {OPTIONAL_TYPES.filter(
          ({ type }) => !health.supportedTypes || health.supportedTypes.includes(type),
        ).map(({ type, label }) => (
          <Row key={type}>
            <T style={{ flex: 1 }}>{label}</T>
            <Switch
              accessibilityLabel={`Sync ${label.toLowerCase()}`}
              disabled={busy || health.availability !== "available"}
              trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
              value={types.includes(type)}
              onValueChange={(on) =>
                setSelection({
                  generation,
                  types: on ? [...types, type] : types.filter((value) => value !== type),
                })
              }
            />
          </Row>
        ))}
        <T variant="caption" color="textSecondary">
          Starts with the last 30 days. Heart-rate and cycling-power choices also include
          source-reported workout zones, when available. Readings may arrive later from your watch.
          This is not a live heartbeat monitor.
        </T>
        <T variant="caption" color="textSecondary">
          Synced records stay until you remove them, disconnect, or delete your account. Save your
          choices to apply them. Saving removes any deselected reading types from SamePace. Import
          does not write to Apple Health. Workouts you record separately on the SamePace Watch app
          are saved there with your permission.
        </T>
        <Row>
          <T style={{ flex: 1 }}>Sync automatically when I open SamePace</T>
          <Switch
            accessibilityLabel="Automatic Apple Health sync"
            value={automaticSync}
            disabled={busy}
            onValueChange={setAutomaticChoice}
          />
        </Row>
        <T variant="caption" color="textSecondary">
          When enabled, Apple Health can notify this iPhone of changes in the background. Uploads
          resume while SamePace is open and you are signed in. No background login token is saved.
        </T>
        <Button
          label={health.connection ? "Update Apple Health connection" : "Connect Apple Health"}
          disabled={busy || health.availability !== "available"}
          onPress={() => void connect()}
        />
        {health.availability === "unavailable" && (
          <Notice>
            Apple Health needs a supported iPhone build. Your existing synced workouts remain
            available below.
          </Notice>
        )}
        {health.promptCompleted && (
          <T variant="caption" color="textSecondary">
            Your Health permission choices stay in Apple Health. An empty result can mean no records
            or no read access.
          </T>
        )}
      </Card>
      {health.connection && (
        <Card>
          <T variant="label">
            {health.phase === "syncing" ? "Syncing your readings…" : "Connection saved"}
          </T>
          <T variant="caption" color="textSecondary">
            {health.connection.lastSyncedAt
              ? `Last sync update: ${new Date(health.connection.lastSyncedAt).toLocaleString()}`
              : "Ready for your first sync."}
          </T>
          {health.hasMore && (
            <Notice>There are more records to import. Continue syncing to catch up.</Notice>
          )}
          {selectionChanged && <Notice>Save your changed choices before syncing again.</Notice>}
          <Button
            label={health.hasMore ? "Continue sync" : "Sync now"}
            loading={health.phase === "syncing"}
            disabled={busy || selectionChanged || health.availability !== "available"}
            onPress={() => void sync()}
          />
          <Button
            label="Disconnect and delete synced data"
            variant="ghost"
            disabled={busy}
            onPress={() => setConfirmation({ action: "disconnect" })}
          />
          {confirmation?.action === "disconnect" && confirmControls}
        </Card>
      )}
      {health.error && <Notice tone="danger">{health.error}</Notice>}
      {health.phase === "error" && (
        <Button
          label="Check connection again"
          variant="soft"
          onPress={() => void health.refresh()}
        />
      )}
      <Card>
        <T variant="label">Keep a copy</T>
        <T variant="caption" color="textSecondary">
          Export all your synced workout and reading records as a JSON file. You choose where to
          save this private information.
        </T>
        <Button
          label={
            exporting.busy
              ? `Preparing ${exportCount.toLocaleString()} records…`
              : "Export Apple Health data"
          }
          loading={exporting.busy}
          disabled={busy}
          variant="soft"
          onPress={() =>
            void exporting.run(async (signal) => {
              setExportCount(0);
              const contents = await prepareHealthExport(session, signal, setExportCount);
              await sharePrivateExport(contents, () => session.isCurrent() && !signal.aborted);
            })
          }
        />
        {exporting.error && <Notice tone="danger">{exporting.error}</Notice>}
        <Button label="Open fitness log" variant="ghost" onPress={() => router.push("/fitness")} />
      </Card>
      <T variant="heading">Private workouts</T>
      <T variant="caption" color="textSecondary">
        Imported exercise is separate from your SamePace attendance and training-block progress.
      </T>
      {actionError && <Notice tone="danger">{actionError}</Notice>}
      {(workouts.isPending || workouts.error) && (
        <StateView
          loading={workouts.isPending}
          error={workouts.error}
          onRetry={() => void workouts.refetch()}
        />
      )}
      {workouts.data?.workouts.length === 0 && (
        <Notice>
          No workouts are available here yet. Connect and sync, or check your read permissions in
          Apple Health.
        </Notice>
      )}
      {workouts.data?.workouts.map((workout) => (
        <Card key={workout.id}>
          <Row>
            <T variant="heading" style={{ flex: 1 }}>
              {workout.record.activity === "other" ? "Workout" : workout.record.activity}
            </T>
          </Row>
          <T variant="caption" color="textSecondary">
            {new Date(workout.record.startAt).toLocaleString()} · {workout.record.source.name}
          </T>
          <View style={{ gap: 4 }}>
            <T>{Math.round(workout.record.durationSeconds / 60)} active minutes</T>
            {workout.record.distanceMeters !== null && (
              <T>{(workout.record.distanceMeters / 1000).toFixed(2)} km recorded</T>
            )}
            {workout.record.activeEnergyKilocalories !== null && (
              <T>{Math.round(workout.record.activeEnergyKilocalories)} kcal recorded</T>
            )}
            <T>
              {workout.heartRate.sampleMeanBpm === null
                ? "Heart rate unavailable"
                : `${Math.round(workout.heartRate.sampleMeanBpm)} bpm sample average · ${workout.heartRate.sampleCount} readings`}
            </T>
          </View>
          <Button
            label="Details and corrections"
            variant="soft"
            onPress={() => router.push({ pathname: "/workout/[id]", params: { id: workout.id } })}
          />
          <Button
            label="Remove workout"
            variant="ghost"
            disabled={busy}
            onPress={() => setConfirmation({ action: "remove", id: workout.id })}
          />
          {confirmation?.action === "remove" && confirmation.id === workout.id && confirmControls}
        </Card>
      ))}
      {workouts.data?.nextCursor && (
        <Button
          label="Older workouts"
          variant="soft"
          onPress={() => setCursor(workouts.data!.nextCursor)}
        />
      )}
      {cursor && (
        <Button label="Most recent workouts" variant="ghost" onPress={() => setCursor(null)} />
      )}
    </Screen>
  );
}
