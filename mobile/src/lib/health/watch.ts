import type { HealthDataType } from "../../../../shared/health";
import type { WatchMirrorSnapshot } from "../../../modules/samepace-healthkit";

/** Presentation only: consent/freshness removes values; it never invents measurements. */
export function visibleWatchSnapshot(
  snapshot: WatchMirrorSnapshot | null,
  types: HealthDataType[],
  now = Date.now(),
): WatchMirrorSnapshot | null {
  if (!snapshot || !types.includes("workout") || !["running", "paused"].includes(snapshot.state))
    return null;
  const received = Date.parse(snapshot.receivedAt);
  if (!Number.isFinite(received) || received > now + 5000 || now - received > 30_000) return null;
  const sampleAt = snapshot.heartRateAt ? Date.parse(snapshot.heartRateAt) : NaN;
  const heartVisible =
    types.includes("heart_rate") &&
    snapshot.state === "running" &&
    Number.isFinite(sampleAt) &&
    sampleAt <= now + 5000 &&
    now - sampleAt <= 15_000;
  return {
    ...snapshot,
    heartRateBpm: heartVisible ? snapshot.heartRateBpm : null,
    heartRateAt: heartVisible ? snapshot.heartRateAt : null,
    zoneIndex: heartVisible ? snapshot.zoneIndex : null,
    zoneSource: heartVisible ? snapshot.zoneSource : null,
  };
}
