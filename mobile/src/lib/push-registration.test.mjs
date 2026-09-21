import assert from "node:assert/strict";
import test from "node:test";

import { createPushRegistration } from "./push-registration.ts";

test("foreground sync registers permission granted later in Settings without prompting", async () => {
  let permission = "denied";
  let registrations = 0;
  const prompts = [];
  const push = createPushRegistration({
    permission: async (request) => {
      prompts.push(request);
      return permission;
    },
    register: async () => {
      registrations += 1;
    },
  });
  await push.sync();
  assert.equal(push.getSnapshot().status, "denied");
  assert.equal(registrations, 0);
  permission = "granted";
  await push.sync();
  assert.equal(push.getSnapshot().registration, "registered");
  assert.equal(registrations, 1);
  assert.deepEqual(prompts, [false, false]);
});

test("granted permission does not report successful registration after a failure; retry recovers", async () => {
  let attempts = 0;
  const push = createPushRegistration({
    permission: async () => "granted",
    register: async () => {
      if (++attempts === 1) throw new Error("Network unavailable");
    },
  });
  await push.sync(true);
  assert.deepEqual(push.getSnapshot(), {
    status: "granted",
    registration: "failed",
    error: "Network unavailable",
  });
  await push.sync();
  assert.deepEqual(push.getSnapshot(), {
    status: "granted",
    registration: "registered",
    error: null,
  });
  assert.equal(attempts, 2);
});

test("concurrent foreground and screen requests share one registration", async () => {
  let finish;
  let attempts = 0;
  const registered = new Promise((resolve) => {
    finish = resolve;
  });
  const push = createPushRegistration({
    permission: async () => "granted",
    register: async () => {
      attempts += 1;
      await registered;
    },
  });
  const first = push.sync();
  const second = push.sync();
  assert.equal(first, second);
  assert.equal(push.getSnapshot().registration, "registering");
  finish();
  await Promise.all([first, second]);
  assert.equal(attempts, 1);
  assert.equal(push.getSnapshot().registration, "registered");
});

test("reset prevents an old registration from publishing state for a new member", async () => {
  let finish;
  const registered = new Promise((resolve) => {
    finish = resolve;
  });
  const push = createPushRegistration({
    permission: async () => "granted",
    register: async () => registered,
  });
  const pending = push.sync();
  await Promise.resolve();
  push.reset();
  finish();
  await pending;
  assert.deepEqual(push.getSnapshot(), { status: null, registration: "idle", error: null });
});
