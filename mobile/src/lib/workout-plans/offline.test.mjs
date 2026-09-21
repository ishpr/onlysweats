import assert from "node:assert/strict";
import { test } from "node:test";
import { createOfflineWorkoutStore } from "./offline-store.ts";
import {
  acknowledgeUpload,
  activeEditorFromEntry,
  hasPendingRun,
  newOfflineRun,
  reconcileEditorField,
  OFFLINE_LEASE,
  OFFLINE_TTL,
  prepareUpload,
  readOfflineDocument,
  resolveRunConflict,
  sameDraft,
  unsyncedSetCount,
} from "./offline-data.ts";

const now = 2_000_000_000_000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const run = (id = 1) => ({
  id: uuid(id),
  revision: 1,
  planId: uuid(20),
  planRevision: 1,
  sessionId: null,
  startedAt: new Date(now - 60000).toISOString(),
  updatedAt: new Date(now).toISOString(),
  finishedAt: null,
  status: "in_progress",
  note: "",
  shareAccountability: false,
  results: [],
  snapshot: {
    title: "Actual-only test",
    activity: "strength",
    instructions: "",
    exercises: [
      {
        id: uuid(30),
        name: "Squat",
        instructions: "",
        sets: [31, 32].map((id) => ({
          id: uuid(id),
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
});
const actual = (set = 31, reps = 7) => ({
  exerciseId: uuid(30),
  setId: uuid(set),
  status: "completed",
  reps,
  durationSeconds: null,
  distanceMeters: null,
  weight: null,
  unit: "kg",
});
const doc = (entry = newOfflineRun(run(), now)) => ({
  schema: 1,
  binding: "token-hash",
  ownerId: "owner",
  verifiedAt: now,
  runs: [entry],
});
function memory() {
  let raw = null,
    time = now;
  const storage = {
    read: async () => structuredClone(raw),
    write: async (value) => {
      raw = structuredClone(value);
    },
    remove: async () => {
      raw = null;
    },
    now: () => time,
  };
  const store = createOfflineWorkoutStore(storage);
  store.bind(Promise.resolve("token-hash"));
  return {
    store,
    storage,
    raw: () => structuredClone(raw),
    tick: (value) => {
      time += value;
    },
  };
}
async function opened(f, id = 1) {
  await f.store.verifyOwner("owner", () => true);
  await f.store.remember("owner", run(id), () => true);
}

test("opening a prescribed run never records its targets; actuals and full snapshot survive restart", async () => {
  const f = memory();
  await opened(f);
  assert.deepEqual(f.raw().runs[0].draft.results, []);
  await f.store.update(
    "owner",
    uuid(1),
    () => true,
    (e) => ({ ...e, version: 1, draft: { ...e.draft, results: [actual()] } }),
  );
  const restarted = createOfflineWorkoutStore(f.storage);
  restarted.bind(Promise.resolve("token-hash"));
  assert.equal(await restarted.owner(() => true), "owner");
  const [entry] = await restarted.list("owner", () => true);
  assert.equal(entry.draft.results[0].reps, 7);
  assert.equal(entry.base.snapshot.exercises[0].sets[0].reps, 10);
  assert.equal(hasPendingRun(entry), true);
});
test("lost response keeps exact payload/ID while new sets coalesce; ack retains later edits", () => {
  const base = run();
  base.shareAccountability = true;
  base.sessionId = "session";
  let entry = newOfflineRun(base, now);
  entry = { ...entry, version: 1, draft: { ...entry.draft, results: [actual()] } };
  entry = prepareUpload(entry, uuid(90));
  const request = structuredClone(entry.pending);
  entry = {
    ...entry,
    version: 2,
    draft: { ...entry.draft, results: [actual(), actual(32, 8)], finish: true },
  };
  assert.deepEqual(prepareUpload(entry, uuid(91)).pending, request);
  assert.equal(request.payload.shareAccountability, true);
  const saved = { ...base, revision: 2, results: request.payload.results };
  entry = acknowledgeUpload(entry, uuid(90), saved);
  assert.equal(entry.base.revision, 2);
  assert.equal(entry.draft.results.length, 2);
  assert.equal(entry.draft.finish, true);
  assert.equal(hasPendingRun(entry), true);
  assert.equal(prepareUpload(entry, uuid(91)).pending.payload.expectedRevision, 2);
});
test("semantic comparison ignores JSON property/set ordering and counts clears", () => {
  const a = actual(),
    b = actual(32, 8);
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(
    sameDraft(
      { results: [a, b], note: "", finish: false },
      { results: [b, reordered], note: "", finish: false },
    ),
    true,
  );
  const entry = newOfflineRun({ ...run(), results: [a, b] }, now);
  entry.draft = { ...entry.draft, results: [reordered] };
  assert.equal(unsyncedSetCount(entry), 1);
});
test("conflict reapply requires reviewed server version and cannot restore a revoked share grant", () => {
  const base = { ...run(), shareAccountability: true, sessionId: "session" };
  let entry = {
    ...newOfflineRun(base, now),
    version: 1,
    draft: { results: [actual()], note: "Mine", finish: false },
  };
  assert.throws(() => resolveRunConflict(entry, "local", now));
  entry.conflict = {
    ...base,
    revision: 3,
    shareAccountability: false,
    results: [actual(32)],
    note: "Theirs",
  };
  const local = resolveRunConflict(entry, "local", now);
  assert.equal(prepareUpload(local, uuid(90)).pending.payload.shareAccountability, false);
  assert.equal(local.base.revision, 3);
  assert.equal(local.draft.note, "Mine");
  const discard = resolveRunConflict(entry, "server", now);
  assert.equal(discard.draft.note, "Theirs");
  assert.equal(hasPendingRun(discard), false);
});
test("strict durable parser rejects malformed base, results, pending requests, enum coercion and timestamp corruption", () => {
  const valid = doc();
  assert.ok(readOfflineDocument(valid, "token-hash", now));
  const mutations = [
    (x) => {
      x.runs[0].base.snapshot.activity = ["strength"];
    },
    (x) => {
      x.runs[0].base.snapshot.exercises[0].sets[0].unit = ["kg"];
    },
    (x) => {
      x.runs[0].base.startedAt = "bad";
    },
    (x) => {
      x.runs[0].base.results = [{ ...actual(), setId: uuid(999) }];
    },
    (x) => {
      x.runs[0].draft.results = [{ ...actual(), reps: null }];
    },
    (x) => {
      x.runs[0].draft.results = [{ ...actual(), status: "skipped" }];
    },
    (x) => {
      x.runs[0].active = { exerciseId: uuid(30), setId: uuid(31), fields: null };
    },
    (x) => {
      x.runs[0].updatedAt = Infinity;
    },
    (x) => {
      x.runs[0].pending = {
        mutationId: uuid(90),
        version: 0,
        payload: {
          expectedRevision: 1,
          results: "bad",
          note: "",
          finish: false,
          shareAccountability: false,
        },
      };
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(valid);
    mutate(changed);
    assert.equal(readOfflineDocument(changed, "token-hash", now), null);
  }
  assert.equal(readOfflineDocument(valid, "another-token", now), null);
});
test("rapid serialized field edits retain the latest text without dropping intermediate queue work", async () => {
  const f = memory();
  await opened(f);
  await Promise.all(
    ["a", "ab", "abc"].map((note) =>
      f.store.update(
        "owner",
        uuid(1),
        () => true,
        (e) => ({ ...e, version: e.version + 1, draft: { ...e.draft, note } }),
      ),
    ),
  );
  assert.equal(f.raw().runs[0].draft.note, "abc");
  assert.equal(f.raw().runs[0].version, 3);
});
test("reads/local edits do not extend the verified-owner lease; token mismatch and owner mismatch stay inaccessible", async () => {
  const f = memory();
  await opened(f);
  f.tick(OFFLINE_LEASE - 1);
  await f.store.update(
    "owner",
    uuid(1),
    () => true,
    (e) => ({ ...e, draft: { ...e.draft, note: "last edit" } }),
  );
  f.tick(1);
  assert.equal(await f.store.owner(() => true), null);
  assert.deepEqual(await f.store.list("owner", () => true), []);
  await assert.rejects(
    f.store.update(
      "owner",
      uuid(1),
      () => true,
      (e) => e,
    ),
    /verify your account/,
  );
  await f.store.verifyOwner("owner", () => true);
  assert.equal((await f.store.list("owner", () => true)).length, 1);
  assert.deepEqual(await f.store.list("other", () => true), []);
  f.store.bind(Promise.resolve("new-token"));
  assert.equal(await f.store.owner(() => true), null);
});
test("expiry removes old ciphertext data on next access and never returns stale runs", async () => {
  const f = memory();
  await opened(f);
  f.tick(OFFLINE_TTL + 1);
  assert.deepEqual(await f.store.list("owner", () => true), []);
  assert.equal(f.raw().runs.length, 0);
});
test("capacity never evicts unsynced actuals or incomplete fields", async () => {
  const f = memory();
  await f.store.verifyOwner("owner", () => true);
  for (let id = 1; id <= 10; id++) {
    await f.store.remember("owner", run(id), () => true);
    await f.store.update(
      "owner",
      uuid(id),
      () => true,
      (e) => ({ ...e, draft: { ...e.draft, results: [actual()] } }),
    );
  }
  await assert.rejects(
    f.store.remember("owner", run(11), () => true),
    /Ten workouts/,
  );
  assert.equal(f.raw().runs.length, 10);
});
test("account clear fences a delayed write before new-account verification; no old data resurrects", async () => {
  const f = memory();
  await opened(f);
  const write = f.storage.write;
  let release, entered;
  const started = new Promise((r) => {
    entered = r;
  });
  f.storage.write = async (value) => {
    entered();
    await new Promise((r) => {
      release = r;
    });
    await write(value);
  };
  const saving = f.store.update(
    "owner",
    uuid(1),
    () => true,
    (e) => ({ ...e, draft: { ...e.draft, note: "private old account" } }),
  );
  await started;
  const clearing = f.store.clear();
  f.store.bind(Promise.resolve("new-token"));
  release();
  await assert.rejects(saving, /account changed/);
  await clearing;
  f.storage.write = write;
  await f.store.verifyOwner("new-owner", () => true);
  assert.equal(f.raw().ownerId, "new-owner");
  assert.deepEqual(f.raw().runs, []);
});
test("purge after access denial preserves the binding so a later verified online retry can recover", async () => {
  const f = memory();
  await opened(f);
  await f.store.purge();
  await f.store.verifyOwner("owner", () => true);
  assert.equal(await f.store.owner(() => true), "owner");
  assert.deepEqual(f.raw().runs, []);
});
test("a failed disk write never reports success or changes acknowledged saved data", async () => {
  const f = memory();
  await opened(f);
  const before = f.raw();
  f.storage.write = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    f.store.update(
      "owner",
      uuid(1),
      () => true,
      (e) => ({ ...e, draft: { ...e.draft, results: [actual()] } }),
    ),
    /disk full/,
  );
  assert.deepEqual(f.raw(), before);
});

test("clean server refresh updates displayed notes, while newer unsaved keystrokes survive", () => {
  assert.equal(reconcileEditorField("old", "old", "new server note"), "new server note");
  assert.equal(reconcileEditorField("typing now", "old", "new server note"), "typing now");
  assert.equal(
    reconcileEditorField("typing now", "typing now", "later server note"),
    "later server note",
  );
});

test("a late read cannot recreate an explicitly removed device copy", async () => {
  const f = memory();
  await opened(f);
  const generation = f.store.generation("owner", uuid(1));
  await f.store.remove("owner", uuid(1), () => true);
  await assert.rejects(
    f.store.remember("owner", run(), () => true, generation),
    /device copy was removed/,
  );
  assert.deepEqual(f.raw().runs, []);
  await f.store.remember("owner", run(), () => true);
  assert.equal(f.raw().runs.length, 1, "an explicit new online open can cache it again");
});

test("invalid new local edits cannot corrupt other durable workout records", async () => {
  const f = memory();
  await opened(f);
  const before = f.raw();
  await assert.rejects(
    f.store.update(
      "owner",
      uuid(1),
      () => true,
      (entry) => ({ ...entry, draft: { ...entry.draft, results: [{ ...actual(), reps: -1 }] } }),
    ),
    /safely stored/,
  );
  assert.deepEqual(f.raw(), before);
});

test("explicit private conflict resolution syncs revocation even when actual entries already match", () => {
  const base = { ...run(), sessionId: "session", shareAccountability: true, results: [actual()] };
  const entry = { ...newOfflineRun(base, now), conflict: { ...base, revision: 2 } };
  const next = resolveRunConflict(entry, "private", now);
  assert.equal(hasPendingRun(next), true);
  assert.equal(prepareUpload(next, uuid(90)).pending.payload.shareAccountability, false);
});

test("reviewed local/private conflicts reopen retained incomplete actual fields; only server discard clears them", () => {
  const entry = newOfflineRun(run(), now);
  entry.active = {
    exerciseId: uuid(30),
    setId: uuid(31),
    fields: {
      reps: "7",
      durationSeconds: "",
      distanceMeters: "",
      weight: "",
      unit: "kg",
      restSeconds: "0",
    },
  };
  entry.conflict = { ...run(), revision: 2, note: "Other device" };
  for (const choice of ["local", "private"]) {
    const next = resolveRunConflict(entry, choice, now);
    const editor = activeEditorFromEntry(next);
    assert.equal(editor.set.id, uuid(31));
    assert.equal(editor.fields.reps, "7");
    assert.deepEqual(next.draft.results, [], "incomplete fields must not become a completed set");
  }
  const discarded = resolveRunConflict(entry, "server", now);
  assert.equal(activeEditorFromEntry(discarded), null);
});
