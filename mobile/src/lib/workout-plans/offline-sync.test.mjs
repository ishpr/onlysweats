import assert from "node:assert/strict";
import { test } from "node:test";
import { createOfflineWorkoutSync, OfflineWorkoutRequestError } from "./offline-sync.ts";
import { createOfflineWorkoutStore } from "./offline-store.ts";
import { hasPendingRun, resolveRunConflict, validRun } from "./offline-data.ts";

const now = 2_000_000_000_000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
const fixture = () => ({
  id: uuid(1),
  revision: 1,
  planId: uuid(20),
  planRevision: 1,
  sessionId: null,
  startedAt: new Date(now - 60_000).toISOString(),
  updatedAt: new Date(now).toISOString(),
  finishedAt: null,
  status: "in_progress",
  note: "",
  shareAccountability: false,
  results: [],
  snapshot: {
    title: "Synthetic workout",
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
const failure = (status) => Object.assign(new Error(`Synthetic transport ${status}`), { status });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function session(request) {
  let current = true;
  return {
    request,
    isCurrent: () => current,
    revoke: () => {
      current = false;
    },
  };
}
function saved(base, payload) {
  return {
    ...base,
    revision: payload.expectedRevision + 1,
    results: payload.results,
    note: payload.note,
    status: payload.finish ? "completed" : "in_progress",
    finishedAt: payload.finish ? new Date(now).toISOString() : null,
    shareAccountability: payload.shareAccountability,
  };
}
async function setup(base = fixture(), timeout = 200) {
  let raw = null,
    nextId = 80;
  const storage = {
    read: async () => structuredClone(raw),
    write: async (value) => {
      raw = structuredClone(value);
    },
    remove: async () => {
      raw = null;
    },
    now: () => now,
  };
  const store = createOfflineWorkoutStore(storage);
  store.bind(Promise.resolve("token-one"));
  await store.verifyOwner("owner", () => true);
  await store.remember("owner", base, () => true);
  const engine = createOfflineWorkoutSync({
    store,
    mutationId: () => uuid(nextId++),
    status: (error) => error?.status,
    isRun: validRun,
    requestTimeoutMs: timeout,
  });
  const edit = (patch) =>
    store.update(
      "owner",
      base.id,
      () => true,
      (entry) => ({
        ...entry,
        version: entry.version + 1,
        draft: { ...entry.draft, ...patch },
      }),
    );
  return {
    store,
    engine,
    edit,
    storage,
    raw: () => structuredClone(raw),
    entry: async () => (await store.list("owner", () => true))[0],
    base,
  };
}

test("lost response retries immutable receipt before sending later edits", async () => {
  const f = await setup();
  await f.edit({ results: [actual()], note: "first" });
  const sent = [];
  let server = f.base,
    receipt = null;
  const transport = session(async (_, init) => {
    const body = structuredClone(init.json);
    sent.push(body);
    if (!receipt) {
      server = saved(server, body);
      receipt = { body, run: server };
      throw failure(0); // Server committed; its response was lost.
    }
    if (body.mutationId === receipt.body.mutationId) {
      assert.deepEqual(body, receipt.body);
      return { run: structuredClone(receipt.run) };
    }
    assert.equal(body.expectedRevision, server.revision);
    server = saved(server, body);
    return { run: server };
  });
  await assert.rejects(f.engine.sync("owner", f.base.id, transport), (error) => error.status === 0);
  await f.edit({ results: [actual(), actual(32, 8)], note: "later" });
  await f.engine.sync("owner", f.base.id, transport);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[0], sent[1]);
  assert.notEqual(sent[2].mutationId, sent[1].mutationId);
  assert.equal(sent[2].shareAccountability, false);
  assert.equal(server.results[0].weight, null); // No planned 20 kg copied into actuals.
  assert.equal(server.note, "later");
  assert.equal(hasPendingRun(await f.entry()), false);
});

test("concurrent sync callers share one upload while a newer edit survives its acknowledgement", async () => {
  const f = await setup();
  await f.edit({ results: [actual()] });
  const waiting = deferred(),
    arrived = deferred();
  const bodies = [];
  let server = f.base;
  const transport = session(async (_, init) => {
    bodies.push(structuredClone(init.json));
    if (bodies.length === 1) {
      arrived.resolve();
      await waiting.promise;
    }
    server = saved(server, init.json);
    return { run: server };
  });
  const first = f.engine.sync("owner", f.base.id, transport);
  assert.equal(f.engine.sync("owner", f.base.id, transport), first);
  await arrived.promise;
  await f.edit({ note: "typed while waiting", results: [actual(), actual(32)] });
  waiting.resolve();
  await first;
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].expectedRevision, 2);
  assert.equal((await f.entry()).draft.note, "typed while waiting");
  assert.equal(hasPendingRun(await f.entry()), false);
});

test("PUT rejection followed by GET deletion removes the device copy", async () => {
  for (const deletion of [404, 410]) {
    const f = await setup();
    await f.edit({ results: [actual()] });
    const methods = [];
    const transport = session(async (_, init) => {
      methods.push(init.method ?? "GET");
      throw failure(init.method === "PUT" ? 403 : deletion);
    });
    await assert.rejects(
      f.engine.sync("owner", f.base.id, transport),
      (error) => error.status === deletion,
    );
    assert.deepEqual(methods, ["PUT", "GET"]);
    assert.deepEqual(await f.store.list("owner", () => true), []);
  }
});

test("GET access denial retains actuals but stays unreadable until a successful live read", async () => {
  const f = await setup();
  await f.edit({ results: [actual()] });
  await assert.rejects(
    f.engine.refresh(
      "owner",
      f.base.id,
      session(async () => {
        throw failure(403);
      }),
    ),
  );
  assert.equal((await f.entry()).readBlocked, true);
  assert.equal((await f.entry()).draft.results[0].reps, 7);
  await assert.rejects(
    f.engine.refresh(
      "owner",
      f.base.id,
      session(async () => {
        throw failure(0);
      }),
    ),
  );
  assert.equal((await f.entry()).readBlocked, true);
  await f.engine.sync(
    "owner",
    f.base.id,
    session(async () => assert.fail("Must not upload while read denied")),
  );
  await f.engine.refresh(
    "owner",
    f.base.id,
    session(async () => ({ run: f.base })),
  );
  assert.equal((await f.entry()).readBlocked, false);
  assert.equal((await f.entry()).draft.results[0].reps, 7);
});

test("409 requires review and cannot restore another device's revoked sharing grant", async () => {
  const base = { ...fixture(), shareAccountability: true, sessionId: "session" };
  const f = await setup(base);
  await f.edit({ results: [actual()], note: "local" });
  let latest = { ...base, revision: 2, shareAccountability: false, note: "server" };
  const sent = [];
  const transport = session(async (_, init) => {
    if (init.method !== "PUT") return { run: latest };
    sent.push(structuredClone(init.json));
    if (sent.length === 1) throw failure(409);
    latest = saved(latest, init.json);
    return { run: latest };
  });
  await assert.rejects(f.engine.sync("owner", base.id, transport), (error) => error.status === 409);
  assert.equal((await f.entry()).conflict.revision, 2);
  assert.equal((await f.entry()).draft.note, "local");
  await f.engine.sync("owner", base.id, transport);
  assert.equal(sent.length, 1);
  await f.store.update(
    "owner",
    base.id,
    () => true,
    (entry) => resolveRunConflict(entry, "local", now),
  );
  await f.engine.sync("owner", base.id, transport);
  assert.equal(sent[1].shareAccountability, false);
  assert.equal(sent[1].expectedRevision, 2);
});

test("PUT timeout releases busy state even if transport ignores abort, preserving exact retry", async () => {
  const f = await setup(fixture(), 10);
  await f.edit({ results: [actual()] });
  const requests = [];
  const transport = session(async (_, init) => {
    requests.push(init);
    if (requests.length === 1) return new Promise(() => {});
    return { run: saved(f.base, init.json) };
  });
  await assert.rejects(
    f.engine.sync("owner", f.base.id, transport),
    (error) => error instanceof OfflineWorkoutRequestError && error.code === "timeout",
  );
  assert.equal(requests[0].signal.aborted, true);
  assert.ok((await f.entry()).pending);
  await f.engine.sync("owner", f.base.id, transport);
  assert.deepEqual(requests[1].json, requests[0].json);
  assert.equal(hasPendingRun(await f.entry()), false);
});

test("nested conflict GET is bounded and automatic retries stop until review", async () => {
  const f = await setup(fixture(), 10);
  await f.edit({ results: [actual()] });
  const methods = [],
    signals = [];
  const transport = session(async (_, init) => {
    methods.push(init.method ?? "GET");
    signals.push(init.signal);
    if (init.method === "PUT") throw failure(409);
    return new Promise(() => {});
  });
  await assert.rejects(
    f.engine.sync("owner", f.base.id, transport),
    (error) => error.code === "timeout",
  );
  assert.deepEqual(methods, ["PUT", "GET"]);
  assert.equal(signals[1].aborted, true);
  assert.equal((await f.entry()).blocked, true);
  await f.engine.sync("owner", f.base.id, transport);
  assert.equal(methods.length, 2);
});

test("refresh timeout and caller abort leave the stored draft untouched", async () => {
  const f = await setup(fixture(), 10);
  await f.edit({ results: [actual()] });
  const before = f.raw();
  const transport = session(async () => new Promise(() => {}));
  await assert.rejects(
    f.engine.refresh("owner", f.base.id, transport),
    (error) => error.code === "timeout",
  );
  const controller = new AbortController();
  const pending = f.engine.refresh("owner", f.base.id, transport, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "cancelled");
  assert.deepEqual(f.raw(), before);
});

test("cold-start account verification uses the same deadline and exact session", async () => {
  const f = await setup(fixture(), 10);
  let requestPath;
  await assert.rejects(
    f.engine.request(
      session(async (path) => {
        requestPath = path;
        return new Promise(() => {});
      }),
      "/me",
    ),
    (error) => error.code === "timeout",
  );
  assert.equal(requestPath, "/me");
  const identity = await f.engine.request(
    session(async () => ({ id: "owner" })),
    "/me",
  );
  assert.deepEqual(identity, { id: "owner" });
  const stale = session(async () => assert.fail("A stale session cannot issue a request"));
  stale.revoke();
  await assert.rejects(f.engine.request(stale, "/me"), (error) => error.code === "session_changed");
});

test("online-only actions preserve method/body and obey the caller's cancellation", async () => {
  const f = await setup();
  const body = { expectedRevision: 2, shareAccountability: false };
  let captured;
  const response = await f.engine.request(
    session(async (path, init) => {
      captured = { path, init };
      return { saved: true };
    }),
    "/fitness/runs/example",
    { method: "PUT", json: body },
  );
  assert.deepEqual(response, { saved: true });
  assert.equal(captured.init.method, "PUT");
  assert.deepEqual(captured.init.json, body);
  const controller = new AbortController();
  let signal;
  const pending = f.engine.request(
    session(async (_, init) => {
      signal = init.signal;
      return new Promise(() => {});
    }),
    "/fitness/runs/example",
    { method: "DELETE", signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "cancelled");
  assert.equal(signal.aborted, true);
});

test("old account response cannot overwrite new account state or hold its upload busy", async () => {
  const f = await setup();
  await f.edit({ results: [actual()] });
  const waiting = deferred(),
    arrived = deferred();
  let oldBody;
  const old = session(async (_, init) => {
    oldBody = init.json;
    arrived.resolve();
    return waiting.promise;
  });
  const oldSync = f.engine.sync("owner", f.base.id, old);
  const stopped = assert.rejects(oldSync, (error) => error.code === "session_changed");
  await arrived.promise;
  old.revoke();
  await f.store.clear();
  f.store.bind(Promise.resolve("new-token"));
  await f.store.verifyOwner("owner", () => true);
  await f.store.remember("owner", f.base, () => true);
  await f.edit({ note: "new account generation", results: [actual(32)] });
  const fresh = session(async (_, init) => ({ run: saved(f.base, init.json) }));
  await f.engine.sync("owner", f.base.id, fresh);
  waiting.resolve({ run: saved(f.base, oldBody) });
  await stopped;
  assert.equal((await f.entry()).draft.note, "new account generation");
  assert.equal(f.raw().binding, "new-token");
});

test("401 revocation stops processing after the transport clears its account", async () => {
  const f = await setup();
  await f.edit({ results: [actual()] });
  const transport = session(async () => {
    transport.revoke();
    await f.store.clear();
    throw failure(401);
  });
  await assert.rejects(
    f.engine.sync("owner", f.base.id, transport),
    (error) => error.code === "session_changed",
  );
  assert.equal(f.raw(), null);
});

test("an earlier successful GET cannot restore a later denied or deleted copy", async () => {
  for (const status of [403, 404]) {
    const f = await setup();
    const waiting = deferred(),
      arrived = deferred();
    const earlier = f.engine.refresh(
      "owner",
      f.base.id,
      session(async () => {
        arrived.resolve();
        return waiting.promise;
      }),
    );
    const rejected = assert.rejects(earlier, (error) => error.code === "superseded");
    await arrived.promise;
    await assert.rejects(
      f.engine.refresh(
        "owner",
        f.base.id,
        session(async () => {
          throw failure(status);
        }),
      ),
    );
    waiting.resolve({ run: f.base });
    await rejected;
    if (status === 403) assert.equal((await f.entry()).readBlocked, true);
    else assert.deepEqual(await f.store.list("owner", () => true), []);
  }
});

test("device-copy removal fences an already-started live refresh", async () => {
  const f = await setup();
  const waiting = deferred(),
    arrived = deferred();
  const pending = f.engine.refresh(
    "owner",
    f.base.id,
    session(async () => {
      arrived.resolve();
      return waiting.promise;
    }),
  );
  const rejected = assert.rejects(pending, /removed|changed/i);
  await arrived.promise;
  await f.store.remove("owner", f.base.id, () => true);
  waiting.resolve({ run: f.base });
  await rejected;
  assert.deepEqual(await f.store.list("owner", () => true), []);
});

test("malformed and cross-run responses never replace durable queued actuals", async () => {
  for (const bad of [
    { ...fixture(), id: uuid(2) },
    { ...fixture(), results: [{ invented: true }] },
  ]) {
    const f = await setup();
    await f.edit({ results: [actual()] });
    await assert.rejects(
      f.engine.sync(
        "owner",
        f.base.id,
        session(async () => ({ run: bad })),
      ),
      (error) => error.code === "invalid_response",
    );
    const entry = await f.entry();
    assert.equal(entry.base.revision, 1);
    assert.equal(entry.draft.results[0].reps, 7);
    assert.ok(entry.pending);
  }
});
