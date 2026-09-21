import assert from "node:assert/strict";
import { test } from "node:test";
import { createSerialWrites } from "./serial-writes.ts";

test("a queued logout clear cannot run after a later accepted-account write", async () => {
  const enqueue = createSerialWrites();
  let saved = "old",
    release,
    begin;
  const started = new Promise((resolve) => {
    begin = resolve;
  });
  const priorWrite = enqueue(async () => {
    begin();
    await new Promise((resolve) => {
      release = resolve;
    });
    saved = "old-in-flight";
  });
  await started;
  // Logout queues immediately, before its independent asynchronous recovery cleanup.
  const logoutClear = enqueue(async () => {
    saved = null;
  });
  const newAccount = enqueue(async () => {
    saved = "new-account";
  });
  release();
  await Promise.all([priorWrite, logoutClear, newAccount]);
  assert.equal(saved, "new-account");
});

test("a failed token write does not prevent subsequent logout deletion", async () => {
  const enqueue = createSerialWrites();
  let cleared = false;
  const failure = enqueue(async () => {
    throw new Error("keychain write failed");
  });
  const clear = enqueue(async () => {
    cleared = true;
  });
  await assert.rejects(failure, /keychain write failed/);
  await clear;
  assert.equal(cleared, true);
});
