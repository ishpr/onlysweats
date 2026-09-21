import { z } from "zod";
import type {
  FitnessActivityDay,
  FitnessActivityMetric,
  FitnessActivitySummary,
  FitnessActivityTotals,
} from "../../../shared/fitness-summary.ts";
import type { Sql } from "../db.ts";
import { FitnessError } from "./contracts.ts";

const summaryInput = z.strictObject({ timeZone: z.string().min(1).max(100) });

function calendarTimeZone(input: unknown): string {
  const { timeZone } = summaryInput.parse(input);
  // Require a named calendar zone rather than ambiguous abbreviations or offsets.
  if (timeZone !== "UTC" && !timeZone.includes("/"))
    throw new FitnessError(400, "Choose a valid calendar time zone.");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new FitnessError(400, "Choose a valid calendar time zone.");
  }
}

type DayRow = {
  date: string;
  start_at: Date | string;
  end_at: Date | string;
  completed_sets: number;
  reps: number | string | null;
  reps_sets: number;
  duration_seconds: number | string | null;
  duration_sets: number;
  external_volume_kg: number | string | null;
  external_volume_sets: number;
};
const iso = (value: Date | string) => new Date(value).toISOString();
const metric = (value: number | string | null, count: number): FitnessActivityMetric => ({
  value: value === null ? null : Number(value),
  contributingSets: count,
});
const metricKeys = ["recordedReps", "recordedDurationSeconds", "knownExternalVolumeKg"] as const;

/**
 * A single SQL snapshot aggregates both manual sources, never a history page.
 * Lock order matches run writes/account deletion (profile then identity); legacy
 * log writes hold identity. Suspended members retain access to their own data.
 */
export async function getFitnessActivitySummary(
  sql: Sql,
  userId: string,
  input: unknown,
  now = Date.now(),
): Promise<FitnessActivitySummary> {
  const timeZone = calendarTimeZone(input);
  const asOf = new Date(now).toISOString();
  return sql.transaction(async (tx) => {
    const [profile] = await tx<{ deleted_at: Date | null }>`
      select deleted_at from profiles where id = ${userId} for no key update`;
    if (!profile || profile.deleted_at) throw new FitnessError(401, "Unauthorized");
    const [identity] = await tx`select id from "user" where id = ${userId} for update`;
    if (!identity) throw new FitnessError(401, "Unauthorized");

    const rows = await tx<DayRow>`
      with calendar as (
        select ((${asOf}::timestamptz at time zone ${timeZone})::date - 6 + day_number) as day
        from generate_series(0, 6) as day_number
      ), days as (
        select day, day::timestamp at time zone ${timeZone} as start_at,
          (day + 1)::timestamp at time zone ${timeZone} as end_at
        from calendar
      ), bounds as (
        select min(start_at) as start_at, max(end_at) as end_at from days
      ), legacy as (
        select (l.data->>'startedAt')::timestamptz as started_at, item.value as result
        from fitness_strength_logs l cross join bounds b
        cross join lateral jsonb_array_elements(l.data->'sets') item
        where l.user_id = ${userId}
          and (l.data->>'startedAt')::timestamptz >= b.start_at
          and (l.data->>'startedAt')::timestamptz < b.end_at
          and (l.data->>'startedAt')::timestamptz <= ${asOf}::timestamptz
      ), performed as (
        select r.started_at, item.value as result
        from workout_runs r cross join bounds b
        cross join lateral jsonb_array_elements(r.results) item
        where r.user_id = ${userId} and r.started_at >= b.start_at
          and r.started_at < b.end_at and r.started_at <= ${asOf}::timestamptz
          and item.value->>'status' = 'completed'
      ), explicit_sets as (
        select started_at, (result->>'reps')::numeric as reps,
          null::numeric as duration_seconds,
          case when result->>'unit' in ('kg', 'lb') then
            (result->>'reps')::numeric * (result->>'weight')::numeric *
              case when result->>'unit' = 'lb' then 0.45359237 else 1 end
          end as external_volume_kg
        from legacy
        union all
        select started_at, (result->>'reps')::numeric,
          (result->>'durationSeconds')::numeric,
          case when result->>'unit' in ('kg', 'lb') then
            (result->>'reps')::numeric * (result->>'weight')::numeric *
              case when result->>'unit' = 'lb' then 0.45359237 else 1 end
          end
        from performed
      )
      select d.day::text as date, d.start_at, d.end_at,
        count(e.started_at)::integer as completed_sets,
        sum(e.reps) as reps, count(e.reps)::integer as reps_sets,
        sum(e.duration_seconds) as duration_seconds,
        count(e.duration_seconds)::integer as duration_sets,
        sum(e.external_volume_kg) as external_volume_kg,
        count(e.external_volume_kg)::integer as external_volume_sets
      from days d left join explicit_sets e on e.started_at >= d.start_at and e.started_at < d.end_at
      group by d.day, d.start_at, d.end_at order by d.day`;

    const days: FitnessActivityDay[] = rows.map((row) => ({
      date: row.date,
      startAt: iso(row.start_at),
      endAt: iso(row.end_at),
      completedSets: row.completed_sets,
      recordedReps: metric(row.reps, row.reps_sets),
      recordedDurationSeconds: metric(row.duration_seconds, row.duration_sets),
      knownExternalVolumeKg: metric(row.external_volume_kg, row.external_volume_sets),
    }));
    const totals: FitnessActivityTotals = {
      completedSets: 0,
      recordedReps: metric(null, 0),
      recordedDurationSeconds: metric(null, 0),
      knownExternalVolumeKg: metric(null, 0),
    };
    // Only seven SQL aggregates cross the boundary, never raw health or notes.
    for (const day of days) {
      totals.completedSets += day.completedSets;
      for (const key of metricKeys) {
        if (day[key].value !== null) totals[key].value = (totals[key].value ?? 0) + day[key].value;
        totals[key].contributingSets += day[key].contributingSets;
      }
    }
    // Deterministic display precision, after adding the unrounded daily subtotals.
    for (const value of [totals, ...days]) {
      if (value.knownExternalVolumeKg.value !== null)
        value.knownExternalVolumeKg.value =
          Math.round(value.knownExternalVolumeKg.value * 1000) / 1000;
    }
    return {
      timeZone,
      asOf,
      startAt: days[0].startAt,
      endAt: days[6].endAt,
      daysWithActivity: days.filter((day) => day.completedSets > 0).length,
      totals,
      days,
    };
  });
}
