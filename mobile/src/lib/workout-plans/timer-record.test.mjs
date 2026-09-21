import assert from "node:assert/strict";
import test from "node:test";
import { emptySetFields } from "./forms.ts";
import { createOfflineWorkoutStore } from "./offline-store.ts";
import {
  acknowledgeUpload,
  hasPendingRun,
  newOfflineRun,
  OFFLINE_LEASE,
  prepareUpload,
  readOfflineDocument,
  resolveRunConflict,
} from "./offline-data.ts";
import {
  effectiveRunForTimer,
  makeStoredWorkoutTimer,
  readStoredWorkoutTimer,
  scopeForWorkoutTimer,
  writeOfflineTimer,
} from "./timer-record.ts";
import { createWorkoutTimer } from "./workout-timer.ts";

const now = Date.parse("2026-09-21T12:00:00Z");
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = () => ({
  id: uuid(1),
  revision: 1,
  planId: uuid(2),
  planRevision: 1,
  sessionId: null,
  startedAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  finishedAt: null,
  status: "in_progress",
  note: "",
  shareAccountability: false,
  results: [],
  snapshot: {
    title: "Synthetic timed intervals",
    activity: "mobility",
    instructions: "",
    exercises: [
      {
        id: uuid(3),
        name: "Hold",
        instructions: "",
        sets: [4, 5].map((id) => ({
          id: uuid(id),
          reps: null,
          durationSeconds: 60,
          distanceMeters: null,
          weight: null,
          unit: "bodyweight",
          restSeconds: 30,
        })),
      },
    ],
  },
});
const active = (id = 4) => ({
  exerciseId: uuid(3),
  setId: uuid(id),
  fields: { ...emptySetFields(), unit: "bodyweight" },
});
const actual = (id = 4, durationSeconds = 42) => ({
  exerciseId: uuid(3),
  setId: uuid(id),
  status: "completed",
  reps: null,
  durationSeconds,
  distanceMeters: null,
  weight: null,
  unit: "bodyweight",
});
const record = (run = base(), kind = "exercise", setId = 4, id = 10) =>
  makeStoredWorkoutTimer(run, kind, uuid(3), uuid(setId), uuid(id), now);
const document = (entry) => ({
  schema: 1,
  binding: "binding",
  ownerId: "owner",
  verifiedAt: now,
  runs: [entry],
});
function rig() {
  let raw = null,
    time = now,
    fail = false;
  const disk = {
    read: async () => (raw === null ? null : JSON.parse(raw)),
    write: async (value) => {
      if (fail) throw new Error("Disk unavailable");
      raw = JSON.stringify(value);
    },
    remove: async () => {
      raw = null;
    },
    now: () => time,
  };
  const launch = () => {
    const store = createOfflineWorkoutStore(disk);
    store.bind(Promise.resolve("binding"));
    return store;
  };
  return {
    disk,
    launch,
    tick: (ms) => {
      time += ms;
    },
    fail: (value) => {
      fail = value;
    },
    raw: () => raw && JSON.parse(raw),
  };
}
async function open(rig, store) {
  await store.verifyOwner("owner", () => true);
  await store.remember("owner", base(), () => true);
  return store.update(
    "owner",
    uuid(1),
    () => true,
    (entry) => writeOfflineTimer({ ...entry, active: active() }, record(), null),
  );
}

test("legacy documents normalize timer null and corrupt clocks drop only timer", () => {
  const entry = {
    ...newOfflineRun(base(), now),
    active: active(),
    draft: { results: [actual(5)], note: "Retained actuals", finish: false },
  };
  const legacy = structuredClone(entry);
  delete legacy.timer;
  const old = readOfflineDocument(document(legacy), "binding", now);
  assert.equal(old.runs[0].timer, null);
  const valid = { ...entry, timer: record(effectiveRunForTimer(entry)) };
  assert.ok(readOfflineDocument(document(valid), "binding", now).runs[0].timer);
  for (const patch of [
    (timer) => {
      timer.id = "invalid";
    },
    (timer) => {
      timer.targetSeconds = 59;
    },
    (timer) => {
      timer.exerciseId = uuid(99);
    },
    (timer) => {
      timer.clock.scope = "other workout";
    },
    (timer) => {
      timer.clock.elapsedMs = Infinity;
    },
    (timer) => {
      timer.clock.startedAtMs = now + 1;
    },
    (timer) => {
      timer.kind = ["exercise"];
    },
    (timer) => {
      timer.healthData = "must not store";
    },
  ]) {
    const changed = structuredClone(valid);
    patch(changed.timer);
    const parsed = readOfflineDocument(document(changed), "binding", now);
    assert.ok(parsed);
    assert.equal(parsed.runs[0].timer, null);
    assert.deepEqual(parsed.runs[0].draft, entry.draft);
  }
});

test("serialized running and paused clocks survive process restart without manufacturing actuals", async () => {
  const f = rig();
  let store = f.launch();
  await open(f, store);
  const saved = f.raw().runs[0];
  assert.equal(hasPendingRun(saved), false);
  assert.equal(saved.version, 0);
  assert.deepEqual(saved.draft.results, []);
  f.tick(12_000);
  store = f.launch();
  const [restored] = await store.list("owner", () => true);
  const clock = createWorkoutTimer({
    now: () => now + 12_000,
    isCurrent: () => true,
    scope: restored.timer.clock.scope,
    checkpoint: restored.timer.clock,
  });
  assert.equal(clock.read().elapsedSeconds, 12);
  assert.equal(clock.confirmedDuration(), null);
  clock.pause();
  await store.update(
    "owner",
    uuid(1),
    () => true,
    (entry) =>
      writeOfflineTimer(entry, { ...restored.timer, clock: clock.checkpoint() }, restored.timer.id),
  );
  f.tick(60_000);
  const [paused] = await f.launch().list("owner", () => true);
  const resumed = createWorkoutTimer({
    now: () => now + 72_000,
    isCurrent: () => true,
    scope: paused.timer.clock.scope,
    checkpoint: paused.timer.clock,
  });
  assert.equal(resumed.read().elapsedSeconds, 12);
  assert.equal(resumed.confirmedDuration(), 12);
  assert.equal(paused.version, 0);
  assert.deepEqual(paused.draft.results, []);
  assert.equal(paused.active.fields.durationSeconds, "");
});

test("uploading a previous set excludes the clock and its acknowledgement preserves active elapsed time", () => {
  let entry = {
    ...newOfflineRun(base(), now),
    version: 1,
    draft: { results: [actual()], note: "", finish: false },
  };
  entry = prepareUpload(entry, uuid(20));
  const payload = structuredClone(entry.pending);
  entry = { ...entry, active: active(5) };
  entry = writeOfflineTimer(entry, record(effectiveRunForTimer(entry), "exercise", 5), null);
  assert.deepEqual(entry.pending, payload);
  assert.equal("timer" in payload.payload, false);
  entry = acknowledgeUpload(entry, uuid(20), { ...entry.base, revision: 2, results: [actual()] });
  assert.ok(entry.timer);
  assert.equal(entry.timer.setId, uuid(5));
  const restored = createWorkoutTimer({
    now: () => now + 9_000,
    isCurrent: () => true,
    scope: entry.timer.clock.scope,
    checkpoint: entry.timer.clock,
  });
  assert.equal(restored.read().elapsedSeconds, 9);
  assert.deepEqual(entry.draft.results, [actual()]);
  assert.equal(hasPendingRun(entry), false);
});

test("clean server refresh preserves a compatible rest clock and new actuals invalidate only that clock", async () => {
  const f = rig(),
    store = f.launch();
  await store.verifyOwner("owner", () => true);
  const run = { ...base(), results: [actual()] };
  await store.remember("owner", run, () => true);
  await store.update(
    "owner",
    run.id,
    () => true,
    (entry) => writeOfflineTimer(entry, record(run, "rest"), null),
  );
  const refreshed = await store.remember("owner", { ...run, revision: 2 }, () => true);
  assert.ok(refreshed.timer);
  assert.equal(refreshed.timer.kind, "rest");
  const changed = await store.remember(
    "owner",
    { ...run, revision: 3, results: [actual(4, 39)] },
    () => true,
  );
  assert.equal(changed.timer, null);
  assert.equal(changed.draft.results[0].durationSeconds, 39);
});

test("current active set, completed rest set and exact target are required", () => {
  const run = base();
  const exercise = record(run);
  assert.equal(readStoredWorkoutTimer(exercise, run, null), null);
  assert.equal(readStoredWorkoutTimer(exercise, run, active(5)), null);
  assert.ok(readStoredWorkoutTimer(exercise, run, active()));
  const completed = { ...run, results: [actual()] };
  const rest = record(completed, "rest");
  assert.ok(readStoredWorkoutTimer(rest, completed, null));
  assert.equal(readStoredWorkoutTimer(rest, run, null), null);
  assert.equal(
    readStoredWorkoutTimer(
      rest,
      { ...completed, results: [{ ...actual(), status: "skipped", durationSeconds: null }] },
      null,
    ),
    null,
  );
  assert.notEqual(
    scopeForWorkoutTimer(run, "exercise", uuid(3), uuid(4)),
    scopeForWorkoutTimer(run, "rest", uuid(3), uuid(4)),
  );
  assert.throws(() => makeStoredWorkoutTimer(run, "exercise", uuid(3), uuid(4), "bad", now));
});

test("compare-and-set prevents an obsolete timer from replacing or clearing a newer timer", () => {
  let entry = { ...newOfflineRun(base(), now), active: active() };
  const first = record();
  entry = writeOfflineTimer(entry, first, null);
  const second = record(base(), "exercise", 4, 11);
  entry = writeOfflineTimer(entry, second, first.id);
  assert.throws(() => writeOfflineTimer(entry, first, first.id), /timer changed/);
  assert.throws(() => writeOfflineTimer(entry, null, first.id), /timer changed/);
  assert.equal(writeOfflineTimer(entry, null, second.id).timer, null);
  assert.equal(entry.version, 0);
  assert.throws(
    () => writeOfflineTimer({ ...entry, active: active(5) }, second, second.id),
    /current workout set/,
  );
});

test("conflict resolution and finishing discard clocks but retain valid entered results", () => {
  const run = base();
  let entry = {
    ...newOfflineRun(run, now),
    active: active(),
    draft: { results: [actual(5)], note: "Keep", finish: false },
  };
  entry = writeOfflineTimer(entry, record(effectiveRunForTimer(entry)), null);
  const conflict = { ...entry, conflict: { ...run, revision: 2 } };
  assert.equal(readOfflineDocument(document(conflict), "binding", now).runs[0].timer, null);
  assert.equal(resolveRunConflict(conflict, "local", now).timer, null);
  assert.equal(
    readOfflineDocument(
      document({ ...entry, draft: { ...entry.draft, finish: true } }),
      "binding",
      now,
    ).runs[0].timer,
    null,
  );
  assert.deepEqual(readOfflineDocument(document(conflict), "binding", now).runs[0].draft.results, [
    actual(5),
  ]);
  const finishedServer = {
    ...entry,
    base: {
      ...run,
      status: "completed",
      finishedAt: new Date(now).toISOString(),
      results: [actual(5)],
    },
  };
  assert.equal(readOfflineDocument(document(finishedServer), "binding", now).runs[0].timer, null);
});

test("failed storage, deletion, logout and expired owner lease cannot acknowledge or resurrect a clock", async () => {
  const f = rig(),
    store = f.launch();
  const original = await open(f, store);
  const pausedClock = createWorkoutTimer({
    now: () => now + 5_000,
    isCurrent: () => true,
    scope: original.timer.clock.scope,
    checkpoint: original.timer.clock,
  });
  pausedClock.pause();
  const paused = { ...original.timer, clock: pausedClock.checkpoint() };
  f.fail(true);
  await assert.rejects(
    store.update(
      "owner",
      uuid(1),
      () => true,
      (entry) => writeOfflineTimer(entry, paused, original.timer.id),
    ),
    /Disk unavailable/,
  );
  assert.equal(f.raw().runs[0].timer.clock.startedAtMs, now);
  f.fail(false);
  await store.remove("owner", uuid(1), () => true);
  await assert.rejects(
    store.update(
      "owner",
      uuid(1),
      () => true,
      (entry) => writeOfflineTimer(entry, paused, original.timer.id),
    ),
    /no longer saved/,
  );
  await store.remember("owner", base(), () => true);
  await store.clear();
  await assert.rejects(
    store.update(
      "owner",
      uuid(1),
      () => true,
      (entry) => entry,
    ),
    /Sign in/,
  );
  assert.equal(f.raw(), null);
  const next = f.launch();
  await open(f, next);
  f.tick(OFFLINE_LEASE);
  assert.deepEqual(await next.list("owner", () => true), []);
  await assert.rejects(
    next.update(
      "owner",
      uuid(1),
      () => true,
      (entry) => writeOfflineTimer(entry, null, original.timer.id),
    ),
    /verify your account/,
  );
});

test("logout while protected clock write is delayed removes the write before another identity can read", async () => {
  const f = rig(),
    store = f.launch();
  const entry = await open(f, store);
  const write = f.disk.write;
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  f.disk.write = async (value) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    await write(value);
  };
  const saving = store.update(
    "owner",
    uuid(1),
    () => true,
    (current) => writeOfflineTimer(current, entry.timer, entry.timer.id),
  );
  await started;
  const clear = store.clear();
  store.bind(Promise.resolve("new-binding"));
  release();
  await assert.rejects(saving, /account changed/);
  await clear;
  f.disk.write = write;
  await store.verifyOwner("new-owner", () => true);
  assert.deepEqual(f.raw().runs, []);
});
