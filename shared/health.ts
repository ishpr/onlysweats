/** Wire types for private Apple Health import. No native or server dependencies. */
export type HealthDataType =
  | "workout" | "heart_rate" | "resting_heart_rate" | "heart_rate_variability"
  | "sleep" | "steps" | "distance" | "active_energy" | "blood_glucose";

export type HealthSource = { bundleId: string; name: string };
export type HealthRecordBase = {
  externalId: string;
  source: HealthSource;
  startAt: string;
  endAt: string;
};
export type WorkoutRecord = HealthRecordBase & {
  type: "workout";
  activity: "run" | "walk" | "ride" | "hike" | "strength" | "mobility" | "other";
  /** Source-reported active duration, distinct from elapsed wall-clock time. */
  durationSeconds: number;
  distanceMeters: number | null;
  activeEnergyKilocalories: number | null;
};
export type QuantityRecord = HealthRecordBase & (
  | { type: "heart_rate" | "resting_heart_rate"; value: number; unit: "bpm" }
  | { type: "heart_rate_variability"; value: number; unit: "ms" }
  | { type: "steps"; value: number; unit: "count" }
  | { type: "distance"; value: number; unit: "m" }
  | { type: "active_energy"; value: number; unit: "kcal" }
  | { type: "blood_glucose"; value: number; unit: "mg/dL" }
);
export type SleepRecord = HealthRecordBase & {
  type: "sleep";
  stage: "in_bed" | "asleep_unspecified" | "awake" | "core" | "deep" | "rem";
};
export type HealthRecord = WorkoutRecord | QuantityRecord | SleepRecord;
export type HealthCursor = { sequence: number; anchor: string | null };
export type HealthConnection = {
  deviceId: string;
  generation: string;
  types: HealthDataType[];
  /** Fixed initial lookback boundary, retained for every anchored query. */
  sinceAt: string;
  connectedAt: string;
  lastSyncedAt: string | null;
  cursors: Partial<Record<HealthDataType, HealthCursor>>;
};
export type HealthPage = {
  records: HealthRecord[];
  deletedIds: string[];
  anchor: string;
  hasMore: boolean;
};
export type HealthSyncInput = HealthPage & {
  deviceId: string;
  generation: string;
  type: HealthDataType;
  expectedSequence: number;
};
export type HeartRateSummary = {
  availability: "available" | "unavailable";
  sampleCount: number;
  minBpm: number | null;
  maxBpm: number | null;
  /** Arithmetic mean of samples, not a time-weighted physiological estimate. */
  sampleMeanBpm: number | null;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
};
export type PrivateWorkout = {
  id: string;
  /** Workout source record only. Readings/consent need separate snapshot versioning. */
  revision: number;
  record: WorkoutRecord;
  importedAt: string;
  elapsedSeconds: number;
  paceSecondsPerKilometer: number | null;
  heartRate: HeartRateSummary;
};
