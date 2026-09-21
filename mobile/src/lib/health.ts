/**
 * Apple Health, read on this phone and nowhere else. Nothing in this file talks to
 * our server: the numbers are read, turned into a few sentences by `today.ts`, shown
 * on Home, and forgotten. We only ever ask to READ, and only these types.
 *
 * HealthKit never tells an app whether *read* access was granted (that itself would
 * leak health information), so "connected" is our own flag: the member tapped
 * Connect and saw Apple's sheet. If they then allowed nothing, the read simply comes
 * back empty and Home says there's not much to go on.
 *
 * The library is a native (Nitro) module: a build made before it was added doesn't
 * have it, so it's checked for before it's loaded.
 */
import * as SecureStore from "expo-secure-store";
import { Platform, TurboModuleRegistry } from "react-native";

import type { DaySnapshot, WorkoutKind } from "./today";

type HealthKit = typeof import("@kingstinct/react-native-healthkit");

const KEY = "samepace.health-connected";
const READ = [
  "HKWorkoutTypeIdentifier",
  "HKQuantityTypeIdentifierAppleExerciseTime",
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKCategoryTypeIdentifierSleepAnalysis",
] as const;

let cached: HealthKit | null | undefined;

function load(): HealthKit | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== "ios") return cached;
  // Ask before loading: in development a failed `require` is reported as fatal.
  if (!TurboModuleRegistry.get("NitroModules")) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    const mod = require("@kingstinct/react-native-healthkit") as HealthKit;
    cached = mod.isHealthDataAvailable() ? mod : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** False on Android, iPad without Health, and builds made before the module was added. */
export const healthAvailable = () => load() !== null;

export const healthConnected = async () =>
  healthAvailable() && (await SecureStore.getItemAsync(KEY).catch(() => null)) === "1";

/** Shows Apple's permission sheet (read-only). Resolves true once the member has been through it. */
export async function connectHealth(): Promise<boolean> {
  const hk = load();
  if (!hk) return false;
  await hk.requestAuthorization({ toRead: [...READ] });
  await SecureStore.setItemAsync(KEY, "1").catch(() => undefined);
  return true;
}

/** Stops reading. Access itself is revoked in the Health app: Sharing → Apps → SamePace. */
export async function disconnectHealth() {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

// HKWorkoutActivityType → the activities SamePace knows.
const KINDS: Record<number, WorkoutKind> = {
  37: "run",
  13: "ride",
  24: "hike",
  52: "walk",
  50: "strength",
  20: "strength",
  57: "mobility",
  62: "mobility", // flexibility
  66: "mobility", // pilates
};

const DAY = 24 * 3600_000;
const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();
const between = (from: number, to: number) => ({
  filter: { date: { startDate: new Date(from), endDate: new Date(to) } },
});

/** Everything `today.ts` needs, or `null` if Health isn't there. A missing number stays `null`. */
export async function readDay(now = Date.now()): Promise<DaySnapshot | null> {
  const hk = load();
  if (!hk) return null;
  const today = startOfDay(now);
  const weekAgo = today - 7 * DAY;
  const quiet = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  const [workouts, exercise, steps, hrNow, hrBase, hrvNow, hrvBase, sleep] = await Promise.all([
    quiet(hk.queryWorkoutSamples({ limit: 0, ascending: false, ...between(weekAgo, now) })),
    quiet(
      hk.queryStatisticsForQuantity(
        "HKQuantityTypeIdentifierAppleExerciseTime",
        ["cumulativeSum"],
        { unit: "min", ...between(today, now) },
      ),
    ),
    quiet(
      hk.queryStatisticsForQuantity("HKQuantityTypeIdentifierStepCount", ["cumulativeSum"], {
        unit: "count",
        ...between(today, now),
      }),
    ),
    quiet(
      hk.queryStatisticsForQuantity("HKQuantityTypeIdentifierRestingHeartRate", ["mostRecent"], {
        unit: "count/min",
        ...between(today - DAY, now),
      }),
    ),
    quiet(
      hk.queryStatisticsForQuantity(
        "HKQuantityTypeIdentifierRestingHeartRate",
        ["discreteAverage"],
        { unit: "count/min", ...between(weekAgo, today - DAY) },
      ),
    ),
    quiet(
      hk.queryStatisticsForQuantity(
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
        ["discreteAverage"],
        { unit: "ms", ...between(today - DAY / 2, now) },
      ),
    ),
    quiet(
      hk.queryStatisticsForQuantity(
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
        ["discreteAverage"],
        { unit: "ms", ...between(weekAgo, today - DAY / 2) },
      ),
    ),
    // Nights run from 6 pm to noon, so a night belongs to the morning it ends on.
    quiet(
      hk.queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
        limit: 0,
        ...between(weekAgo - DAY / 4, now),
      }),
    ),
  ]);

  // Asleep = any of the asleep stages (1, 3, 4, 5); not "in bed" (0) or "awake" (2).
  const nights = new Map<number, number>();
  for (const s of sleep ?? []) {
    if (![1, 3, 4, 5].includes(Number(s.value))) continue;
    const end = +new Date(s.endDate);
    const night = startOfDay(end - DAY / 2 + DAY / 4);
    nights.set(night, (nights.get(night) ?? 0) + (end - +new Date(s.startDate)) / 60_000);
  }
  const lastNight = nights.get(today) ?? null;
  const earlier = [...nights].filter(([night]) => night < today).map(([, min]) => min);

  const all = workouts ?? [];
  return {
    workouts: all
      .filter((w) => +new Date(w.endDate) >= today)
      .map((w) => ({
        kind: KINDS[Number(w.workoutActivityType)] ?? "other",
        minutes: Math.round(w.duration.quantity / (w.duration.unit === "min" ? 1 : 60)),
        miles: w.totalDistance
          ? w.totalDistance.unit === "mi"
            ? w.totalDistance.quantity
            : w.totalDistance.quantity / 1609.34
          : undefined,
      })),
    exerciseMin: exercise?.sumQuantity?.quantity ?? null,
    steps: steps?.sumQuantity?.quantity != null ? Math.round(steps.sumQuantity.quantity) : null,
    sleepMin: lastNight != null ? Math.round(lastNight) : null,
    sleepBaseMin: earlier.length >= 3 ? earlier.reduce((a, b) => a + b, 0) / earlier.length : null,
    restingHr: hrNow?.mostRecentQuantity?.quantity ?? null,
    restingHrBase: hrBase?.averageQuantity?.quantity ?? null,
    hrvMs: hrvNow?.averageQuantity?.quantity ?? null,
    hrvBase: hrvBase?.averageQuantity?.quantity ?? null,
    weekWorkouts: all.length,
  };
}
