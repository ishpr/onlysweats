/**
 * Today, from the Apple Health data a member chose to sync — in two layers that stay
 * apart. RECORDED: what was measured, in plain words, compared only with the member's
 * own earlier days. OUR READ: SamePace's modest take on the day (easy · steady · ready)
 * from sleep, resting heart rate, HRV and training already done. It is labelled as ours
 * wherever it appears, it is never a score, and it is not medical advice; it only helps
 * pick a session that suits the day. Nothing here is shown to another member.
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

export type Effort = "easy" | "steady" | "ready";

/** SamePace's take on the day. Always shown as ours, beside — never instead of — the facts. */
export type OurRead = {
  effort: Effort;
  headline: string;
  /** The one recorded fact that tipped it, in plain words. */
  because: string;
};

export type TodayRead = {
  status: ObservationStatus;
  headline: string;
  /** Recorded facts, most useful first. At most three. */
  lines: string[];
  /** `null` when there isn't enough to go on. */
  ourRead: OurRead | null;
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

/** A comparison with the member's own earlier average — a number beside a number. */
const comparison = (value: number, base: number | null, show: (n: number) => string) =>
  base == null
    ? ""
    : value === base
      ? ", the same as your usual"
      : `, ${value > base ? "above" : "below"} your usual ${show(base)}`;

const whole = (n: number) => String(Math.round(n));

/** Up or down against the member's own earlier average, as a fraction. `null` = can't say. */
const change = (now: number | null, base: number | null) =>
  now == null || base == null || base <= 0 ? null : (now - base) / base;

/**
 * Our read of the day. Deliberately coarse: three words, one reason. Training already
 * done counts first; then a short night, a raised resting heart rate or a lowered HRV
 * (each against the member's own usual) make it an easy day; a full night with nothing
 * done yet makes it a ready one. With no sleep, heart or training data there is no read.
 */
export function ourRead(d: DaySnapshot): OurRead | null {
  const trainedMin = d.workouts.reduce((sum, w) => sum + w.minutes, 0);
  const hrv = d.hrvMs ?? d.hrvRmssdMs;
  const hrvBase = d.hrvMs != null ? d.hrvBase : d.hrvRmssdBase;
  if (d.sleepMin == null && d.restingHr == null && hrv == null && trainedMin === 0) return null;
  const sleepShort =
    d.sleepMin != null &&
    (d.sleepMin < 6 * 60 || (d.sleepBaseMin != null && d.sleepMin < d.sleepBaseMin - 60));
  const hrUp = (change(d.restingHr, d.restingHrBase) ?? 0) >= 0.07;
  const hrvDown = (change(hrv, hrvBase) ?? 0) <= -0.15;
  if (trainedMin >= 45) {
    return {
      effort: "easy",
      headline: "You’ve done the work today",
      because: `You’ve already trained for ${hoursMinutes(trainedMin)}.`,
    };
  }
  if (sleepShort) {
    return {
      effort: "easy",
      headline: "An easy day",
      because: `You slept ${hoursMinutes(d.sleepMin!)}, a short night for you.`,
    };
  }
  if (hrUp) {
    return {
      effort: "easy",
      headline: "An easy day",
      because: "Your resting heart rate is up on your usual.",
    };
  }
  if (hrvDown) {
    return { effort: "easy", headline: "An easy day", because: "Your HRV is below your usual." };
  }
  if (d.sleepMin != null && d.sleepMin >= 7 * 60 && trainedMin < 20) {
    return {
      effort: "ready",
      headline: "A good day to go",
      because: `You slept ${hoursMinutes(d.sleepMin)} and haven’t trained yet.`,
    };
  }
  return {
    effort: "steady",
    headline: "A steady day",
    because: "Nothing in your readings stands out from your usual.",
  };
}

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
    lines.push(
      `You slept ${hoursMinutes(d.sleepMin)}${comparison(d.sleepMin, d.sleepBaseMin, hoursMinutes)}.`,
    );
  }
  if (d.restingHr != null) {
    lines.push(
      `Resting heart rate ${d.restingHr} bpm${comparison(d.restingHr, d.restingHrBase, whole)}.`,
    );
  }
  if (d.hrvMs != null) {
    // SDNN and RMSSD are different measures: name them whenever both are on the card.
    lines.push(
      `${d.hrvRmssdMs != null ? "HRV (SDNN)" : "HRV"} ${d.hrvMs} ms${comparison(d.hrvMs, d.hrvBase, whole)}.`,
    );
  }
  if (d.hrvRmssdMs != null) {
    lines.push(`HRV (RMSSD) ${d.hrvRmssdMs} ms${comparison(d.hrvRmssdMs, d.hrvRmssdBase, whole)}.`);
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
    lines.push("Your synced readings are in your day’s charts.");
  }

  if (lines.length === 0) {
    return {
      status: "unknown",
      headline: "Nothing synced for today yet",
      lines: ["Sync the readings you choose and your day shows up here."],
      ourRead: null,
    };
  }
  const read = ourRead(d);
  return {
    status: "observed",
    headline: read?.headline ?? "Your day so far",
    lines: lines.slice(0, 3),
    ourRead: read,
  };
}

/** What a session asks of the member, as far as the day's read cares. */
export type Candidate = {
  id: string;
  fitsMe: boolean | null;
  startAt: number;
  activity?: string;
  anyLevelWelcome?: boolean;
};

const GENTLE = new Set(["walk", "mobility"]);

/**
 * The one session to point at. Entered level and time decide; on a day we read as easy,
 * a walk, mobility or an "any level welcome" session comes first. Never one known not
 * to fit. The session list itself is never reordered or hidden by health data.
 */
export function pickForToday(
  sessions: Candidate[],
  effort?: Effort | null,
): { id: string; why: string } | null {
  const open = sessions.filter((s) => s.fitsMe !== false).sort((a, b) => a.startAt - b.startAt);
  if (open.length === 0) return null;
  if (effort === "easy") {
    const gentle =
      open.find((s) => s.activity !== undefined && GENTLE.has(s.activity)) ??
      open.find((s) => s.anyLevelWelcome === true);
    if (gentle) return { id: gentle.id, why: "Gentle enough for today" };
  }
  const mine = open.find((s) => s.fitsMe === true) ?? open[0];
  return {
    id: mine.id,
    why:
      mine.fitsMe !== true
        ? "Coming up"
        : effort === "ready"
          ? "At your level, and you’re fresh"
          : "At your level",
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
