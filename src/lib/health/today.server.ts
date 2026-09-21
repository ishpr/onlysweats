import { z } from "zod";
import type { Sql } from "../db.ts";
import type { SleepRecord, WorkoutRecord } from "../../../shared/health.ts";
import type { DayPoint, DaySnapshot, TodaySummary, Week } from "../../../shared/today.ts";
import { HealthError } from "./contracts.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DAYS = 7;
/** A "night" runs 6 pm to 6 pm, so an afternoon nap never splits last night in two. */
const NIGHT_OFFSET = 6 * HOUR;

/** The member's local midnight. The server has no time zone for them, so the app says. */
export const todayInput = z.object({
  dayStart: z.iso.datetime({ offset: true }).transform((value) => Date.parse(value)),
}).strict();

const mean = (values: number[]) => values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
const round = (value: number | null, digits = 0) => value === null ? null : Number(value.toFixed(digits));

/** Minutes covered by a set of intervals, counting overlapping sources once. */
function unionMinutes(spans: [number, number][]): number {
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (to <= end) continue;
    total += to - Math.max(from, end);
    end = to;
  }
  return total / 60_000;
}

/**
 * One member's day, reduced for the Today card. Overlapping sources are never added
 * together: sleep is the union of asleep intervals, and step and energy totals take
 * the single source that recorded the most that day (a watch and a phone both count
 * the same walk). Series are bucketed here so raw samples never leave the API.
 */
export async function today(sql: Sql, userId: string, input: unknown, now = Date.now()): Promise<TodaySummary> {
  const { dayStart } = todayInput.parse(input);
  if (dayStart > now + 60_000 || dayStart < now - 36 * HOUR) throw new HealthError(400, "dayStart must be today’s local midnight.");
  const weekStart = dayStart - (DAYS - 1) * DAY;
  const weekIso = new Date(weekStart).toISOString();
  const dayIso = new Date(dayStart).toISOString();
  const nightsIso = new Date(weekStart - NIGHT_OFFSET).toISOString();
  const weekEpoch = weekStart / 1000;
  const dayEpoch = dayStart / 1000;

  const [connection] = await sql<{ last_synced_at: Date | string | null }>`
    select last_synced_at from health_connections where user_id = ${userId}`;
  if (!connection) throw new HealthError(404, "Apple Health is not connected.");

  const workouts = await sql<{ external_id: string; record: WorkoutRecord }>`
    select external_id, record from health_records
    where user_id = ${userId} and type = 'workout' and record is not null and record->>'startAt' >= ${weekIso}
    order by record->>'startAt'`;
  const totals = await sql<{ type: string; day: number; total: number }>`
    select type, day, max(total) as total from (
      select type, floor((extract(epoch from (record->>'startAt')::timestamptz) - ${weekEpoch}) / 86400)::int as day,
        record->'source'->>'bundleId' as source, sum((record->>'value')::float8) as total
      from health_records
      where user_id = ${userId} and type in ('steps', 'active_energy') and record is not null and record->>'startAt' >= ${weekIso}
      group by 1, 2, 3) per_source
    group by 1, 2`;
  const averages = await sql<{ type: string; day: number; value: number }>`
    select type, floor((extract(epoch from (record->>'startAt')::timestamptz) - ${weekEpoch}) / 86400)::int as day,
      avg((record->>'value')::float8) as value
    from health_records
    where user_id = ${userId} and type in ('resting_heart_rate', 'heart_rate_variability') and record is not null
      and record->>'startAt' >= ${weekIso}
    group by 1, 2`;
  const slots = await sql<{ type: string; slot: number; value: number; low: number; high: number }>`
    select type, floor((extract(epoch from (record->>'startAt')::timestamptz) - ${dayEpoch}) / 1800)::int as slot,
      avg((record->>'value')::float8) as value, min((record->>'value')::float8) as low, max((record->>'value')::float8) as high
    from health_records
    where user_id = ${userId} and type in ('heart_rate', 'blood_glucose') and record is not null and record->>'startAt' >= ${dayIso}
    group by 1, 2 order by 2`;
  const sleep = await sql<{ record: SleepRecord }>`
    select record from health_records
    where user_id = ${userId} and type = 'sleep' and record is not null and record->>'endAt' >= ${nightsIso}`;

  const week = (rows: { type: string; day: number }[], type: string, pick: (row: never) => number, digits = 0): Week => {
    const out: Week = Array.from({ length: DAYS }, () => null);
    for (const row of rows) if (row.type === type && row.day >= 0 && row.day < DAYS) out[row.day] = round(pick(row as never), digits);
    return out;
  };
  const stepsWeek = week(totals, "steps", (row: { total: number }) => Number(row.total));
  const moveKcalWeek = week(totals, "active_energy", (row: { total: number }) => Number(row.total));
  const restingHrWeek = week(averages, "resting_heart_rate", (row: { value: number }) => Number(row.value));
  const hrvWeek = week(averages, "heart_rate_variability", (row: { value: number }) => Number(row.value));

  // Night n ends on day n: the 24 hours from 6 pm the evening before.
  const nights: Record<string, [number, number][]>[] = Array.from({ length: DAYS }, () => ({}));
  for (const { record } of sleep) {
    if (record.stage === "in_bed") continue;
    const from = Date.parse(record.startAt);
    const to = Date.parse(record.endAt);
    const night = Math.floor((to - (weekStart - NIGHT_OFFSET)) / DAY);
    if (night < 0 || night >= DAYS) continue;
    (nights[night][record.stage] ??= []).push([from, to]);
  }
  const asleep = (night: Record<string, [number, number][]>) =>
    Object.entries(night).filter(([stage]) => stage !== "awake").flatMap(([, spans]) => spans);
  const sleepWeek: Week = nights.map((night) => {
    const minutes = unionMinutes(asleep(night));
    return minutes > 0 ? Math.round(minutes) : null;
  });
  // Before mid-morning, "last night" may not be recorded yet (or not slept yet, just
  // after midnight): the night before still describes how rested the member is.
  const early = now - dayStart < 10 * HOUR;
  const lastNight = sleepWeek[DAYS - 1] === null && early ? DAYS - 2 : DAYS - 1;
  const last = nights[lastNight];
  const staged = last.deep || last.core || last.rem;
  const stage = (name: string) => Math.round(unionMinutes(last[name] ?? []));

  /** Today's value, else yesterday's — a watch often posts resting HR late in the day. */
  const latest = (values: Week) => values[DAYS - 1] ?? values[DAYS - 2];
  const base = (values: Week) => {
    const at = values[DAYS - 1] === null ? DAYS - 2 : DAYS - 1;
    const earlier = values.slice(0, at).filter((value): value is number => value !== null);
    return earlier.length >= 3 ? mean(earlier) : null;
  };
  const points = (type: string, digits: number): DayPoint[] => slots.filter((row) => row.type === type && row.slot >= 0 && row.slot < 48)
    .map((row) => ({ minute: row.slot * 30, value: round(Number(row.value), digits)!, low: round(Number(row.low), digits)!, high: round(Number(row.high), digits)! }));

  const snapshot: DaySnapshot = {
    workouts: workouts.filter(({ record }) => Date.parse(record.endAt) >= dayStart).map(({ external_id, record }) => ({
      id: external_id, kind: record.activity, minutes: Math.round(record.durationSeconds / 60), meters: record.distanceMeters,
    })),
    steps: stepsWeek[DAYS - 1],
    sleepMin: sleepWeek[lastNight],
    sleepBaseMin: round(mean(sleepWeek.slice(0, lastNight).filter((value): value is number => value !== null).slice(-7)) ?? null),
    restingHr: latest(restingHrWeek),
    restingHrBase: round(base(restingHrWeek), 1),
    hrvMs: latest(hrvWeek),
    hrvBase: round(base(hrvWeek), 1),
    weekWorkouts: workouts.length,
  };
  return {
    snapshot,
    trends: {
      sleepWeek, restingHrWeek, hrvWeek, stepsWeek, moveKcalWeek,
      sleepStages: staged ? { deep: stage("deep"), core: stage("core"), rem: stage("rem"), awake: stage("awake") } : null,
      heartToday: points("heart_rate", 0),
      glucoseToday: points("blood_glucose", 0),
    },
    syncedAt: connection.last_synced_at === null ? null : new Date(connection.last_synced_at).toISOString(),
  };
}
