/** A transient, explicit native workout session. Never populate with AI output. */
export type WorkoutSurfaceSnapshot = {
  sessionId: string;
  state: "running" | "paused" | "stopped" | "ended";
  activity: "run" | "walk" | "ride" | "strength" | "other";
  startAt: string;
  elapsedSeconds: number;
  heartRateBpm: number | null;
  heartRateAt: string | null;
  distanceMeters: number | null;
  activeEnergyKilocalories: number | null;
  zoneIndex: number | null;
  zoneSource: "system" | "user" | "app" | null;
  receivedAt: string;
};
export type WorkoutSurfaceProps = {
  title: string;
  state: "running" | "paused";
  elapsedLabel: string;
  heartRateLabel: string | null;
  distanceLabel: string | null;
};

export function workoutSurface(
  snapshot: WorkoutSurfaceSnapshot,
  now: number,
): { props: WorkoutSurfaceProps; staleAt: number } | null {
  const receivedAt = Date.parse(snapshot.receivedAt);
  const startAt = Date.parse(snapshot.startAt);
  if (
    !["running", "paused"].includes(snapshot.state) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(snapshot.sessionId) ||
    !Number.isFinite(receivedAt) ||
    receivedAt > now + 5_000 ||
    now - receivedAt > 60_000 ||
    !Number.isFinite(startAt) ||
    startAt > now + 5_000 ||
    !Number.isFinite(snapshot.elapsedSeconds) ||
    snapshot.elapsedSeconds < 0 ||
    snapshot.elapsedSeconds > 86_400
  )
    return null;
  const seconds = Math.floor(snapshot.elapsedSeconds);
  const heartAt = snapshot.heartRateAt ? Date.parse(snapshot.heartRateAt) : NaN;
  const heartCurrent =
    Number.isFinite(heartAt) &&
    heartAt <= now + 5_000 &&
    now - heartAt <= 60_000 &&
    snapshot.heartRateBpm !== null &&
    Number.isFinite(snapshot.heartRateBpm) &&
    snapshot.heartRateBpm > 0 &&
    snapshot.heartRateBpm <= 300;
  const distance = snapshot.distanceMeters;
  const labels = {
    run: "Run",
    walk: "Walk",
    ride: "Ride",
    strength: "Strength workout",
    other: "Workout",
  };
  return {
    staleAt: Math.min(receivedAt + 60_000, heartCurrent ? heartAt + 60_000 : Infinity),
    props: {
      title: labels[snapshot.activity] ?? "Workout",
      state: snapshot.state as "running" | "paused",
      elapsedLabel: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      heartRateLabel: heartCurrent ? `${Math.round(snapshot.heartRateBpm!)} bpm` : null,
      distanceLabel:
        distance !== null && Number.isFinite(distance) && distance >= 0 && distance <= 1_000_000
          ? `${(distance / 1_000).toFixed(2)} km`
          : null,
    },
  };
}
