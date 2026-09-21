import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkoutRecoveryStore } from "./recovery-store.ts";

const pending = (runId) => ({
  version: 1,
  ownerId: "member",
  runId,
  revision: 1,
  updatedAt: Date.now(),
  note: "Private",
  shareAccountability: false,
  active: null,
});
function controlledStore() {
  let value = null;
  let release;
  let started;
  const writeGate = new Promise((resolve) => {
    release = resolve;
  });
  const hasStarted = new Promise((resolve) => {
    started = resolve;
  });
  const store = createWorkoutRecoveryStore({
    available: async () => true,
    read: async () => value,
    write: async (raw) => {
      started();
      await writeGate;
      value = raw;
    },
    remove: async () => {
      value = null;
    },
  });
  return { store, release, hasStarted, value: () => value };
}
test("clearing another run does not cancel an in-flight recovery write", async () => {
  const test = controlledStore();
  const saving = test.store.save(pending("a"), () => true);
  await test.hasStarted;
  const clearing = test.store.clear("member", "b");
  test.release();
  assert.equal(await saving, true);
  await clearing;
  assert.equal(JSON.parse(test.value()).runId, "a");
});
test("account clear immediately fences an in-flight write and removes it", async () => {
  const test = controlledStore();
  const saving = test.store.save(pending("a"), () => true);
  await test.hasStarted;
  const clearing = test.store.clear();
  test.release();
  assert.equal(await saving, false);
  await clearing;
  assert.equal(test.value(), null);
  assert.equal(await test.store.save({ ...pending("b"), ownerId: "new-member" }, () => true), true);
  assert.equal(await test.store.load("member", "b", () => true), null);
});
test("clearing the current run fences its pending write without depending on React cleanup", async () => {
  const test = controlledStore();
  const saving = test.store.save(pending("a"), () => true);
  await test.hasStarted;
  const clearing = test.store.clear("member", "a");
  test.release();
  assert.equal(await saving, false);
  await clearing;
  assert.equal(test.value(), null);
});
