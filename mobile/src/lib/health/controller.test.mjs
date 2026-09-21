import assert from "node:assert/strict";
import test from "node:test";
import { createHealthSyncController } from "./controller.ts";

const clone = (value) => structuredClone(value);
const initialConnection = (types = ["workout"]) => ({
  deviceId: "device-1", generation: "generation-1", types,
  sinceAt: "2026-08-01T00:00:00.000Z", connectedAt: "2026-09-01T00:00:00.000Z",
  lastSyncedAt: null, cursors: {},
});
const page = (anchor, hasMore = false) => ({ records: [], deletedIds: [], anchor, hasMore });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function apiError(status) { return Object.assign(new Error("request failed"), { status }); }
function fixture(options = {}) {
  let connection = options.connection === undefined ? initialConnection() : options.connection;
  let isCurrent = true;
  let promptCount = 0;
  const calls = [];
  const reads = [];
  const server = {
    get connection() { return connection; },
    set connection(value) { connection = value; },
    async request(path, init = {}) {
      calls.push({ path, method: init.method ?? "GET", json: clone(init.json) });
      if (options.request) {
        const result = await options.request(path, init, server);
        if (result !== undefined) return result;
      }
      if (path === "/health/connection" && !init.method) return { connection: clone(connection) };
      if (path === "/health/connection" && init.method === "POST") {
        connection = { ...initialConnection(init.json.types), deviceId: init.json.deviceId };
        return { connection: clone(connection) };
      }
      if (path === "/health/connection" && init.method === "DELETE") {
        connection = null;
        return { ok: true };
      }
      if (path === "/health/sync") {
        if (!connection || connection.generation !== init.json.generation ||
          (connection.cursors[init.json.type]?.sequence ?? 0) !== init.json.expectedSequence) throw apiError(409);
        connection.cursors[init.json.type] = {
          sequence: init.json.expectedSequence + 1, anchor: init.json.anchor,
        };
        connection.lastSyncedAt = "2026-09-02T00:00:00.000Z";
        if (options.afterCommit) await options.afterCommit(init.json);
        return { connection: clone(connection) };
      }
      throw new Error(`Unexpected ${path}`);
    },
  };
  const controller = createHealthSyncController({
    ownerId: "member-1",
    transport: { request: server.request, isCurrent: () => isCurrent },
    native: {
      isAvailable: async () => options.available ?? true,
      requestAuthorization: async (types) => {
        promptCount += 1;
        if (options.prompt) await options.prompt(types);
      },
      readChanges: async (input) => {
        reads.push(clone(input));
        return options.read ? options.read(input) : page("anchor-1");
      },
    },
    getDeviceId: async () => options.deviceId ?? "device-1",
    maxPages: options.maxPages,
    maxConflicts: options.maxConflicts,
  });
  return {
    controller, server, calls, reads,
    get promptCount() { return promptCount; },
    switchAccount() { isCurrent = false; },
  };
}

test("construction and refresh never prompt, reconnect or import", async () => {
  const f = fixture({ connection: null });
  assert.equal(f.calls.length, 0);
  await f.controller.refresh();
  assert.equal(f.promptCount, 0);
  assert.equal(f.reads.length, 0);
  assert.deepEqual(f.calls.map((call) => call.method), ["GET"]);
  assert.equal(f.controller.getSnapshot().connection, null);
});

test("permission prompt completion remains opaque, including an empty read", async () => {
  const f = fixture({ connection: null });
  await f.controller.connect(["workout", "heart_rate"]);
  const state = f.controller.getSnapshot();
  assert.equal(state.promptCompleted, true);
  assert.equal("authorized" in state, false);
  assert.equal("granted" in state, false);
  assert.equal(f.promptCount, 1);
  assert.equal(f.reads.length, 0, "connect is distinct from importing records");
  await f.controller.sync();
  assert.equal(f.controller.getSnapshot().phase, "idle");
  assert.equal(f.promptCount, 1);
});

test("unavailable native build does not request permission or create a connection", async () => {
  const f = fixture({ connection: null, available: false });
  await f.controller.connect(["workout"]);
  assert.equal(f.controller.getSnapshot().availability, "unavailable");
  assert.equal(f.controller.getSnapshot().phase, "error");
  assert.equal(f.promptCount, 0);
  assert.equal(f.calls.length, 0);
});

test("rollout disabled is checked before a permission prompt", async () => {
  const f = fixture({ request: () => { throw apiError(404); } });
  await f.controller.connect(["workout"]);
  assert.equal(f.promptCount, 0);
  assert.match(f.controller.getSnapshot().error, /isn’t available/);
});

test("failed upload never advances anchor; the next sync reads the same server cursor", async () => {
  let fail = true;
  const f = fixture({ request: (path) => {
    if (path === "/health/sync" && fail) { fail = false; throw apiError(0); }
  } });
  await f.controller.sync();
  assert.equal(f.controller.getSnapshot().phase, "error");
  assert.deepEqual(f.server.connection.cursors, {});
  assert.deepEqual(f.controller.getSnapshot().connection.cursors, {});
  await f.controller.sync();
  assert.deepEqual(f.reads.map((read) => read.anchor), [null, null]);
  assert.equal(f.server.connection.cursors.workout.sequence, 1);
});

test("lost response after commit resumes from durable server anchor without replaying the old page", async () => {
  let lose = true;
  const f = fixture({
    read: async (input) => page(input.anchor === null ? "anchor-1" : "anchor-2"),
    afterCommit: () => { if (lose) { lose = false; throw apiError(0); } },
  });
  await f.controller.sync();
  assert.equal(f.controller.getSnapshot().phase, "error");
  assert.deepEqual(f.controller.getSnapshot().connection.cursors, {});
  assert.equal(f.server.connection.cursors.workout.anchor, "anchor-1");
  await f.controller.sync();
  assert.deepEqual(f.reads.map((read) => read.anchor), [null, "anchor-1"]);
  assert.equal(f.server.connection.cursors.workout.sequence, 2);
});

test("bounded multipage import exposes continuation and resumes from acknowledged anchors", async () => {
  const f = fixture({ maxPages: 2, read: async (input) => {
    const next = Number(input.anchor ?? "0") + 1;
    return page(String(next), next < 3);
  } });
  await f.controller.sync();
  assert.equal(f.reads.length, 2);
  assert.equal(f.controller.getSnapshot().hasMore, true);
  await f.controller.sync();
  assert.deepEqual(f.reads.map((read) => read.anchor), [null, "1", "2"]);
  assert.equal(f.controller.getSnapshot().hasMore, false);
});

test("data types make round-robin progress and preserve per-type cursors", async () => {
  const f = fixture({ connection: initialConnection(["workout", "heart_rate"]), maxPages: 3,
    read: async (input) => page(`${input.type}-${input.anchor ? "2" : "1"}`, true),
  });
  await f.controller.sync();
  assert.deepEqual(f.reads.map((read) => read.type), ["workout", "heart_rate", "workout"]);
  assert.equal(f.server.connection.cursors.workout.sequence, 2);
  assert.equal(f.server.connection.cursors.heart_rate.sequence, 1);
  assert.equal(f.controller.getSnapshot().hasMore, true);
});

test("CAS conflict refetches and retries from the competing writer's acknowledged cursor", async () => {
  let conflict = true;
  const f = fixture({ request: (path, init, server) => {
    if (path === "/health/sync" && conflict) {
      conflict = false;
      server.connection.cursors.workout = { sequence: 1, anchor: "other-anchor" };
      throw apiError(409);
    }
  } });
  await f.controller.sync();
  assert.deepEqual(f.reads.map((read) => read.anchor), [null, "other-anchor"]);
  assert.equal(f.server.connection.cursors.workout.sequence, 2);
  assert.equal(f.controller.getSnapshot().phase, "idle");
});

test("persistent CAS conflict is bounded", async () => {
  const f = fixture({ maxConflicts: 2, request: (path) => {
    if (path === "/health/sync") throw apiError(409);
  } });
  await f.controller.sync();
  assert.equal(f.reads.length, 3);
  assert.equal(f.controller.getSnapshot().phase, "error");
});

test("generation changed remotely stops retry without following new consent", async () => {
  const f = fixture({ request: (path, init, server) => {
    if (path === "/health/sync") {
      server.connection.generation = "new-generation";
      throw apiError(409);
    }
  } });
  await f.controller.sync();
  assert.equal(f.reads.length, 1);
  assert.equal(f.controller.getSnapshot().phase, "error");
});

test("concurrent sync and refresh calls share one running import", async () => {
  const gate = deferred();
  const f = fixture({ read: () => gate.promise });
  const first = f.controller.sync();
  assert.equal(first, f.controller.sync());
  assert.equal(first, f.controller.refresh());
  gate.resolve(page("anchor-1"));
  await first;
  assert.equal(f.reads.length, 1);
  assert.equal(f.calls.filter((call) => call.path === "/health/sync").length, 1);
});

test("account switch during native read cannot upload old health records", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({ read: () => { entered.resolve(); return gate.promise; } });
  const running = f.controller.sync();
  await entered.promise;
  f.switchAccount();
  gate.resolve(page("anchor-1"));
  await running;
  assert.equal(f.calls.filter((call) => call.path === "/health/sync").length, 0);
});

test("account switch during permission prompt cannot create a connection", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({ connection: null, prompt: () => { entered.resolve(); return gate.promise; } });
  const running = f.controller.connect(["workout"]);
  await entered.promise;
  f.switchAccount();
  gate.resolve();
  await running;
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 0);
});

test("disconnect while native read is pending prevents upload and purges the connection", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({ read: () => { entered.resolve(); return gate.promise; } });
  const running = f.controller.sync();
  await entered.promise;
  const disconnecting = f.controller.disconnect();
  assert.equal(f.controller.getSnapshot().phase, "disconnecting");
  gate.resolve(page("anchor-1"));
  await Promise.all([running, disconnecting]);
  assert.equal(f.calls.filter((call) => call.path === "/health/sync").length, 0);
  assert.equal(f.server.connection, null);
  assert.equal(f.controller.getSnapshot().connection, null);
});

test("disconnect waits for pending connection creation, then purges it", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({ connection: null, request: async (path, init) => {
    if (path === "/health/connection" && init.method === "POST") {
      entered.resolve();
      await gate.promise;
    }
  } });
  const connecting = f.controller.connect(["workout"]);
  await entered.promise;
  const disconnecting = f.controller.disconnect();
  assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 0);
  gate.resolve();
  await Promise.all([connecting, disconnecting]);
  assert.deepEqual(f.calls.map((call) => call.method), ["GET", "POST", "DELETE"]);
  assert.equal(f.server.connection, null);
  assert.equal(f.controller.getSnapshot().connection, null);
});

test("reconnect requested during disconnect waits until purge completes", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({ request: async (path, init) => {
    if (init.method === "DELETE") { entered.resolve(); await gate.promise; }
  } });
  const disconnecting = f.controller.disconnect();
  await entered.promise;
  const connecting = f.controller.connect(["workout", "heart_rate"]);
  gate.resolve();
  await Promise.all([disconnecting, connecting]);
  assert.deepEqual(f.calls.map((call) => call.method), ["DELETE", "GET", "POST"]);
  assert.deepEqual(f.server.connection.types, ["workout", "heart_rate"]);
});

test("connection on another device never silently takes over", async () => {
  const f = fixture({ deviceId: "device-2" });
  await f.controller.sync();
  assert.equal(f.controller.getSnapshot().phase, "error");
  assert.equal(f.reads.length, 0);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 0);
});

test("effect cancellation clears snapshots and permits a fresh Strict Mode mount", async () => {
  const f = fixture();
  await f.controller.refresh();
  assert.notEqual(f.controller.getSnapshot().connection, null);
  f.controller.cancel();
  assert.equal(f.controller.getSnapshot().connection, null);
  await f.controller.refresh();
  assert.notEqual(f.controller.getSnapshot().connection, null);
  assert.equal(f.promptCount, 0);
});


test("workouts must be selected before a permission prompt or cloud opt-in", async () => {
  const f = fixture({ connection: null });
  await f.controller.connect(["heart_rate"]);
  assert.equal(f.controller.getSnapshot().phase, "error");
  assert.equal(f.calls.length, 0);
  assert.equal(f.promptCount, 0);
});
