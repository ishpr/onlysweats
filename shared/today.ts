/**
 * Our own read of today, from the Apple Health history a member chose to sync — in
 * plain words, to help pick a session that fits the day. Not a score, not coaching,
 * not medicine: every sentence is either a fact ("you slept 6 h 10 min") or a modest
 * comparison with the member's own recent days.
 *
 * Pure functions and wire types only, shared by the API and the app.
 */
import type { WorkoutRecord } from "./health.ts";

export type WorkoutKind = WorkoutRecord["activity"];

/** What the server can say about one member's day. `null` = not synced or no data. */
export type DaySnapshot = {
  /** Workouts that ended since the member's local midnight. */
  workouts: { id: string; kind: WorkoutKind; minutes: number; meters: number | null }[];
  steps: number | null;
  /** Time asleep last night, in minutes. */
  sleepMin: number | null;
  /** Usual sleep: the average of the earlier nights we could see. */
  sleepBaseMin: number | null;
  restingHr: number | null;
  restingHrBase: number | null;
  hrvMs: number | null;
  hrvBase: number | null;
  /** Workouts in the last 7 days, today included. */
  weekWorkouts: number;
};

export type Effort = "easy" | "steady" | "ready" | "unknown";

export type TodayRead = {
  effort: Effort;
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

/** Up or down against the member's own recent average, as a fraction. `null` = can't say. */
const change = (now: number | null, base: number | null) =>
  now == null || base == null || base <= 0 ? null : (now - base) / base;

export function readToday(d: DaySnapshot): TodayRead {
  const trainedMin = d.workouts.reduce((sum, w) => sum + w.minutes, 0);
  const sleepShort =
    d.sleepMin != null &&
    (d.sleepMin < 6 * 60 || (d.sleepBaseMin != null && d.sleepMin < d.sleepBaseMin - 60));
  const sleepGood = d.sleepMin != null && d.sleepMin >= 7 * 60;
  const hrUp = (change(d.restingHr, d.restingHrBase) ?? 0) >= 0.07;
  const hrvDown = (change(d.hrvMs, d.hrvBase) ?? 0) <= -0.15;
  const haveRecovery = d.sleepMin != null || d.restingHr != null || d.hrvMs != null;

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
    lines.push(
      sleepShort && d.sleepBaseMin != null && d.sleepMin < d.sleepBaseMin - 60
        ? `You slept ${hoursMinutes(d.sleepMin)} — less than you usually do.`
        : `You slept ${hoursMinutes(d.sleepMin)}.`,
    );
  }
  if (hrUp) lines.push("Your resting heart rate is up on your week.");
  else if (hrvDown) lines.push("Your heart-rate variability is below your week’s average.");
  if (!longest && d.weekWorkouts > 0) {
    lines.push(`${d.weekWorkouts} workout${d.weekWorkouts === 1 ? "" : "s"} in the last 7 days.`);
  }
  if (lines.length < 3 && d.steps != null && d.steps > 0) {
    lines.push(`${d.steps.toLocaleString("en-US")} steps so far.`);
  }

  let effort: Effort;
  if (trainedMin >= 45) effort = "easy";
  else if (sleepShort || hrUp || hrvDown) effort = "easy";
  else if (!haveRecovery && trainedMin === 0 && d.weekWorkouts === 0) effort = "unknown";
  else if (sleepGood && trainedMin < 20) effort = "ready";
  else effort = "steady";

  const headline =
    effort === "easy"
      ? trainedMin >= 45
        ? "You’ve done the work today"
        : "An easy day"
      : effort === "ready"
        ? "A good day to go"
        : effort === "steady"
          ? "A steady day"
          : "Not much to go on yet";

  if (effort === "unknown") {
    return {
      effort,
      headline,
      lines: [...lines, "Wear your watch to bed and for workouts, and this fills in."].slice(-3),
    };
  }
  return { effort, headline, lines: lines.slice(0, 3) };
}

/** What a session asks of you, as far as today's read cares. */
export type Candidate = {
  id: string;
  activity: string;
  anyLevelWelcome: boolean;
  fitsMe: boolean | null;
  startAt: number;
};

const GENTLE = new Set(["walk", "mobility"]);

/**
 * The one session to point at, given the day. An easy day prefers a walk, mobility or
 * an "any level welcome" session; otherwise the soonest one at my level. Never one
 * that's known not to fit. `null` when nothing suits.
 */
export function pickForToday(
  read: TodayRead,
  sessions: Candidate[],
): { id: string; why: string } | null {
  const open = sessions.filter((s) => s.fitsMe !== false).sort((a, b) => a.startAt - b.startAt);
  if (open.length === 0) return null;
  if (read.effort === "easy") {
    const gentle = open.find((s) => GENTLE.has(s.activity)) ?? open.find((s) => s.anyLevelWelcome);
    return gentle ? { id: gentle.id, why: "Gentle enough for today" } : null;
  }
  const mine = open.find((s) => s.fitsMe === true) ?? open[0];
  return {
    id: mine.id,
    why: read.effort === "ready" ? "At your level, and you’re fresh" : "At your level",
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
  hrvWeek: Week;
  stepsWeek: Week;
  moveKcalWeek: Week;
  /** Half-hour heart-rate buckets since midnight. */
  heartToday: DayPoint[];
  /** Half-hour glucose buckets since midnight, mg/dL. */
  glucoseToday: DayPoint[];
};

export type TodaySummary = { snapshot: DaySnapshot; trends: DayTrends; syncedAt: string | null };
