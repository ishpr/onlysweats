import assert from "node:assert/strict";
import test from "node:test";
import { createAppTermsStore, permitsAppAccess } from "../app-terms-store.ts";
import { APP_TERMS_VERSION } from "../../../../shared/app-terms.ts";
import { createOfflineWorkoutStore } from "./offline-store.ts";
import { createOfflineWorkoutSync } from "./offline-sync.ts";
import {
  OFFLINE_LEASE,
  hasPendingRun,
  validRun,
  resolveRunConflict,
  activeEditorFromEntry,
} from "./offline-data.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64),
  otherHash = "b".repeat(64);
const start = Date.parse("2026-09-21T12:00:00Z");
const accepted = {
  ownerId: "synthetic-owner",
  version: APP_TERMS_VERSION,
  accepted: true,
  acceptedVersion: APP_TERMS_VERSION,
  acceptedAt: new Date(start).toISOString(),
};
const fresh = { ...accepted, accepted: false, acceptedVersion: null, acceptedAt: null };
const actual = (n, reps) => ({
  exerciseId: id(3),
  setId: id(n),
  status: "completed",
  reps,
  durationSeconds: null,
  distanceMeters: null,
  weight: null,
  unit: "kg",
});
const skipped = { ...actual(6, null), status: "skipped" };
const base = {
  id: id(1),
  revision: 1,
  planId: id(2),
  planRevision: 1,
  sessionId: null,
  startedAt: new Date(start).toISOString(),
  updatedAt: new Date(start).toISOString(),
  finishedAt: null,
  status: "in_progress",
  note: "",
  shareAccountability: false,
  results: [],
  snapshot: {
    title: "Synthetic restart acceptance",
    activity: "strength",
    instructions: "",
    exercises: [
      {
        id: id(3),
        name: "Squat",
        instructions: "",
        sets: [4, 5, 6].map((n) => ({
          id: id(n),
          reps: 10,
          durationSeconds: null,
          distanceMeters: null,
          weight: 20,
          unit: "kg",
          restSeconds: 60,
        })),
      },
    ],
  },
};
// Real stores and sync orchestration with synthetic storage and server responses.
// Recreating both stores simulates a process restart; native encryption needs device acceptance.
function rig() {
  let termsRaw = null,
    workoutRaw = null,
    time = start,
    failDisk = false,
    nextId = 100;
  const termsDisk = {
    read: async () => termsRaw,
    write: async (v) => {
      termsRaw = v;
    },
    clear: async () => {
      termsRaw = null;
    },
  };
  const workoutDisk = {
    read: async () => structuredClone(workoutRaw),
    write: async (v) => {
      if (failDisk) throw new Error("synthetic disk full");
      workoutRaw = structuredClone(v);
    },
    remove: async () => {
      workoutRaw = null;
    },
    now: () => time,
  };
  const launch = (binding = hash) => {
    const terms = createAppTermsStore(termsDisk),
      workouts = createOfflineWorkoutStore(workoutDisk);
    terms.bind(Promise.resolve(binding));
    workouts.bind(Promise.resolve(binding));
    let current = true;
    const engine = createOfflineWorkoutSync({
      store: workouts,
      mutationId: () => id(nextId++),
      status: (e) => e?.status,
      isRun: validRun,
      requestTimeoutMs: 100,
    });
    return {
      terms,
      workouts,
      engine,
      current: () => current,
      revoke: () => {
        current = false;
      },
    };
  };
  return {
    launch,
    advance: (n) => {
      time += n;
    },
    failDisk: (v) => {
      failDisk = v;
    },
    raw: () => structuredClone(workoutRaw),
    readTerms: () => termsRaw,
  };
}
async function initialize(f, run = base) {
  const app = f.launch();
  await app.terms.remember(accepted, app.current);
  await app.workouts.verifyOwner(accepted.ownerId, app.current);
  await app.workouts.remember(accepted.ownerId, run, app.current);
  return app;
}
const edit = (app, change) =>
  app.workouts.update(accepted.ownerId, base.id, app.current, (e) => ({
    ...change(e),
    version: e.version + 1,
  }));
const entry = async (app) => (await app.workouts.list(accepted.ownerId, app.current))[0];
const termsAllowOfflineAccess = async (app) =>
  permitsAppAccess({
    currentSession: app.current(),
    live: null,
    receipt: await app.terms.load(),
    failure: "connection",
  });
function server(run = base) {
  let state = structuredClone(run),
    drop = true,
    commits = 0;
  const requests = [],
    receipts = new Map();
  return {
    state: () => state,
    commits: () => commits,
    requests,
    correct: (patch) => {
      state = { ...state, ...patch, revision: state.revision + 1 };
    },
    request: async (_, init = {}) => {
      if (init.method !== "PUT") return { run: structuredClone(state) };
      const body = structuredClone(init.json);
      requests.push(body);
      if (receipts.has(body.mutationId)) {
        const receipt = receipts.get(body.mutationId);
        assert.deepEqual(body, receipt.body);
        return { run: structuredClone(receipt.run) };
      }
      if (body.expectedRevision !== state.revision)
        throw Object.assign(new Error("revision conflict"), { status: 409 });
      state = {
        ...state,
        revision: state.revision + 1,
        results: body.results,
        note: body.note,
        shareAccountability: body.shareAccountability,
        status: body.finish ? "completed" : "in_progress",
        finishedAt: body.finish ? new Date(start + 600000).toISOString() : null,
      };
      commits++;
      receipts.set(body.mutationId, { body, run: structuredClone(state) });
      if (drop) {
        drop = false;
        throw Object.assign(new Error("committed response lost"), { status: 0 });
      }
      return { run: structuredClone(state) };
    },
  };
}
test("cold restart after lost save reply preserves later sets, partial finish and exact idempotency receipt", async () => {
  const f = rig(),
    app = await initialize(f),
    remote = server();
  await edit(app, (e) => ({
    ...e,
    draft: { ...e.draft, results: [actual(4, 7)], note: "First saved set" },
  }));
  await assert.rejects(
    app.engine.sync(accepted.ownerId, base.id, { request: remote.request, isCurrent: app.current }),
    /response lost/,
  );
  await edit(app, (e) => ({
    ...e,
    draft: { results: [actual(4, 7), skipped], note: "Offline partial finish", finish: true },
  }));
  const before = f.raw();
  const restarted = f.launch();
  assert.equal(await termsAllowOfflineAccess(restarted), true);
  assert.equal(await restarted.workouts.owner(restarted.current), accepted.ownerId);
  assert.deepEqual((await entry(restarted)).draft, before.runs[0].draft);
  assert.deepEqual((await entry(restarted)).pending, before.runs[0].pending);
  // New process UUIDs must be unique; the first recovered request still reuses its receipt.
  await restarted.engine.sync(accepted.ownerId, base.id, {
    request: remote.request,
    isCurrent: restarted.current,
  });
  assert.equal(remote.commits(), 2);
  assert.equal(remote.requests.length, 3);
  assert.deepEqual(remote.requests[0], remote.requests[1]);
  assert.equal(remote.state().status, "completed");
  assert.equal(remote.state().results.length, 2);
  assert.equal(remote.state().results[0].reps, 7);
  assert.equal(remote.state().results[0].weight, null);
  assert.equal(remote.state().results[1].status, "skipped");
  assert.equal(remote.state().note, "Offline partial finish");
  assert.equal(hasPendingRun(await entry(restarted)), false);
});
test("unfinished actual fields survive terms-approved offline restart without becoming completed results", async () => {
  const f = rig(),
    app = await initialize(f);
  await edit(app, (e) => ({
    ...e,
    active: {
      exerciseId: id(3),
      setId: id(5),
      fields: {
        reps: "8",
        durationSeconds: "",
        distanceMeters: "",
        weight: "",
        unit: "kg",
        restSeconds: "0",
      },
    },
    draft: { ...e.draft, note: "Unsubmitted field" },
  }));
  const restarted = f.launch();
  assert.equal(await termsAllowOfflineAccess(restarted), true);
  const recovered = await entry(restarted);
  assert.equal(activeEditorFromEntry(recovered).fields.reps, "8");
  assert.deepEqual(recovered.draft.results, []);
});
test("terms receipt does not extend 24-hour workout access; verified reconnect restores pending actuals", async () => {
  const f = rig(),
    app = await initialize(f);
  await edit(app, (e) => ({ ...e, draft: { ...e.draft, results: [actual(4, 7)] } }));
  f.advance(OFFLINE_LEASE);
  const restarted = f.launch();
  assert.equal(await termsAllowOfflineAccess(restarted), true);
  assert.equal(await restarted.workouts.owner(restarted.current), null);
  assert.deepEqual(await restarted.workouts.list(accepted.ownerId, restarted.current), []);
  await assert.rejects(
    edit(restarted, (e) => e),
    /verify your account/,
  );
  await restarted.workouts.verifyOwner(accepted.ownerId, restarted.current);
  assert.equal((await entry(restarted)).draft.results[0].reps, 7);
});
test("exact-session account replacement cannot read either receipt or offline actuals", async () => {
  const f = rig(),
    app = await initialize(f);
  await edit(app, (e) => ({
    ...e,
    draft: { ...e.draft, results: [actual(4, 7)], note: "Owner A private note" },
  }));
  const replaced = f.launch(otherHash);
  assert.equal(await termsAllowOfflineAccess(replaced), false);
  assert.equal(await replaced.workouts.owner(replaced.current), null);
  assert.deepEqual(await replaced.workouts.list(accepted.ownerId, replaced.current), []);
  app.revoke();
  await Promise.all([app.terms.clear(), app.workouts.clear()]);
  assert.equal(f.raw(), null);
  assert.equal(f.readTerms(), null);
});
test("fresh terms refusal fences cached access without deleting unsynced workouts", async () => {
  const f = rig(),
    app = await initialize(f);
  await edit(app, (e) => ({ ...e, draft: { ...e.draft, results: [actual(4, 7)] } }));
  const before = f.raw(),
    receipt = await app.terms.load();
  assert.equal(
    permitsAppAccess({ currentSession: true, live: fresh, receipt, failure: "none" }),
    false,
  );
  await app.terms.forget();
  assert.equal(await termsAllowOfflineAccess(f.launch()), false);
  assert.deepEqual(f.raw(), before);
  await app.terms.remember(accepted, app.current);
  assert.equal(await termsAllowOfflineAccess(f.launch()), true);
  assert.equal((await entry(f.launch())).draft.results[0].reps, 7);
});
test("failed local save followed by process restart returns last durable state and not attempted actuals", async () => {
  const f = rig(),
    app = await initialize(f);
  await edit(app, (e) => ({ ...e, draft: { ...e.draft, results: [actual(4, 7)] } }));
  f.failDisk(true);
  await assert.rejects(
    edit(app, (e) => ({ ...e, draft: { ...e.draft, results: [actual(4, 7), actual(5, 8)] } })),
    /disk full/,
  );
  const restarted = f.launch();
  assert.equal(await termsAllowOfflineAccess(restarted), true);
  assert.deepEqual((await entry(restarted)).draft.results, [actual(4, 7)]);
});
test("restart and lost-response replay cannot overwrite second-device corrections or restore revoked sharing", async () => {
  const shared = { ...base, sessionId: "synthetic-session", shareAccountability: true };
  const f = rig(),
    app = await initialize(f, shared),
    remote = server(shared);
  await edit(app, (e) => ({
    ...e,
    draft: { ...e.draft, results: [actual(4, 7)], note: "First local save" },
  }));
  await assert.rejects(
    app.engine.sync(accepted.ownerId, base.id, { request: remote.request, isCurrent: app.current }),
    /response lost/,
  );
  await edit(app, (e) => ({
    ...e,
    draft: { ...e.draft, results: [actual(4, 7), actual(5, 8)], note: "Later offline save" },
  }));
  remote.correct({
    note: "Correction on second device",
    results: [actual(4, 6)],
    shareAccountability: false,
  });
  const restarted = f.launch(),
    transport = { request: remote.request, isCurrent: restarted.current };
  assert.equal(await termsAllowOfflineAccess(restarted), true);
  await assert.rejects(
    restarted.engine.sync(accepted.ownerId, base.id, transport),
    /revision conflict/,
  );
  const conflict = await entry(restarted);
  assert.equal(conflict.conflict.revision, 3);
  assert.equal(conflict.draft.note, "Later offline save");
  assert.equal(conflict.conflict.note, "Correction on second device");
  const sent = remote.requests.length;
  await restarted.engine.sync(accepted.ownerId, base.id, transport);
  assert.equal(remote.requests.length, sent);
  await restarted.workouts.update(accepted.ownerId, base.id, restarted.current, (e) =>
    resolveRunConflict(e, "private", start),
  );
  await restarted.engine.sync(accepted.ownerId, base.id, transport);
  assert.equal(remote.state().shareAccountability, false);
  assert.equal(remote.state().note, "Later offline save");
  assert.equal(remote.state().results.length, 2);
  assert.equal(remote.state().revision, 4);
  assert.equal(hasPendingRun(await entry(restarted)), false);
});
