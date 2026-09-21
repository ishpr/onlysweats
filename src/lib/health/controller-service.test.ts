import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createHealthSyncController,
  type HealthNativeReader,
  type HealthRequest,
  type HealthTransport,
} from "../../../mobile/src/lib/health/controller.ts";
import { makeDb } from "../pace/test-db.ts";
import type { Sql } from "../db.ts";
import { ensureProfile } from "../pace/service.server.ts";
import { chatResponse, getHistory, setSettings } from "../conversation/service.server.ts";
import { CHAT_NOTICE_VERSION } from "../../../shared/conversation.ts";
import type {
  HealthDataType,
  HealthPage,
  HealthRecord,
  WorkoutRecord,
} from "../../../shared/health.ts";
import * as health from "./service.server.ts";

let sql: Sql;
const originalHealthEnabled = process.env.HEALTH_SYNC_ENABLED;
const now = Date.now();
const source = { bundleId: "app.samepace.synthetic", name: "Synthetic test recorder" };
const workout = (patch: Partial<WorkoutRecord> = {}): WorkoutRecord => ({
  type: "workout",
  externalId: randomUUID(),
  source,
  startAt: new Date(now - 3600_000).toISOString(),
  endAt: new Date(now - 1800_000).toISOString(),
  activity: "run",
  durationSeconds: 1800,
  distanceMeters: 3000,
  activeEnergyKilocalories: null,
  ...patch,
});
const heart = (value = 130): HealthRecord => ({
  type: "heart_rate",
  externalId: randomUUID(),
  source,
  startAt: new Date(now - 3000_000).toISOString(),
  endAt: new Date(now - 3000_000).toISOString(),
  value,
  unit: "bpm",
});
const page = (
  anchor: string,
  records: HealthRecord[] = [],
  deletedIds: string[] = [],
  hasMore = false,
): HealthPage => ({ anchor, records, deletedIds, hasMore });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
before(async () => {
  process.env.HEALTH_SYNC_ENABLED = "true";
  sql = await makeDb();
});
after(() => {
  if (originalHealthEnabled === undefined) delete process.env.HEALTH_SYNC_ENABLED;
  else process.env.HEALTH_SYNC_ENABLED = originalHealthEnabled;
});

async function fixture(
  options: {
    types?: HealthDataType[];
    read?: HealthNativeReader["readChanges"];
    afterCommit?: () => Promise<void>;
    beforeConnect?: () => Promise<void>;
    maxPages?: number;
  } = {},
) {
  const id = randomUUID(),
    deviceId = randomUUID();
  await sql`insert into "user" (id,name,email,"emailVerified") values (${id},'Sync fixture',${`${id}@example.test`},true)`;
  await ensureProfile(sql, { id, name: "Sync fixture", email: `${id}@example.test` });
  const connection = await health.connect(
    sql,
    id,
    { deviceId, types: options.types ?? ["workout"] },
    now,
  );
  let current = true;
  let prompts = 0;
  const reads: Parameters<HealthNativeReader["readChanges"]>[0][] = [];
  const writes: HealthRequest[] = [];
  const request = async (path: string, init: HealthRequest = {}) => {
    if (path === "/health/connection") {
      if (init.method === "DELETE") {
        await health.disconnect(sql, id);
        return { ok: true };
      }
      if (init.method === "POST") {
        await options.beforeConnect?.();
        return { connection: await health.connect(sql, id, init.json, now) };
      }
      return { connection: await health.getConnection(sql, id) };
    }
    assert.equal(path, "/health/sync");
    writes.push(init);
    const result = await health.sync(sql, id, init.json, now);
    await options.afterCommit?.();
    return { connection: result };
  };
  const controller = createHealthSyncController({
    ownerId: id,
    transport: { request: request as HealthTransport["request"], isCurrent: () => current },
    native: {
      isAvailable: async () => true,
      requestAuthorization: async () => {
        prompts++;
      },
      readChanges: async (input) => {
        reads.push(structuredClone(input));
        return options.read?.(input) ?? page("empty");
      },
    },
    getDeviceId: async () => deviceId,
    maxPages: options.maxPages,
  });
  return {
    id,
    deviceId,
    connection,
    controller,
    reads,
    writes,
    switchSession: () => {
      current = false;
    },
    get prompts() {
      return prompts;
    },
  };
}

describe("actual Health sync controller and persistence contract", () => {
  it("resumes a lost acknowledgement, applies corrections and replacements, and never revives a tombstone", async () => {
    const original = workout();
    const corrected = { ...original, durationSeconds: 1500 };
    const replacement = workout({ durationSeconds: 1200 });
    let loseResponse = true;
    const f = await fixture({
      maxPages: 1,
      read: async ({ anchor }) => {
        switch (anchor) {
          case null:
            return page("first", [original], [], true);
          case "first":
            return page("corrected", [corrected], [], true);
          case "corrected":
            return page("replaced", [replacement], [original.externalId], true);
          default:
            return page("done", [corrected, replacement]);
        }
      },
      afterCommit: async () => {
        if (loseResponse) {
          loseResponse = false;
          throw Object.assign(new Error("Lost acknowledgement"), { status: 0 });
        }
      },
    });
    await f.controller.sync();
    assert.equal(f.controller.getSnapshot().phase, "error");
    assert.equal((await health.getWorkout(sql, f.id, original.externalId)).revision, 1);
    await f.controller.sync();
    assert.deepEqual(
      f.reads.map((read) => read.anchor),
      [null, "first"],
    );
    assert.equal(f.controller.getSnapshot().hasMore, true);
    assert.equal(
      (await health.getWorkout(sql, f.id, original.externalId)).record.durationSeconds,
      1500,
    );
    await f.controller.sync();
    await f.controller.sync();
    const result = await health.listWorkouts(sql, f.id, { limit: 50 });
    assert.equal(result.workouts.length, 1);
    assert.equal(result.workouts[0].id, replacement.externalId);
    assert.equal(
      result.workouts[0].revision,
      1,
      "An exact replay cannot revise the remaining workout.",
    );
    assert.equal(f.controller.getSnapshot().hasMore, false);
    assert.equal(f.prompts, 0);
    assert.ok(f.reads.every((read) => read.sinceAt === f.connection.sinceAt));
  });

  it("a server permission change rejects an already-read page and prevents subsequent types from uploading", async () => {
    const began = gate(),
      release = gate();
    const f = await fixture({
      types: ["workout", "heart_rate"],
      read: async () => {
        began.resolve();
        await release.promise;
        return page("stale", [workout()], [], true);
      },
    });
    const run = f.controller.sync();
    await began.promise;
    const reduced = await health.connect(
      sql,
      f.id,
      { deviceId: f.deviceId, types: ["workout"] },
      now,
    );
    release.resolve();
    await run;
    assert.equal(f.writes.length, 1);
    assert.equal(f.reads.length, 1);
    assert.equal(f.controller.getSnapshot().phase, "error");
    assert.equal(f.controller.getSnapshot().connection?.generation, reduced.generation);
    assert.equal((await health.exportRecords(sql, f.id, { limit: 200 })).records.length, 0);
    assert.equal((await health.getConnection(sql, f.id))?.cursors.workout?.sequence, 0);
  });

  it("a session switch during a native read never sends its transient source page", async () => {
    const began = gate(),
      release = gate();
    const f = await fixture({
      read: async () => {
        began.resolve();
        await release.promise;
        return page("old-session", [workout()]);
      },
    });
    const run = f.controller.sync();
    await began.promise;
    f.switchSession();
    release.resolve();
    await run;
    assert.equal(f.writes.length, 0);
    assert.equal((await health.exportRecords(sql, f.id, { limit: 200 })).records.length, 0);
  });

  it("disconnect waits for a dispatched connection update, then purges that exact account", async () => {
    const began = gate(),
      release = gate();
    const f = await fixture({
      beforeConnect: async () => {
        began.resolve();
        await release.promise;
      },
    });
    const connecting = f.controller.connect(["workout", "heart_rate"]);
    await began.promise;
    const disconnecting = f.controller.disconnect();
    release.resolve();
    await Promise.all([connecting, disconnecting]);
    assert.equal(await health.getConnection(sql, f.id), null);
    assert.equal(f.controller.getSnapshot().connection, null);
    assert.equal((await sql`select * from health_cursors where user_id = ${f.id}`).length, 0);
  });
});

describe("imported summary freshness for private coaching", () => {
  it("late readings fence an in-flight summary; unchanged reimports preserve the completed conversation", async () => {
    const record = workout();
    let latestPage = page("workout", [record]);
    const f = await fixture({
      types: ["workout", "heart_rate"],
      read: async ({ type }) => (type === "workout" ? latestPage : page("heart-empty")),
    });
    await f.controller.sync();
    let { settings } = await setSettings(sql, f.id, {
      cloudEnabled: true,
      fitnessContextEnabled: true,
      noticeVersion: CHAT_NOTICE_VERSION,
    });
    const read = gate(),
      finish = gate();
    const response = await chatResponse(
      sql,
      f.id,
      {
        requestId: randomUUID(),
        text: "Summarize my recent workout",
        consentGeneration: settings.consentGeneration,
        historyGeneration: settings.historyGeneration,
      },
      new AbortController().signal,
      {
        available: true,
        provider: async ({ tools, onText }) => {
          await tools.workouts();
          read.resolve();
          await finish.promise;
          await onText("Stale synthetic summary.");
        },
      },
    );
    await read.promise;
    const connection = (await health.getConnection(sql, f.id))!;
    await health.sync(
      sql,
      f.id,
      {
        ...page("late-heart", [heart(145)]),
        type: "heart_rate",
        deviceId: f.deviceId,
        generation: connection.generation,
        expectedSequence: connection.cursors.heart_rate!.sequence,
      },
      now,
    );
    finish.resolve();
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, "error");
    assert.ok(!JSON.stringify(events).includes("Stale synthetic summary."));
    let history = await getHistory(sql, f.id);
    assert.equal(history.messages.length, 0);
    assert.notEqual(history.settings.historyGeneration, settings.historyGeneration);
    settings = history.settings;
    const current = await chatResponse(
      sql,
      f.id,
      {
        requestId: randomUUID(),
        text: "Summarize my recent workout",
        consentGeneration: settings.consentGeneration,
        historyGeneration: settings.historyGeneration,
      },
      new AbortController().signal,
      {
        available: true,
        provider: async ({ tools, onText }) => {
          const context = await tools.workouts();
          assert.match(JSON.stringify(context), /145/);
          await onText("The synthetic recorded mean is 145 bpm.");
        },
      },
    );
    assert.equal(JSON.parse((await current.text()).trim().split("\n").at(-1)!).type, "done");
    await f.controller.sync();
    history = await getHistory(sql, f.id);
    assert.equal(history.messages.length, 2);
    assert.equal(history.settings.historyGeneration, settings.historyGeneration);
    latestPage = page("corrected", [{ ...record, durationSeconds: 1500 }]);
    await f.controller.sync();
    history = await getHistory(sql, f.id);
    assert.equal(history.messages.length, 0);
    assert.notEqual(history.settings.historyGeneration, settings.historyGeneration);
    assert.equal(
      (await health.getWorkout(sql, f.id, record.externalId)).record.durationSeconds,
      1500,
    );
  });
});
