/**
 * Recorded history from the Apple Health data a member chose to sync. Comparisons
 * describe observations only; they do not infer readiness or recommend effort.
 * Session ordering uses entered preferences and time, independently of health.
 *
 * Pure functions and wire types only, shared by the API and the app.
 */
import type { HealthSource, WorkoutRecord } from "./health.ts";

export type WorkoutKind = WorkoutRecord["activity"];

/** What the server can say about one member's day. `null` = not synced or no data. */
export type DaySnapshot = {
  /** Workouts that ended since the member's local midnight. */
  workouts: { id: string; kind: WorkoutKind; minutes: number; meters: number | null }[];
  steps: number | null;
  /** Time asleep last night, in minutes. */
  sleepMin: number | null;
  /** Average of the earlier recorded nights in this summary. */
  sleepBaseMin: number | null;
  restingHr: number | null;
  restingHrBase: number | null;
  /** Recorded SDNN only; RMSSD remains a distinct metric. */
  hrvMs: number | null;
  hrvBase: number | null;
  /** Recorded RMSSD, independently reduced from SDNN and never substituted for it. */
  hrvRmssdMs: number | null;
  hrvRmssdBase: number | null;
  /** One source for the whole RMSSD week; selection is not a quality assessment. */
  hrvRmssdSource: HealthSource | null;
  /** Workouts in the last 7 days, today included. */
  weekWorkouts: number;
};

export type ObservationStatus = "observed" | "unknown";

export type TodayRead = {
  status: ObservationStatus;
  headline: string;
  /** Facts, most useful first. At most three. */
  lines: string[];
};

const VERB: Record<WorkoutKind, string> = {
  run: "ran",
  ride: "rode",
  strength: "lifted",
  hike: "hiked",
  walk: "walked",
  mobility: "did mobility work",
  other: "worked out",
};

const METERS_PER_MILE = 1609.344;

export const hoursMinutes = (min: number) => {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
};

/** A numerical comparison, never a physiological interpretation. */
const comparison = (value: number, base: number | null) =>
  base == null
    ? ""
    : value === base
      ? " — equal to your earlier recorded average"
      : ` — ${value > base ? "above" : "below"} your earlier recorded average`;

export function readToday(d: DaySnapshot, trends?: DayTrends): TodayRead {
  const lines: string[] = [];
  const longest = [...d.workouts].sort((a, b) => b.minutes - a.minutes)[0];
  if (longest) {
    const miles = longest.meters == null ? 0 : longest.meters / METERS_PER_MILE;
    const distance = miles >= 0.3 ? ` ${miles.toFixed(1)} mi` : "";
    lines.push(
      `You ${VERB[longest.kind]}${distance} today — ${hoursMinutes(longest.minutes)}${
        d.workouts.length > 1 ? `, plus ${d.workouts.length - 1} more` : ""
      }.`,
    );
  }
  if (d.sleepMin != null) {
    lines.push(`You slept ${hoursMinutes(d.sleepMin)}${comparison(d.sleepMin, d.sleepBaseMin)}.`);
  }
  if (d.restingHr != null) {
    lines.push(
      `Recorded resting heart rate: ${d.restingHr} bpm${comparison(d.restingHr, d.restingHrBase)}.`,
    );
  }
  if (d.hrvMs != null) {
    lines.push(`Recorded HRV (SDNN): ${d.hrvMs} ms${comparison(d.hrvMs, d.hrvBase)}.`);
  }
  if (d.hrvRmssdMs != null) {
    lines.push(
      `Recorded HRV (RMSSD): ${d.hrvRmssdMs} ms${comparison(d.hrvRmssdMs, d.hrvRmssdBase)}.`,
    );
  }
  if (!longest && d.weekWorkouts > 0) {
    lines.push(`${d.weekWorkouts} workout${d.weekWorkouts === 1 ? "" : "s"} in the last 7 days.`);
  }
  if (d.steps != null) {
    lines.push(`${d.steps.toLocaleString("en-US")} steps so far.`);
  }
  // Some opted-in measurements are chart-only. Their presence still counts as
  // observed history, even when the summary has no sleep, steps, HRV or workouts.
  if (
    lines.length === 0 &&
    trends &&
    (trends.heartToday.length > 0 ||
      trends.glucoseToday.length > 0 ||
      [
        trends.sleepWeek,
        trends.restingHrWeek,
        trends.hrvWeek,
        trends.hrvRmssdWeek ?? [],
        trends.stepsWeek,
        trends.moveKcalWeek,
      ].some((values) => values.some((value) => value !== null)))
  ) {
    lines.push("Your synced measurements are available in your history.");
  }

  if (lines.length === 0) {
    return {
      status: "unknown",
      headline: "No recent readings synced",
      lines: ["Sync the readings you choose to see your recorded history."],
    };
  }
  return { status: "observed", headline: "Your recorded activity", lines: lines.slice(0, 3) };
}

/** Entered preference match and schedule; no health measurements. */
export type Candidate = {
  id: string;
  fitsMe: boolean | null;
  startAt: number;
};

/**
 * Prefer entered ability matches, then start time. Exclude known mismatches and
 * describe unknown matches neutrally. Health data is deliberately not an input.
 */
export function pickForToday(sessions: Candidate[]): { id: string; why: string } | null {
  const open = sessions.filter((s) => s.fitsMe !== false).sort((a, b) => a.startAt - b.startAt);
  if (open.length === 0) return null;
  const mine = open.find((s) => s.fitsMe === true) ?? open[0];
  return {
    id: mine.id,
    why: mine.fitsMe === true ? "Matches your entered level" : "Upcoming session",
  };
}

/** One point on a today chart: minutes since the member's local midnight. */
export type DayPoint = { minute: number; value: number; low: number; high: number };

/** Seven values, oldest first; the last is today (or last night). `null` = no data. */
export type Week = (number | null)[];

/** Everything the Today card draws. Series are already reduced — never raw samples. */
export type DayTrends = {
  sleepWeek: Week;
  /** Last night, in minutes per stage. `null` when the source gave no stages. */
  sleepStages: { deep: number; core: number; rem: number; awake: number } | null;
  restingHrWeek: Week;
  /** Recorded SDNN, distinct from RMSSD below. */
  hrvWeek: Week;
  /** Daily sample means from snapshot.hrvRmssdSource only. */
  hrvRmssdWeek: Week;
  stepsWeek: Week;
  moveKcalWeek: Week;
  /** Half-hour heart-rate buckets since midnight. */
  heartToday: DayPoint[];
  /** Half-hour glucose buckets since midnight, mg/dL. */
  glucoseToday: DayPoint[];
};

export type TodaySummary = { snapshot: DaySnapshot; trends: DayTrends; syncedAt: string | null };
