/** A source-only summary of the member's private synced history. */
import { useState } from "react";
import { useRouter } from "expo-router";
import { HeartPulse } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Notice, Row, T } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, captureApiSession, type ApiSession } from "@/lib/api";
import type { HealthConnection, PrivateWorkout } from "../../../shared/health";

/** The parent keys this component by member ID, so an account change drops its session. */
export function TodayCard({ ownerId }: { ownerId: string }) {
  const [session] = useState(captureApiSession);
  return session ? <SyncedSummary ownerId={ownerId} session={session} /> : null;
}

function SyncedSummary({ ownerId, session }: { ownerId: string; session: ApiSession }) {
  const router = useRouter();
  const theme = useTheme();
  const query = useQuery({
    queryKey: ["private-health", ownerId, "home-summary"],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const [connection, history] = await Promise.all([
        session.request<{ connection: HealthConnection | null }>("/health/connection", { signal }),
        session.request<{ workouts: PrivateWorkout[] }>("/health/workouts?limit=1", { signal }),
      ]);
      return { connection: connection.connection, workout: history.workouts[0] ?? null };
    },
  });
  if (query.isPending || (query.error instanceof ApiError && query.error.status === 404))
    return null;
  const data = query.error ? null : query.data;
  const workout = data?.connection ? data.workout : null;
  return (
    <Card>
      <Row>
        <HeartPulse size={18} color={theme.accent} />
        <T variant="eyebrow" color="textSecondary" style={{ flex: 1 }}>
          Your training
        </T>
      </Row>
      {query.error ? (
        <>
          <Notice>Your synced workout summary could not load.</Notice>
          <Button
            label="Try workout summary again"
            variant="soft"
            onPress={() => void query.refetch()}
          />
        </>
      ) : workout ? (
        <>
          <T variant="heading">
            {workout.record.activity === "other"
              ? "Workout"
              : `${workout.record.activity[0].toUpperCase()}${workout.record.activity.slice(1)}`}{" "}
            · {Math.round(workout.record.durationSeconds / 60)} active minutes
          </T>
          <T variant="caption" color="textSecondary">
            {new Date(workout.record.startAt).toLocaleString()} · recorded by{" "}
            {workout.record.source.name}
          </T>
          {workout.record.distanceMeters !== null && (
            <T>{(workout.record.distanceMeters / 1000).toFixed(2)} km recorded</T>
          )}
          {workout.heartRate.sampleMeanBpm !== null && (
            <T>
              {Math.round(workout.heartRate.sampleMeanBpm)} bpm sample average ·{" "}
              {workout.heartRate.sampleCount} readings
            </T>
          )}
          <T variant="caption" color="textSecondary">
            {data?.connection?.lastSyncedAt
              ? `Last synced ${new Date(data.connection.lastSyncedAt).toLocaleString()}.`
              : "From your synced history."}{" "}
            Your imported records are private to your SamePace account.
          </T>
          <Button
            label="View this workout"
            variant="soft"
            onPress={() => router.push({ pathname: "/workout/[id]", params: { id: workout.id } })}
          />
        </>
      ) : (
        <>
          <T variant="heading">
            {data?.connection ? "Ready for your next sync" : "Bring your workouts together"}
          </T>
          <T color="textSecondary">
            {data?.connection
              ? "No synced workouts are available yet. Open Apple Health to sync or check your selected readings."
              : "Choose which Apple Health workouts and readings to sync to your private SamePace account."}
          </T>
        </>
      )}
      <Button
        label={data?.connection ? "Manage Apple Health" : "Choose Apple Health settings"}
        variant="ghost"
        onPress={() => router.push("/health")}
      />
    </Card>
  );
}
