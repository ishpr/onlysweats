import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import type {
  HealthConnection,
  HealthDataType,
  HealthRecord,
  HealthSyncInput,
  QuantityRecord,
  WorkoutRecord,
} from "../../../shared/health.ts";
import { HEALTH_TYPES, HealthError, healthRecord, pageInput, syncInput } from "./contracts.ts";
import { healthEnabled, MAX_HEALTH_BODY_BYTES, readHealthBody } from "./http.server.ts";
import * as health from "./service.server.ts";
import { summarizeWorkout } from "./summary.ts";

let sql: Sql;
const now = Date.parse("2026-09-21T12:00:00.000Z");
const source = { bundleId: "com.example.workouts", name: "Workout recorder" };
const workout = (patch: Partial<WorkoutRecord> = {}): WorkoutRecord => ({
  externalId: randomUUID(),
  source,
  startAt: "2026-09-20T10:00:00.000Z",
  endAt: "2026-09-20T11:00:00.000Z",
  type: "workout",
  activity: "run",
  durationSeconds: 3000,
  distanceMeters: 5000,
  activeEnergyKilocalories: null,
  ...patch,
});
const heart = (value = 140, patch: Partial<QuantityRecord> = {}): QuantityRecord =>
  ({
    externalId: randomUUID(),
    source,
    startAt: "2026-09-20T10:20:00.000Z",
    endAt: "2026-09-20T10:20:00.000Z",
    type: "heart_rate",
    value,
    unit: "bpm",
    ...patch,
  }) as QuantityRecord;
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (error: unknown) => error instanceof HealthError && error.status === status,
  );
async function member(types: HealthDataType[] = ["workout", "heart_rate"]) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Private member', ${`${id}@example.test`}, true)`;
  const connection = await health.connect(sql, id, { deviceId: randomUUID(), types }, now);
  return { id, connection };
}
function page(
  connection: HealthConnection,
  type: HealthDataType = "workout",
  patch: Partial<HealthSyncInput> = {},
): HealthSyncInput {
  return {
    deviceId: connection.deviceId,
    generation: connection.generation,
    type,
    expectedSequence: connection.cursors[type]?.sequence ?? 0,
    records: [],
    deletedIds: [],
    anchor: "opaque-anchor-1",
    hasMore: false,
    ...patch,
  };
}
before(async () => {
  sql = await makeDb();
});

describe("private health connection and import", () => {
  it("requires explicit workout selection, deduplicates configuration order, and preserves cursors for an identical opt-in", async () => {
    const { id, connection } = await member();
    assert.equal(connection.sinceAt, "2026-08-22T12:00:00.000Z");
    assert.equal(connection.lastSyncedAt, null);
    const synced = await health.sync(sql, id, page(connection), now);
    const again = await health.connect(
      sql,
      id,
      { deviceId: connection.deviceId, types: ["heart_rate", "workout"] },
      now + 1000,
    );
    assert.deepEqual(again, synced);
    await assert.rejects(
      health.connect(sql, id, { deviceId: connection.deviceId, types: ["heart_rate"] }),
      z.ZodError,
    );
    await assert.rejects(
      health.connect(sql, id, { deviceId: connection.deviceId, types: ["workout", "workout"] }),
      z.ZodError,
    );
  });

  it("keeps one installation and rejects stale device/generation requests without advancing cursors", async () => {
    const { id, connection } = await member();
    const replacement = await health.connect(
      sql,
      id,
      { deviceId: randomUUID(), types: connection.types },
      now + 86_400_000,
    );
    assert.notEqual(replacement.generation, connection.generation);
    assert.equal(replacement.sinceAt, connection.sinceAt);
    await rejects(
      health.sync(sql, id, page(connection, "workout", { records: [workout()] }), now),
      409,
    );
    await rejects(
      health.sync(sql, id, page(replacement, "workout", { deviceId: connection.deviceId }), now),
      409,
    );
    assert.equal((await health.getConnection(sql, id))?.cursors.workout?.sequence, 0);
  });

  it("commits records and anchors together; replayed acknowledgements conflict without duplicate data", async () => {
    const { id, connection } = await member();
    const record = workout();
    const first = page(connection, "workout", { records: [record] });
    const synced = await health.sync(sql, id, first, now);
    assert.deepEqual(synced.cursors.workout, { sequence: 1, anchor: first.anchor });
    assert.equal(synced.lastSyncedAt, new Date(now).toISOString());
    await rejects(health.sync(sql, id, first, now), 409);
    assert.equal((await health.getWorkout(sql, id, record.externalId)).revision, 1);
    const identical = await health.sync(
      sql,
      id,
      page(synced, "workout", { records: [record] }),
      now + 500,
    );
    assert.equal((await health.getWorkout(sql, id, record.externalId)).revision, 1);
    const replayed = await health.sync(
      sql,
      id,
      page(identical, "workout", { records: [{ ...record, durationSeconds: 2900 }] }),
      now + 1000,
    );
    assert.equal(replayed.cursors.workout?.sequence, 3);
    const rows = await health.listWorkouts(sql, id, { limit: 50 });
    assert.equal(rows.workouts.length, 1);
    assert.equal(rows.workouts[0].record.durationSeconds, 2900);
    assert.equal(rows.workouts[0].revision, 2);
    assert.equal(rows.workouts[0].importedAt, new Date(now).toISOString());
  });

  it("isolates source IDs, reads, deletes, exports, and heart samples by signed-in member", async () => {
    const a = await member();
    const b = await member();
    const record = workout();
    await health.sync(sql, a.id, page(a.connection, "workout", { records: [record] }), now);
    await health.sync(sql, b.id, page(b.connection, "heart_rate", { records: [heart(190)] }), now);
    await rejects(health.getWorkout(sql, b.id, record.externalId), 404);
    await rejects(health.deleteWorkout(sql, b.id, record.externalId), 404);
    await rejects(health.sync(sql, b.id, page(a.connection)), 409);
    assert.equal(
      (await health.getWorkout(sql, a.id, record.externalId)).heartRate.availability,
      "unavailable",
    );
    assert.equal((await health.exportRecords(sql, b.id, { limit: 200 })).records.length, 1);
    await health.sync(sql, b.id, page(b.connection, "workout", { records: [record] }), now);
    assert.equal((await health.listWorkouts(sql, b.id, { limit: 50 })).workouts.length, 1);
    await health.deleteWorkout(sql, a.id, record.externalId);
    assert.equal((await health.getWorkout(sql, b.id, record.externalId)).id, record.externalId);
  });

  it("rejects a type the member did not opt into", async () => {
    const { id, connection } = await member(["workout"]);
    await rejects(
      health.sync(sql, id, page(connection, "heart_rate", { records: [heart()] }), now),
      403,
    );
    assert.equal((await health.exportRecords(sql, id, { limit: 200 })).records.length, 0);
  });

  it("stores authorized optional metrics with their source units and exports every selected type", async () => {
    const { id, connection } = await member([...HEALTH_TYPES]);
    const base = { source, startAt: "2026-09-20T10:20:00.000Z", endAt: "2026-09-20T10:20:00.000Z" };
    const records: HealthRecord[] = [
      workout(),
      heart(),
      { ...base, externalId: randomUUID(), type: "resting_heart_rate", value: 62, unit: "bpm" },
      {
        ...base,
        externalId: randomUUID(),
        type: "heart_rate_variability",
        value: 45.5,
        unit: "ms",
      },
      {
        ...base,
        externalId: randomUUID(),
        type: "heart_rate_variability_rmssd",
        value: 37.2,
        unit: "ms",
      },
      { ...base, externalId: randomUUID(), type: "cycling_power", value: 182, unit: "W" },
      { ...base, externalId: randomUUID(), type: "steps", value: 400, unit: "count" },
      { ...base, externalId: randomUUID(), type: "distance", value: 320.25, unit: "m" },
      { ...base, externalId: randomUUID(), type: "active_energy", value: 70.2, unit: "kcal" },
      { ...base, externalId: randomUUID(), type: "sleep", stage: "deep" },
    ];
    for (const record of records)
      await health.sync(sql, id, page(connection, record.type, { records: [record] }), now);
    const exported = await health.exportRecords(sql, id, { limit: 200 });
    assert.equal(exported.records.length, HEALTH_TYPES.length);
    assert.deepEqual(new Set(exported.records.map((record) => record.type)), new Set(HEALTH_TYPES));
    const synced = await health.getConnection(sql, id);
    await health.sync(
      sql,
      id,
      page(synced!, "heart_rate", { deletedIds: [records[1].externalId, records[1].externalId] }),
      now,
    );
    assert.equal(
      (await health.getWorkout(sql, id, records[0].externalId)).heartRate.availability,
      "unavailable",
    );
    const [deleted] =
      await sql`select record, imported_at from health_records where user_id = ${id} and type = 'heart_rate'`;
    assert.deepEqual(deleted, { record: null, imported_at: null });
  });

  it("serializes duplicate pages and disconnect against in-flight synchronization", async () => {
    const { id, connection } = await member();
    const input = page(connection, "workout", { records: [workout()] });
    const outcomes = await Promise.allSettled([
      health.sync(sql, id, input, now),
      health.sync(sql, id, input, now),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(
      rejected?.status === "rejected" &&
        rejected.reason instanceof HealthError &&
        rejected.reason.status === 409,
    );
    const latest = await health.getConnection(sql, id);
    await Promise.all([
      health.sync(sql, id, page(latest!, "workout", { records: [workout()] }), now),
      health.disconnect(sql, id),
    ]);
    assert.equal(await health.getConnection(sql, id), null);
    assert.equal((await health.exportRecords(sql, id, { limit: 200 })).records.length, 0);
    await rejects(health.sync(sql, id, page(latest!), now), 409);
  });

  it("permission removal purges measurements, rotates generation, and invalidates every in-flight page", async () => {
    const { id, connection } = await member();
    const record = workout();
    await health.sync(sql, id, page(connection, "workout", { records: [record] }), now);
    await health.sync(sql, id, page(connection, "heart_rate", { records: [heart()] }), now);
    const reduced = await health.connect(
      sql,
      id,
      { deviceId: connection.deviceId, types: ["workout"] },
      now + 1000,
    );
    assert.notEqual(reduced.generation, connection.generation);
    assert.deepEqual(reduced.cursors, { workout: { sequence: 0, anchor: null } });
    assert.equal(reduced.sinceAt, connection.sinceAt);
    await rejects(
      health.sync(
        sql,
        id,
        page(connection, "heart_rate", { expectedSequence: 1, records: [heart()] }),
        now,
      ),
      409,
    );
    assert.deepEqual((await health.exportRecords(sql, id, { limit: 200 })).records, [record]);
    assert.equal(
      (await health.getWorkout(sql, id, record.externalId)).heartRate.availability,
      "unavailable",
    );
  });

  it("user deletion scrubs the whole record and tombstones block reimport, including uppercase UUIDs", async () => {
    const { id, connection } = await member();
    const record = workout();
    const synced = await health.sync(
      sql,
      id,
      page(connection, "workout", { records: [record] }),
      now,
    );
    await health.deleteWorkout(sql, id, record.externalId);
    await health.deleteWorkout(sql, id, record.externalId);
    const [tombstone] = await sql`select * from health_records where user_id = ${id}`;
    assert.deepEqual(tombstone, {
      user_id: id,
      type: "workout",
      external_id: record.externalId,
      record: null,
      imported_at: null,
      revision: 2,
    });
    await health.sync(
      sql,
      id,
      page(synced, "workout", {
        records: [{ ...record, externalId: record.externalId.toUpperCase() }],
      }),
      now,
    );
    await rejects(health.getWorkout(sql, id, record.externalId), 404);
    assert.deepEqual((await health.exportRecords(sql, id, { limit: 200 })).records, []);
  });

  it("HealthKit deletions win within a page and before a later import; replacement source UUIDs still work", async () => {
    const { id, connection } = await member();
    const first = workout();
    const future = workout();
    const synced = await health.sync(
      sql,
      id,
      page(connection, "workout", {
        records: [first],
        deletedIds: [first.externalId, future.externalId],
      }),
      now,
    );
    await health.sync(
      sql,
      id,
      page(synced, "workout", { records: [first, future, workout()] }),
      now,
    );
    assert.equal((await health.listWorkouts(sql, id, { limit: 50 })).workouts.length, 1);
  });

  it("disconnect purges data, tombstones and cursors; reconnect creates a new authorization generation", async () => {
    const { id, connection } = await member();
    const record = workout();
    await health.sync(
      sql,
      id,
      page(connection, "workout", { records: [record], deletedIds: [randomUUID()] }),
      now,
    );
    await health.disconnect(sql, id);
    await health.disconnect(sql, id);
    assert.equal(await health.getConnection(sql, id), null);
    assert.equal((await sql`select * from health_records where user_id = ${id}`).length, 0);
    assert.equal((await sql`select * from health_cursors where user_id = ${id}`).length, 0);
    await rejects(
      health.sync(sql, id, page(connection, "workout", { expectedSequence: 1 }), now),
      409,
    );
    const reconnected = await health.connect(
      sql,
      id,
      { deviceId: connection.deviceId, types: connection.types },
      now,
    );
    assert.notEqual(reconnected.generation, connection.generation);
    await rejects(health.sync(sql, id, page(connection), now), 409);
    // Full purge intentionally removes suppression IDs; a new explicit opt-in
    // can import existing HealthKit history again.
    await health.sync(sql, id, page(reconnected, "workout", { records: [record] }), now);
    assert.equal((await health.listWorkouts(sql, id, { limit: 50 })).workouts.length, 1);
  });

  it("auth identity deletion cascades all health data without deleting another member", async () => {
    const a = await member();
    const b = await member();
    await health.sync(
      sql,
      a.id,
      page(a.connection, "workout", { records: [workout()], deletedIds: [randomUUID()] }),
      now,
    );
    await sql`delete from "user" where id = ${a.id}`;
    for (const table of ["health_connections", "health_cursors", "health_records"]) {
      assert.equal(
        (await sql.query(`select * from ${table} where user_id = $1`, [a.id])).length,
        0,
      );
    }
    await rejects(health.sync(sql, a.id, page(a.connection)), 401);
    assert.ok(await health.getConnection(sql, b.id));
  });

  it("rejects an invalid batch without storing any records, deletions or anchor", async () => {
    const { id, connection } = await member();
    const valid = workout();
    await assert.rejects(
      health.sync(
        sql,
        id,
        page(connection, "workout", {
          records: [valid, { ...workout(), distanceMeters: -1 }],
          deletedIds: [randomUUID()],
        }),
        now,
      ),
      z.ZodError,
    );
    assert.equal((await sql`select * from health_records where user_id = ${id}`).length, 0);
    assert.deepEqual((await health.getConnection(sql, id))?.cursors.workout, {
      sequence: 0,
      anchor: null,
    });
    await rejects(
      health.sync(
        sql,
        id,
        page(connection, "workout", {
          records: [
            valid,
            workout({ startAt: "2026-09-22T10:00:00.000Z", endAt: "2026-09-22T11:00:00.000Z" }),
          ],
        }),
        now,
      ),
      400,
    );
    assert.equal((await sql`select * from health_records where user_id = ${id}`).length, 0);
  });

  it("rolls back preceding writes and keeps the old anchor when a database write fails", async () => {
    const { id, connection } = await member();
    // Force an actual PostgreSQL constraint failure on the second row, after
    // the first insert, to exercise transaction rollback rather than parsing.
    const failed = workout();
    await sql.query(
      `alter table health_records add constraint health_test_failure check (external_id <> '${failed.externalId}'::uuid)`,
    );
    try {
      await assert.rejects(
        health.sync(sql, id, page(connection, "workout", { records: [workout(), failed] }), now),
      );
      assert.equal((await sql`select * from health_records where user_id = ${id}`).length, 0);
      assert.deepEqual((await health.getConnection(sql, id))?.cursors.workout, {
        sequence: 0,
        anchor: null,
      });
    } finally {
      await sql`alter table health_records drop constraint health_test_failure`;
    }
  });

  it("allows a sleep interval overlapping the fixed initial boundary but rejects older samples", async () => {
    const { id, connection } = await member(["workout", "sleep"]);
    const sleep: HealthRecord = {
      externalId: randomUUID(),
      source,
      type: "sleep",
      stage: "asleep_unspecified",
      startAt: "2026-08-22T10:00:00.000Z",
      endAt: "2026-08-22T13:00:00.000Z",
    };
    const synced = await health.sync(sql, id, page(connection, "sleep", { records: [sleep] }), now);
    await rejects(
      health.sync(
        sql,
        id,
        page(synced, "sleep", {
          records: [{ ...sleep, externalId: randomUUID(), endAt: "2026-08-22T11:00:00.000Z" }],
        }),
        now,
      ),
      400,
    );
  });

  it("uses stable pagination and rejects malformed or cross-kind page cursors", async () => {
    const { id, connection } = await member();
    const records = [workout(), workout(), workout()];
    await health.sync(sql, id, page(connection, "workout", { records }), now);
    const first = await health.listWorkouts(sql, id, { limit: 2 });
    assert.equal(first.workouts.length, 2);
    assert.ok(first.nextCursor);
    const second = await health.listWorkouts(sql, id, { limit: 2, cursor: first.nextCursor });
    assert.equal(second.workouts.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.workouts, ...second.workouts].map((row) => row.id)).size, 3);
    const exported = await health.exportRecords(sql, id, { limit: 2 });
    const remainder = await health.exportRecords(sql, id, {
      limit: 2,
      cursor: exported.nextCursor!,
    });
    assert.equal(remainder.records.length, 1);
    assert.equal(remainder.nextCursor, null);
    await rejects(health.listWorkouts(sql, id, { limit: 2, cursor: "not-base64-json" }), 400);
    await rejects(health.listWorkouts(sql, id, { limit: 2, cursor: exported.nextCursor! }), 400);
    assert.throws(() => pageInput(50).parse({ limit: 51 }), z.ZodError);
    assert.throws(() => pageInput(200).parse({ limit: -1 }), z.ZodError);
  });

  it("summarizes source-reported duration and only same-source heart rate inside this workout", async () => {
    const { id, connection } = await member();
    const record = workout();
    await health.sync(sql, id, page(connection, "workout", { records: [record] }), now);
    await health.sync(
      sql,
      id,
      page(connection, "heart_rate", {
        records: [
          heart(120),
          heart(160, { startAt: "2026-09-20T10:30:00.000Z", endAt: "2026-09-20T10:30:00.000Z" }),
          heart(200, { source: { bundleId: "another.recorder", name: "Different source" } }),
          heart(80, { startAt: "2026-09-20T09:59:00.000Z", endAt: "2026-09-20T10:01:00.000Z" }),
          heart(190, { startAt: "2026-09-20T10:59:00.000Z", endAt: "2026-09-20T11:01:00.000Z" }),
        ],
      }),
      now,
    );
    const result = await health.getWorkout(sql, id, record.externalId);
    assert.equal(result.elapsedSeconds, 3600);
    assert.equal(result.paceSecondsPerKilometer, 600);
    assert.equal(result.record.activeEnergyKilocalories, null);
    assert.deepEqual(result.heartRate, {
      availability: "available",
      sampleCount: 2,
      minBpm: 120,
      maxBpm: 160,
      sampleMeanBpm: 140,
      firstSampleAt: "2026-09-20T10:20:00.000Z",
      lastSampleAt: "2026-09-20T10:30:00.000Z",
    });
  });
});

describe("health validation and deterministic summaries", () => {
  it("rejects mismatched units/types, non-finite/negative quantities, bad time ranges and unknown fields", () => {
    for (const invalid of [
      { ...heart(), unit: "ms" },
      { ...heart(), value: Infinity },
      { ...heart(), value: NaN },
      { ...heart(), value: -1 },
      { ...heart(), value: 0 },
      { ...heart(), privateNote: "not permitted" },
      { ...heart(), startAt: "2026-09-20T11:00:00.000Z" },
      { ...workout(), durationSeconds: 3602 },
      { ...workout(), durationSeconds: -1 },
      { ...workout(), distanceMeters: Infinity },
      { ...heart(), type: "steps", unit: "count", value: 1.5 },
    ])
      assert.equal(healthRecord.safeParse(invalid).success, false);
  });

  it("bounds pages, anchors and duplicate source IDs before import", () => {
    const connection = {
      deviceId: randomUUID(),
      generation: randomUUID(),
      cursors: {},
    } as HealthConnection;
    const record = workout();
    for (const invalid of [
      page(connection, "workout", { records: [record, record] }),
      page(connection, "workout", { records: [heart()] }),
      page(connection, "workout", { records: Array.from({ length: 201 }, () => workout()) }),
      page(connection, "workout", { deletedIds: Array.from({ length: 201 }, () => randomUUID()) }),
      page(connection, "workout", { anchor: "a".repeat(16385) }),
    ])
      assert.equal(syncInput.safeParse(invalid).success, false);
  });

  it("keeps missing data explicit and calculates pace only from eligible activity and measured distance", () => {
    const record = workout();
    const result = summarizeWorkout(record, new Date(now).toISOString(), [heart(130), heart(150)]);
    assert.equal(result.paceSecondsPerKilometer, 600);
    assert.equal(result.heartRate.sampleMeanBpm, 140);
    for (const patch of [
      { activity: "ride" as const },
      { distanceMeters: null },
      { distanceMeters: 0 },
      { durationSeconds: 0 },
    ]) {
      const unavailable = summarizeWorkout(
        { ...record, ...patch },
        new Date(now).toISOString(),
        [],
      );
      assert.equal(unavailable.paceSecondsPerKilometer, null);
      assert.equal(unavailable.heartRate.sampleCount, 0);
      assert.equal(unavailable.heartRate.sampleMeanBpm, null);
    }
  });
});

describe("health HTTP boundary", () => {
  it("defaults off and requires the exact feature flag", () => {
    const previous = process.env.HEALTH_SYNC_ENABLED;
    try {
      for (const value of [undefined, "", "1", "TRUE", "false"]) {
        if (value === undefined) delete process.env.HEALTH_SYNC_ENABLED;
        else process.env.HEALTH_SYNC_ENABLED = value;
        assert.equal(healthEnabled(), false);
      }
      process.env.HEALTH_SYNC_ENABLED = "true";
      assert.equal(healthEnabled(), true);
    } finally {
      if (previous === undefined) delete process.env.HEALTH_SYNC_ENABLED;
      else process.env.HEALTH_SYNC_ENABLED = previous;
    }
  });

  it("accepts JSON and rejects oversized declared or streamed bodies", async () => {
    const request = (body: string, headers?: HeadersInit) =>
      new Request("https://example.test/health/sync", { method: "POST", body, headers });
    assert.deepEqual(await readHealthBody(request('{"records":[]}')), { records: [] });
    await rejects(
      readHealthBody(request("{}", { "content-length": String(MAX_HEALTH_BODY_BYTES + 1) })),
      413,
    );
    await rejects(readHealthBody(request("x".repeat(MAX_HEALTH_BODY_BYTES + 1))), 413);
    await rejects(readHealthBody(request('{"records": "private incomplete')), 400);
  });
});

describe("recorded workout zones and automatic sync consent", () => {
  const zones: NonNullable<WorkoutRecord["zones"]> = [
    {
      metric: "heart_rate",
      unit: "bpm",
      source: "user",
      zones: [
        { index: 0, minimum: null, maximum: 130, durationSeconds: 0 },
        { index: 1, minimum: 130, maximum: null, durationSeconds: null },
      ],
    },
  ];
  it("preserves source boundaries, zero vs missing duration, and rejects unconsented nested readings", async () => {
    const denied = await member(["workout"]);
    const record = workout({ zones });
    await rejects(
      health.sync(sql, denied.id, page(denied.connection, "workout", { records: [record] }), now),
      403,
    );
    assert.equal((await health.getConnection(sql, denied.id))?.cursors.workout?.sequence, 0);
    const allowed = await member();
    await health.sync(
      sql,
      allowed.id,
      page(allowed.connection, "workout", { records: [record] }),
      now,
    );
    assert.deepEqual(
      (await health.getWorkout(sql, allowed.id, record.externalId)).record.zones,
      zones,
    );
    await health.connect(
      sql,
      allowed.id,
      { deviceId: allowed.connection.deviceId, types: ["workout"] },
      now,
    );
    const scrubbed = await health.getWorkout(sql, allowed.id, record.externalId);
    assert.deepEqual(scrubbed.record.zones, []);
    assert.equal(scrubbed.revision, 2);
  });
  it("requires explicit automatic opt-in and rotates generation when it is revoked", async () => {
    const { id, connection } = await member();
    assert.equal(connection.automaticSync, false);
    const opted = await health.connect(
      sql,
      id,
      { deviceId: connection.deviceId, types: connection.types, automaticSync: true },
      now,
    );
    assert.equal(opted.automaticSync, true);
    const revoked = await health.connect(
      sql,
      id,
      { deviceId: connection.deviceId, types: connection.types, automaticSync: false },
      now,
    );
    assert.equal(revoked.automaticSync, false);
    await rejects(health.sync(sql, id, page(opted)), 409);
  });
  it("rejects inverted, overlapping, duplicate or wrongly labelled zones", () => {
    for (const invalid of [
      [{ ...zones[0], unit: "W" }],
      [zones[0], zones[0]],
      [{ ...zones[0], zones: [{ index: 0, minimum: 140, maximum: 130, durationSeconds: 1 }] }],
      [{ ...zones[0], zones: [zones[0].zones[0], { ...zones[0].zones[1], minimum: 120 }] }],
    ])
      assert.throws(
        () => healthRecord.parse(workout({ zones: invalid as WorkoutRecord["zones"] })),
        z.ZodError,
      );
  });
});
