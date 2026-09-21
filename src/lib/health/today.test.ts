import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import type { HealthConnection, HealthDataType, HealthRecord } from "../../../shared/health.ts";
import {
  pickForToday,
  readToday,
  type DaySnapshot,
  type DayTrends,
} from "../../../shared/today.ts";
import { HealthError } from "./contracts.ts";
import * as health from "./service.server.ts";
import { today } from "./today.server.ts";

let sql: Sql;
// Local midnight for a member in Dallas (UTC−5), and "now" at 1 pm their time.
const dayStart = "2026-09-21T05:00:00.000Z";
const now = Date.parse("2026-09-21T18:00:00.000Z");
const at = (hoursFromMidnight: number) =>
  new Date(Date.parse(dayStart) + hoursFromMidnight * 3_600_000).toISOString();
const watch = { bundleId: "com.apple.health.watch", name: "Watch" };
const phone = { bundleId: "com.apple.health.phone", name: "Phone" };
const rec = (type: HealthDataType, from: number, to: number, rest: object, source = watch) =>
  ({
    externalId: randomUUID(),
    source,
    startAt: at(from),
    endAt: at(to),
    type,
    ...rest,
  }) as HealthRecord;

const ALL: HealthDataType[] = [
  "workout",
  "heart_rate",
  "resting_heart_rate",
  "heart_rate_variability",
  "heart_rate_variability_rmssd",
  "cycling_power",
  "sleep",
  "steps",
  "active_energy",
  "blood_glucose",
];
async function member(records: HealthRecord[]) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Private member', ${`${id}@example.test`}, true)`;
  let connection: HealthConnection = await health.connect(
    sql,
    id,
    { deviceId: randomUUID(), types: ALL },
    now,
  );
  for (const type of ALL) {
    const page = records.filter((record) => record.type === type);
    if (page.length === 0) continue;
    connection = await health.sync(
      sql,
      id,
      {
        deviceId: connection.deviceId,
        generation: connection.generation,
        type,
        expectedSequence: connection.cursors[type]?.sequence ?? 0,
        records: page,
        deletedIds: [],
        anchor: "anchor",
        hasMore: false,
      },
      now,
    );
  }
  return id;
}
before(async () => {
  sql = await makeDb();
});

describe("the day summary", () => {
  it("needs a connection and a plausible local midnight", async () => {
    const stranger = randomUUID();
    await sql`insert into "user" (id, name, email, "emailVerified") values (${stranger}, 'No health', ${`${stranger}@example.test`}, true)`;
    await assert.rejects(
      today(sql, stranger, { dayStart }, now),
      (error: unknown) => error instanceof HealthError && error.status === 404,
    );
    const id = await member([]);
    await assert.rejects(
      today(sql, id, { dayStart: "2026-09-10T05:00:00.000Z" }, now),
      (error: unknown) => error instanceof HealthError && error.status === 400,
    );
    const empty = await today(sql, id, { dayStart }, now);
    assert.equal(empty.snapshot.sleepMin, null);
    assert.equal(empty.snapshot.hrvRmssdMs, null);
    assert.equal(empty.snapshot.hrvRmssdBase, null);
    assert.equal(empty.snapshot.hrvRmssdSource, null);
    assert.deepEqual(empty.trends.hrvRmssdWeek, [null, null, null, null, null, null, null]);
    assert.deepEqual(empty.trends.stepsWeek, [null, null, null, null, null, null, null]);
    assert.equal(readToday(empty.snapshot).status, "unknown");
  });

  it("counts overlapping sources once and keeps another member's data out", async () => {
    await member([rec("steps", 8, 9, { value: 9999, unit: "count" })]);
    const id = await member([
      // The watch and the phone both counted the same morning walk.
      rec("steps", 8, 9, { value: 4000, unit: "count" }),
      rec("steps", 10, 11, { value: 1500, unit: "count" }),
      rec("steps", 8, 9, { value: 3800, unit: "count" }, phone),
      rec("steps", -20, -19, { value: 7000, unit: "count" }),
      // Last night: two sources overlap; in-bed and awake time is not sleep.
      rec("sleep", -2, 6, { stage: "in_bed" }, phone),
      rec("sleep", -1, 2, { stage: "core" }),
      rec("sleep", 2, 3, { stage: "deep" }),
      rec("sleep", 3, 3.5, { stage: "awake" }),
      rec("sleep", 3.5, 6, { stage: "rem" }),
      rec("sleep", 0, 5, { stage: "asleep_unspecified" }, phone),
    ]);
    const { snapshot, trends } = await today(sql, id, { dayStart }, now);
    assert.equal(snapshot.steps, 5500);
    assert.equal(trends.stepsWeek[5], 7000);
    assert.equal(snapshot.sleepMin, 7 * 60);
    assert.deepEqual(trends.sleepStages, { deep: 60, core: 180, rem: 150, awake: 30 });
    // Just after the next midnight, nobody has slept yet: the same night still stands.
    const next = new Date(Date.parse(dayStart) + 86_400_000).toISOString();
    const late = await today(sql, id, { dayStart: next }, Date.parse(next) + 45 * 60_000);
    assert.equal(late.snapshot.sleepMin, 7 * 60);
    assert.equal(late.snapshot.steps, null);
    // By evening an untracked night is simply unknown.
    const evening = await today(sql, id, { dayStart: next }, Date.parse(next) + 20 * 3_600_000);
    assert.equal(evening.snapshot.sleepMin, null);
  });

  it("keeps RMSSD and cycling power out of SDNN and glucose summaries", async () => {
    const id = await member([
      rec("heart_rate_variability", 3, 3, { value: 58, unit: "ms" }),
      rec("heart_rate_variability_rmssd", 3, 3, { value: 24, unit: "ms" }),
      rec("cycling_power", 8, 8, { value: 210, unit: "W" }),
      rec("blood_glucose", 8, 8, { value: 104, unit: "mg/dL" }),
    ]);
    const result = await today(sql, id, { dayStart }, now);
    assert.equal(result.snapshot.hrvMs, 58);
    assert.equal(result.trends.hrvWeek[6], 58);
    assert.equal(result.snapshot.hrvRmssdMs, 24);
    assert.equal(result.trends.hrvRmssdWeek[6], 24);
    assert.deepEqual(result.trends.glucoseToday, [
      { minute: 480, value: 104, low: 104, high: 104 },
    ]);
    const onlyNewTypes = await member([
      rec("heart_rate_variability_rmssd", 3, 3, { value: 24, unit: "ms" }),
      rec("cycling_power", 8, 8, { value: 210, unit: "W" }),
    ]);
    const absent = await today(sql, onlyNewTypes, { dayStart }, now);
    assert.equal(absent.snapshot.hrvMs, null);
    assert.equal(absent.snapshot.hrvRmssdMs, 24);
    assert.equal(readToday(absent.snapshot, absent.trends).status, "observed");
    assert.deepEqual(readToday(absent.snapshot).lines, ["Recorded HRV (RMSSD): 24 ms."]);
    assert.deepEqual(absent.trends.glucoseToday, []);
  });

  it("reduces RMSSD from one source across the week without mixing SDNN or another member", async () => {
    await member([rec("heart_rate_variability_rmssd", 3, 3, { value: 900, unit: "ms" })]);
    const earlier = [-5, -4, -3, -2].map((day, index) =>
      rec("heart_rate_variability_rmssd", day * 24 + 3, day * 24 + 3, {
        value: 20 + index * 10,
        unit: "ms",
      }),
    );
    const id = await member([
      ...earlier,
      rec("heart_rate_variability_rmssd", 3, 3, { value: 40, unit: "ms" }),
      rec("heart_rate_variability_rmssd", 4, 4, { value: 60, unit: "ms" }),
      rec("heart_rate_variability_rmssd", 3, 3, { value: 200, unit: "ms" }, phone),
      rec("heart_rate_variability_rmssd", 4, 4, { value: 300, unit: "ms" }, phone),
      rec("heart_rate_variability", 3, 3, { value: 80, unit: "ms" }),
    ]);
    const { snapshot, trends } = await today(sql, id, { dayStart }, now);
    assert.equal(snapshot.hrvRmssdMs, 50);
    assert.equal(snapshot.hrvRmssdBase, 35);
    assert.deepEqual(snapshot.hrvRmssdSource, watch);
    assert.deepEqual(trends.hrvRmssdWeek, [null, 20, 30, 40, 50, null, 50]);
    assert.equal(snapshot.hrvMs, 80);
    assert.equal(snapshot.hrvBase, null);
    assert.deepEqual(trends.hrvWeek, [null, null, null, null, null, null, 80]);
  });

  it("uses a deterministic source tie-break and never fills a selected source's gaps from another app", async () => {
    const tie = await member([
      rec("heart_rate_variability_rmssd", 3, 3, { value: 30, unit: "ms" }),
      rec("heart_rate_variability_rmssd", 3, 3, { value: 70, unit: "ms" }, phone),
    ]);
    const picked = await today(sql, tie, { dayStart }, now);
    assert.deepEqual(picked.snapshot.hrvRmssdSource, phone);
    assert.equal(picked.snapshot.hrvRmssdMs, 70);
    const gap = await member([
      rec("heart_rate_variability_rmssd", -48, -48, { value: 30, unit: "ms" }),
      rec("heart_rate_variability_rmssd", -47, -47, { value: 40, unit: "ms" }),
      rec("heart_rate_variability_rmssd", 3, 3, { value: 70, unit: "ms" }, phone),
    ]);
    const missingRecent = await today(sql, gap, { dayStart }, now);
    assert.equal(missingRecent.snapshot.hrvRmssdMs, null);
    assert.deepEqual(missingRecent.snapshot.hrvRmssdSource, watch);
    assert.deepEqual(missingRecent.trends.hrvRmssdWeek, [null, null, null, null, 35, null, null]);
    assert.equal(readToday(missingRecent.snapshot, missingRecent.trends).status, "observed");
  });

  it("keeps unrecorded RMSSD null and removes it when its type is withdrawn", async () => {
    const sdnn = await member([rec("heart_rate_variability", 3, 3, { value: 58, unit: "ms" })]);
    const sdnnOnly = await today(sql, sdnn, { dayStart }, now);
    assert.equal(sdnnOnly.snapshot.hrvRmssdMs, null);
    assert.equal(sdnnOnly.snapshot.hrvRmssdSource, null);
    const id = await member([
      rec("heart_rate_variability_rmssd", -20, -20, { value: 25, unit: "ms" }),
    ]);
    assert.equal((await today(sql, id, { dayStart }, now)).snapshot.hrvRmssdMs, 25);
    const connection = (await health.getConnection(sql, id))!;
    await health.connect(
      sql,
      id,
      {
        deviceId: connection.deviceId,
        types: ALL.filter((type) => type !== "heart_rate_variability_rmssd"),
      },
      now,
    );
    const removed = await today(sql, id, { dayStart }, now);
    assert.equal(removed.snapshot.hrvRmssdMs, null);
    assert.equal(removed.snapshot.hrvRmssdSource, null);
    assert.deepEqual(removed.trends.hrvRmssdWeek, [null, null, null, null, null, null, null]);
    assert.equal(readToday(removed.snapshot, removed.trends).status, "unknown");
  });

  it("acknowledges chart-only synced readings without inventing other summary values", async () => {
    const id = await member([rec("blood_glucose", 8, 8, { value: 104, unit: "mg/dL" })]);
    const { snapshot, trends } = await today(sql, id, { dayStart }, now);
    assert.equal(snapshot.sleepMin, null);
    assert.equal(snapshot.steps, null);
    assert.equal(snapshot.restingHr, null);
    assert.equal(snapshot.hrvMs, null);
    assert.equal(readToday(snapshot, trends).status, "observed");
  });

  it("compares resting heart rate and HRV with the member's own week, and buckets today's heart rate", async () => {
    const earlier = [-5, -4, -3, -2].flatMap((day) => [
      rec("resting_heart_rate", day * 24 + 9, day * 24 + 9, { value: 56, unit: "bpm" }),
      rec("heart_rate_variability", day * 24 + 3, day * 24 + 3, { value: 60, unit: "ms" }),
    ]);
    const id = await member([
      ...earlier,
      rec("resting_heart_rate", 9, 9, { value: 63, unit: "bpm" }),
      rec("heart_rate_variability", 3, 3, { value: 58, unit: "ms" }),
      rec("heart_rate", 7.1, 7.1, { value: 100, unit: "bpm" }),
      rec("heart_rate", 7.2, 7.2, { value: 140, unit: "bpm" }),
      rec("heart_rate", 9.6, 9.6, { value: 70, unit: "bpm" }),
      rec("blood_glucose", 8, 8, { value: 104, unit: "mg/dL" }),
      rec("workout", 7, 8, {
        activity: "run",
        durationSeconds: 3000,
        distanceMeters: 8046.72,
        activeEnergyKilocalories: 410,
      }),
      rec("workout", -40, -39, {
        activity: "strength",
        durationSeconds: 2400,
        distanceMeters: null,
        activeEnergyKilocalories: null,
      }),
    ]);
    const { snapshot, trends } = await today(sql, id, { dayStart }, now);
    assert.equal(snapshot.restingHr, 63);
    assert.equal(snapshot.restingHrBase, 56);
    assert.equal(snapshot.weekWorkouts, 2);
    assert.deepEqual(
      snapshot.workouts.map((w) => [w.kind, w.minutes]),
      [["run", 50]],
    );
    assert.deepEqual(trends.heartToday, [
      { minute: 420, value: 120, low: 100, high: 140 },
      { minute: 570, value: 70, low: 70, high: 70 },
    ]);
    assert.deepEqual(trends.glucoseToday, [{ minute: 480, value: 104, low: 104, high: 104 }]);
    const read = readToday(snapshot);
    assert.equal(read.headline, "Your recorded activity");
    assert.equal(read.lines[0], "You ran 5.0 mi today — 50 min.");
    assert.equal(
      read.lines[1],
      "Recorded resting heart rate: 63 bpm — above your earlier recorded average.",
    );
  });
});

describe("reading the day", () => {
  const blank: DaySnapshot = {
    workouts: [],
    steps: null,
    sleepMin: null,
    sleepBaseMin: null,
    restingHr: null,
    restingHrBase: null,
    hrvMs: null,
    hrvBase: null,
    hrvRmssdMs: null,
    hrvRmssdBase: null,
    hrvRmssdSource: null,
    weekWorkouts: 0,
  };
  it("describes short and long sleep as observations, without changing an effort or readiness score", () => {
    const short = readToday({ ...blank, sleepMin: 5 * 60 + 20 });
    const long = readToday({ ...blank, sleepMin: 7 * 60 + 40 });
    assert.equal(short.status, "observed");
    assert.equal(long.status, "observed");
    assert.equal(short.headline, long.headline);
    assert.deepEqual(short.lines, ["You slept 5 h 20 min."]);
    assert.deepEqual(long.lines, ["You slept 7 h 40 min."]);
    assert.equal(
      readToday({ ...blank, sleepMin: 6 * 60 + 30, sleepBaseMin: 8 * 60 }).lines[0],
      "You slept 6 h 30 min — below your earlier recorded average.",
    );
    assert.deepEqual(readToday({ ...blank, weekWorkouts: 2 }), {
      status: "observed",
      headline: "Your recorded activity",
      lines: ["2 workouts in the last 7 days."],
    });
  });
  it("keeps missing readings missing and distinguishes recorded zero from absence", () => {
    assert.equal(readToday(blank).status, "unknown");
    assert.deepEqual(readToday({ ...blank, steps: 0 }), {
      status: "observed",
      headline: "Your recorded activity",
      lines: ["0 steps so far."],
    });
    assert.deepEqual(readToday({ ...blank, restingHr: 70 }).lines, [
      "Recorded resting heart rate: 70 bpm.",
    ]);
    assert.deepEqual(readToday({ ...blank, hrvMs: 20 }).lines, ["Recorded HRV (SDNN): 20 ms."]);
  });
  it("states numerical heart comparisons without physiological conclusions or SDNN/RMSSD conflation", () => {
    const read = readToday({ ...blank, restingHr: 70, restingHrBase: 55, hrvMs: 20, hrvBase: 60 });
    assert.equal(read.status, "observed");
    assert.deepEqual(read.lines, [
      "Recorded resting heart rate: 70 bpm — above your earlier recorded average.",
      "Recorded HRV (SDNN): 20 ms — below your earlier recorded average.",
    ]);
    assert.deepEqual(readToday({ ...blank, restingHr: 55, restingHrBase: 55 }).lines, [
      "Recorded resting heart rate: 55 bpm — equal to your earlier recorded average.",
    ]);
  });
  it("labels RMSSD independently and tolerates an older server without additive fields", () => {
    const observed = readToday({ ...blank, hrvMs: 60, hrvRmssdMs: 24, hrvRmssdBase: 30 });
    assert.deepEqual(observed.lines, [
      "Recorded HRV (SDNN): 60 ms.",
      "Recorded HRV (RMSSD): 24 ms — below your earlier recorded average.",
    ]);
    assert.equal(observed.status, "observed");
    const legacy: Partial<DaySnapshot> = { ...blank };
    delete legacy.hrvRmssdMs;
    delete legacy.hrvRmssdBase;
    delete legacy.hrvRmssdSource;
    const legacyTrends = {
      sleepWeek: [],
      sleepStages: null,
      restingHrWeek: [],
      hrvWeek: [],
      stepsWeek: [],
      moveKcalWeek: [],
      heartToday: [],
      glucoseToday: [],
    } as unknown as DayTrends;
    assert.equal(readToday(legacy as DaySnapshot, legacyTrends).status, "unknown");
  });

  it("ranks sessions using entered matches and start time without taking health state", () => {
    const sessions = [
      { id: "later-match", fitsMe: true, startAt: 3 },
      { id: "earlier-match", fitsMe: true, startAt: 2 },
      { id: "unknown", fitsMe: null, startAt: 1 },
      { id: "mismatch", fitsMe: false, startAt: 0 },
    ];
    assert.deepEqual(pickForToday(sessions), {
      id: "earlier-match",
      why: "Matches your entered level",
    });
    assert.deepEqual(pickForToday([sessions[2], sessions[3]]), {
      id: "unknown",
      why: "Upcoming session",
    });
    assert.equal(pickForToday([sessions[3]]), null);
    assert.equal(pickForToday([]), null);
  });
});
