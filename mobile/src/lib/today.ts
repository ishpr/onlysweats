/**
 * Our own read of today, from what Apple Health already knows — in plain words, to
 * help pick a session that fits the day. Not a score, not coaching, not medicine:
 * every sentence is either a fact ("you slept 6 h 10 min") or a modest comparison
 * with the member's own recent days. Nothing here leaves the phone.
 *
 * Pure functions only — no React Native imports — so it runs under `node --test`.
 */
export type WorkoutKind = "run" | "ride" | "strength" | "hike" | "walk" | "mobility" | "other";

export type DaySnapshot = {
  /** Workouts that ended today. */
  workouts: { kind: WorkoutKind; minutes: number; miles?: number }[];
  /** Apple's exercise minutes today. */
  exerciseMin: number | null;
  steps: number | null;
  /** Time asleep last night, in minutes. */
  sleepMin: number | null;
  /** Usual sleep: the average of the previous nights we could see. */
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
  /** Facts, most useful first. At most three are shown. */
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

export const hoursMinutes = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
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
    const distance = longest.miles && longest.miles >= 0.3 ? ` ${longest.miles.toFixed(1)} mi` : "";
    lines.push(
      `You ${VERB[longest.kind]}${distance} today — ${hoursMinutes(longest.minutes)}${
        d.workouts.length > 1 ? `, plus ${d.workouts.length - 1} more` : ""
      }.`,
    );
  }
  if (d.sleepMin != null) {
    lines.push(
      sleepShort
        ? `You slept ${hoursMinutes(d.sleepMin)} — less than you usually do.`
        : `You slept ${hoursMinutes(d.sleepMin)}.`,
    );
  }
  if (hrUp) lines.push("Your resting heart rate is up on your week.");
  else if (hrvDown) lines.push("Your heart-rate variability is below your week’s average.");
  if (!longest && d.weekWorkouts > 0) {
    lines.push(`${d.weekWorkouts} workout${d.weekWorkouts === 1 ? "" : "s"} in the last 7 days.`);
  }
  if (lines.length === 0 && d.steps != null && d.steps > 0) {
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
    lines.push("Wear your watch to bed and for workouts, and this fills in.");
  }
  return { effort, headline, lines: lines.slice(0, 3) };
}

/** What a session asks of you, as far as today's read cares. */
export type Candidate = {
  id: string;
  activity: WorkoutKind | "strength";
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
