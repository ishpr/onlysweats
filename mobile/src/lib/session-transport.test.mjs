import assert from "node:assert/strict";
import test from "node:test";
import { createSessionTransport } from "./session-transport.ts";

test("an in-flight health request uses its captured token and discards results after account changes", async () => {
  let version = 1;
  let finish;
  const calls = [];
  const session = createSessionTransport({
    token: "first-member", version: 1, currentVersion: () => version,
    stale: () => new Error("stale"),
    send: (token, path) => {
      calls.push({ token, path });
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  const pending = session.request("/health/sync");
  version = 2;
  finish({ privateRecord: "first-member" });
  await assert.rejects(pending, /stale/);
  await assert.rejects(session.request("/health/sync"), /stale/);
  assert.deepEqual(calls, [{ token: "first-member", path: "/health/sync" }]);
  assert.equal(session.isCurrent(), false);
});

test("a canceled request never starts and cancellation hides an already-running result", async () => {
  const controller = new AbortController();
  let finish;
  let calls = 0;
  const session = createSessionTransport({
    token: "member", version: 1, currentVersion: () => 1,
    stale: () => new Error("stale"),
    send: () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); },
  });
  const pending = session.request("/health/sync", { signal: controller.signal });
  controller.abort();
  finish({ ok: true });
  await assert.rejects(pending, /stale/);
  await assert.rejects(session.request("/health/sync", { signal: controller.signal }), /stale/);
  assert.equal(calls, 1);
});

test("current-session failures remain actionable and successful requests retain their response", async () => {
  const failure = new Error("offline");
  const session = createSessionTransport({
    token: "member", version: 3, currentVersion: () => 3,
    stale: () => new Error("stale"),
    send: async (_, path) => { if (path === "/fail") throw failure; return { ok: true }; },
  });
  await assert.rejects(session.request("/fail"), (error) => error === failure);
  assert.deepEqual(await session.request("/ok"), { ok: true });
});
