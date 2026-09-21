import type { HealthRecord, HeartRateSummary, PrivateWorkout, QuantityRecord, WorkoutRecord } from "../../../shared/health.ts";

/** Source samples only: no guessed heart rate, calorie expenditure, or HRV. */
export function summarizeWorkout(record: WorkoutRecord, importedAt: string, samples: HealthRecord[], revision = 1): PrivateWorkout {
  const start = Date.parse(record.startAt);
  const end = Date.parse(record.endAt);
  const heartSamples = samples.filter((sample): sample is QuantityRecord => sample.type === "heart_rate"
    && sample.source.bundleId === record.source.bundleId
    && Date.parse(sample.startAt) >= start && Date.parse(sample.endAt) <= end);
  heartSamples.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const values = heartSamples.map((sample) => sample.value);
  const heartRate: HeartRateSummary = {
    availability: values.length ? "available" : "unavailable",
    sampleCount: values.length,
    minBpm: values.length ? values.reduce((min, value) => Math.min(min, value), Infinity) : null,
    maxBpm: values.length ? values.reduce((max, value) => Math.max(max, value), -Infinity) : null,
    sampleMeanBpm: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    firstSampleAt: heartSamples[0]?.startAt ?? null,
    lastSampleAt: heartSamples.at(-1)?.startAt ?? null,
  };
  return {
    id: record.externalId,
    revision,
    record,
    importedAt,
    elapsedSeconds: (end - start) / 1000,
    paceSecondsPerKilometer: ["run", "walk", "hike"].includes(record.activity)
      && record.distanceMeters !== null && record.distanceMeters > 0 && record.durationSeconds > 0
      ? record.durationSeconds / (record.distanceMeters / 1000) : null,
    heartRate,
  };
}
