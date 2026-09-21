import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import type { StrengthLogInput, StrengthSet } from "../../../shared/fitness.ts";
import type { WorkoutRun, WorkoutSetResult } from "../../../shared/workout-plans.ts";
import { makeDb } from "../pace/test-db.ts";
import { deleteAccount } from "../pace/safety.server.ts";
import { fixtureMember, fixturePlan } from "../workout-plans/fixtures.ts";
import * as plans from "../workout-plans/service.server.ts";
import * as health from "../health/service.server.ts";
import * as fitness from "./service.server.ts";
import { FitnessError } from "./contracts.ts";
import { getFitnessActivitySummary } from "./summary.server.ts";

let sql: Sql;
const now = Date.parse("2026-09-21T12:00:00.000Z");
const hour = 3_600_000;
const emptyMetric = { value: null, contributingSets: 0 };
const read = (id: string, time = now, timeZone = "UTC") =>
  getFitnessActivitySummary(sql, id, { timeZone }, time);
const logInput = (
  startedAt: string,
  sets: StrengthSet[] = [{ reps: 8, weight: 10, unit: "kg" }],
): StrengthLogInput => ({
  startedAt,
  exerciseId: "bench_press",
  note: "Synthetic manual activity, never a measurement",
  sets,
});
async function log(id: string, startedAt: string, sets?: StrengthSet[], time = now) {
  return fitness.createStrengthLog(sql, id, logInput(startedAt, sets), time);
}
async function run(id: string, time = now, setCount = 3) {
  const input = fixturePlan();
  const exercise = input.exercises[0];
  exercise.sets = Array.from({ length: setCount }, () => ({
    ...exercise.sets[0],
    id: randomUUID(),
    reps: 100,
    durationSeconds: 999,
    weight: 200,
    unit: "kg",
  }));
  const plan = await plans.createPlan(sql, id, input, time);
  return plans.startRun(
    sql,
    id,
    { id: randomUUID(), planId: plan.id, expectedPlanRevision: plan.revision },
    time,
  );
}
function result(
  saved: WorkoutRun,
  index: number,
  fields: Partial<WorkoutSetResult> = {},
): WorkoutSetResult {
  return {
    exerciseId: saved.snapshot.exercises[0].id,
    setId: saved.snapshot.exercises[0].sets[index].id,
    status: "completed",
    reps: null,
    durationSeconds: 45,
    distanceMeters: null,
    weight: null,
    unit: "bodyweight",
    ...fields,
  };
}
async function save(id: string, saved: WorkoutRun, results: WorkoutSetResult[], finish = false) {
  return plans.updateRun(
    sql,
    id,
    saved.id,
    { expectedRevision: saved.revision, results, finish, note: "", shareAccountability: false },
    Math.max(now, Date.parse(saved.startedAt)),
  );
}
before(async () => {
  sql = await makeDb();
});

describe("private seven-calendar-day manual activity summary", () => {
  it("returns exactly seven empty days with unknown metrics, no manufactured zeros", async () => {
    const summary = await read(await fixtureMember(sql));
    assert.equal(summary.asOf, "2026-09-21T12:00:00.000Z");
    assert.equal(summary.startAt, "2026-09-15T00:00:00.000Z");
    assert.equal(summary.endAt, "2026-09-22T00:00:00.000Z");
    assert.equal(summary.daysWithActivity, 0);
    assert.equal(summary.days.length, 7);
    assert.deepEqual(
      summary.days.map((day) => day.date),
      [
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
        "2026-09-19",
        "2026-09-20",
        "2026-09-21",
      ],
    );
    assert.deepEqual(summary.totals, {
      completedSets: 0,
      recordedReps: emptyMetric,
      recordedDurationSeconds: emptyMetric,
      knownExternalVolumeKg: emptyMetric,
    });
  });

  it("includes more than twenty logs and remains unchanged while browsing history pages", async () => {
    const id = await fixtureMember(sql);
    for (let index = 1; index <= 27; index++)
      await log(id, new Date(now - index * 60_000).toISOString(), [
        { reps: index, weight: 1, unit: "kg" },
      ]);
    const summary = await read(id);
    const first = await fitness.listStrengthLogs(sql, id, { limit: 20 });
    assert.equal(first.logs.length, 20);
    assert.ok(first.nextCursor);
    const second = await fitness.listStrengthLogs(sql, id, { limit: 20, cursor: first.nextCursor });
    assert.equal(second.logs.length, 7);
    assert.deepEqual(await read(id), summary);
    assert.equal(summary.totals.completedSets, 27);
    assert.deepEqual(summary.totals.recordedReps, { value: 378, contributingSets: 27 });
    assert.equal(summary.daysWithActivity, 1);
    assert.equal(summary.days[6].completedSets, 27);
  });

  it("counts actual timed sets from unfinished and partly finished runs, never planned/skipped/unrecorded sets", async () => {
    const id = await fixtureMember(sql);
    const active = await run(id, now - 24 * hour);
    await save(id, active, [
      result(active, 0, { durationSeconds: 42.5 }),
      result(active, 1, { status: "skipped", durationSeconds: null }),
    ]);
    const partial = await run(id);
    await save(id, partial, [result(partial, 0, { durationSeconds: 37.5 })], true);
    const skipped = await run(id);
    await save(
      id,
      skipped,
      [result(skipped, 0, { status: "skipped", durationSeconds: null })],
      true,
    );
    await run(id); // A prescription and a start do not imply performed activity.
    const summary = await read(id);
    assert.equal(summary.totals.completedSets, 2);
    assert.equal(summary.daysWithActivity, 2);
    assert.deepEqual(summary.totals.recordedDurationSeconds, { value: 80, contributingSets: 2 });
    assert.deepEqual(summary.totals.recordedReps, emptyMetric);
    assert.deepEqual(summary.totals.knownExternalVolumeKg, emptyMetric);
    assert.equal(summary.days[5].completedSets, 1);
    assert.equal(summary.days[6].completedSets, 1);
  });

  it("combines both sources, reports exact metric coverage, and never infers body mass or missing actual quantities", async () => {
    const id = await fixtureMember(sql);
    await log(id, new Date(now).toISOString(), [
      { reps: 2, weight: 10, unit: "kg" },
      { reps: 4, weight: 5, unit: "lb" },
      { reps: 3, weight: null, unit: "kg" },
      { reps: 6, weight: null, unit: "bodyweight" },
    ]);
    const saved = await run(id, now, 4);
    await save(id, saved, [
      result(saved, 0, { reps: 2, durationSeconds: null, weight: 0, unit: "kg" }),
      result(saved, 1, { durationSeconds: 60, weight: 10, unit: "kg" }),
      result(saved, 2, { durationSeconds: null, distanceMeters: 50 }),
      result(saved, 3, { reps: 1, durationSeconds: null, weight: null, unit: "kg" }),
    ]);
    const summary = await read(id);
    assert.equal(summary.totals.completedSets, 8);
    assert.deepEqual(summary.totals.recordedReps, { value: 18, contributingSets: 6 });
    assert.deepEqual(summary.totals.recordedDurationSeconds, { value: 60, contributingSets: 1 });
    assert.deepEqual(summary.totals.knownExternalVolumeKg, { value: 29.072, contributingSets: 3 });
    assert.equal(summary.daysWithActivity, 1);
    const zeroOwner = await fixtureMember(sql);
    await log(zeroOwner, new Date(now).toISOString(), [{ reps: 2, weight: 0, unit: "kg" }]);
    assert.deepEqual((await read(zeroOwner)).totals.knownExternalVolumeKg, {
      value: 0,
      contributingSets: 1,
    });
  });

  it("uses start time boundaries including asOf, excluding old/future records from both sources", async () => {
    const id = await fixtureMember(sql);
    for (const startedAt of [
      "2026-09-14T23:59:59.999Z",
      "2026-09-15T00:00:00.000Z",
      "2026-09-21T12:00:00.000Z",
      "2026-09-21T12:00:00.001Z",
    ]) {
      const time = Date.parse(startedAt);
      await log(id, startedAt);
      const saved = await run(id, time);
      await save(id, saved, [result(saved, 0)]);
    }
    const summary = await read(id);
    assert.equal(summary.totals.completedSets, 4);
    assert.equal(summary.days[0].completedSets, 2);
    assert.equal(summary.days[6].completedSets, 2);
    assert.equal(summary.daysWithActivity, 2);
  });

  it("keeps owner records private and reflects corrections and deletion immediately", async () => {
    const id = await fixtureMember(sql),
      other = await fixtureMember(sql);
    const strength = await log(id, new Date(now).toISOString());
    const saved = await run(id);
    const recorded = await save(id, saved, [result(saved, 0, { reps: 10 })]);
    assert.equal((await read(id)).totals.completedSets, 2);
    assert.equal((await read(other)).totals.completedSets, 0);
    await fitness.updateStrengthLog(
      sql,
      id,
      strength.id,
      {
        ...logInput(new Date(now).toISOString(), [{ reps: 2, weight: null, unit: "kg" }]),
        expectedRevision: strength.revision,
      },
      now,
    );
    await save(id, recorded, [result(recorded, 0, { reps: 3, durationSeconds: null })]);
    const corrected = await read(id);
    assert.deepEqual(corrected.totals.recordedReps, { value: 5, contributingSets: 2 });
    assert.deepEqual(corrected.totals.recordedDurationSeconds, emptyMetric);
    assert.deepEqual(corrected.totals.knownExternalVolumeKg, emptyMetric);
    await fitness.deleteStrengthLog(sql, id, strength.id);
    assert.equal((await read(id)).totals.completedSets, 1);
    await plans.deleteRun(sql, id, saved.id);
    assert.equal((await read(id)).totals.completedSets, 0);
  });

  it("keeps imported Apple Health measurements separate even when manual activity has the same time", async () => {
    const id = await fixtureMember(sql);
    const connection = await health.connect(
      sql,
      id,
      { deviceId: randomUUID(), types: ["workout"] },
      now,
    );
    await health.sync(
      sql,
      id,
      {
        deviceId: connection.deviceId,
        generation: connection.generation,
        type: "workout",
        expectedSequence: 0,
        deletedIds: [],
        anchor: "synthetic",
        hasMore: false,
        records: [
          {
            externalId: randomUUID(),
            type: "workout",
            source: { bundleId: "synthetic.test", name: "Synthetic fixture" },
            startAt: new Date(now - hour).toISOString(),
            endAt: new Date(now).toISOString(),
            activity: "strength",
            durationSeconds: 3600,
            distanceMeters: null,
            activeEnergyKilocalories: 123,
          },
        ],
      },
      now,
    );
    assert.equal((await read(id)).totals.completedSets, 0);
    await log(id, new Date(now - hour).toISOString());
    const summary = await read(id);
    assert.equal(summary.totals.completedSets, 1);
    assert.deepEqual(summary.totals.recordedDurationSeconds, emptyMetric);
    assert.ok(!JSON.stringify(summary).includes("Synthetic fixture"));
  });

  for (const fixture of [
    {
      name: "spring forward",
      now: "2026-03-09T17:00:00.000Z",
      date: "2026-03-08",
      hours: 23,
      start: "2026-03-08T06:00:00.000Z",
      end: "2026-03-09T05:00:00.000Z",
      repeated: ["2026-03-08T07:30:00.000Z", "2026-03-08T08:30:00.000Z"],
    },
    {
      name: "fall back",
      now: "2026-11-02T18:00:00.000Z",
      date: "2026-11-01",
      hours: 25,
      start: "2026-11-01T05:00:00.000Z",
      end: "2026-11-02T06:00:00.000Z",
      repeated: ["2026-11-01T06:30:00.000Z", "2026-11-01T07:30:00.000Z"],
    },
  ]) {
    it(`uses seven local calendar days through ${fixture.name}, including every boundary set exactly once`, async () => {
      const id = await fixtureMember(sql),
        time = Date.parse(fixture.now);
      for (const instant of [fixture.start, ...fixture.repeated, fixture.end])
        await log(id, instant, undefined, time);
      const summary = await read(id, time, "America/Chicago");
      assert.equal(summary.days.length, 7);
      const day = summary.days.find((value) => value.date === fixture.date)!;
      assert.equal(day.startAt, fixture.start);
      assert.equal(day.endAt, fixture.end);
      assert.equal((Date.parse(day.endAt) - Date.parse(day.startAt)) / hour, fixture.hours);
      assert.equal(day.completedSets, 3);
      assert.equal(summary.days[6].completedSets, 1);
      assert.equal(summary.totals.completedSets, 4);
      assert.equal(summary.daysWithActivity, 2);
    });
  }

  it("rejects absent, oversized, unknown, offset, or extra query fields without reading records", async () => {
    const id = await fixtureMember(sql);
    for (const input of [
      {},
      { timeZone: "" },
      { timeZone: "a".repeat(101) },
      { timeZone: "UTC", cursor: "secret" },
    ])
      await assert.rejects(getFitnessActivitySummary(sql, id, input, now), z.ZodError);
    for (const timeZone of [
      "Moon/Base",
      "GMT+7",
      "+03:00",
      "PST",
      "America/Chicago'; select 1; --",
    ])
      await assert.rejects(
        getFitnessActivitySummary(sql, id, { timeZone }, now),
        (error: unknown) => error instanceof FitnessError && error.status === 400,
      );
  });

  it("allows paused owners to read but denies absent identity, deleted profile, and deleted account", async () => {
    await assert.rejects(
      read(randomUUID()),
      (error: unknown) => error instanceof FitnessError && error.status === 401,
    );
    const paused = await fixtureMember(sql);
    await log(paused, new Date(now).toISOString());
    await sql`update profiles set suspended_at = ${new Date(now)} where id = ${paused}`;
    assert.equal((await read(paused)).totals.completedSets, 1);
    const absentIdentity = await fixtureMember(sql);
    await sql`delete from "user" where id = ${absentIdentity}`;
    await assert.rejects(
      read(absentIdentity),
      (error: unknown) => error instanceof FitnessError && error.status === 401,
    );
    const markedDeleted = await fixtureMember(sql);
    await sql`update profiles set deleted_at = ${new Date(now)} where id = ${markedDeleted}`;
    await assert.rejects(
      read(markedDeleted),
      (error: unknown) => error instanceof FitnessError && error.status === 401,
    );
    const removed = await fixtureMember(sql);
    await log(removed, new Date(now).toISOString());
    await deleteAccount(sql, removed, now);
    await assert.rejects(
      read(removed),
      (error: unknown) => error instanceof FitnessError && error.status === 401,
    );
  });
});
