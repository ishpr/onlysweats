import assert from "node:assert/strict";
import { test } from "node:test";
import { readRecovery } from "./recovery-data.ts";
const draft = () => ({
  version: 1,
  ownerId: "a",
  runId: "r",
  revision: 2,
  updatedAt: 1,
  note: "Private",
  shareAccountability: false,
  active: {
    exerciseId: "e",
    setId: "s",
    fields: {
      reps: "7",
      durationSeconds: "",
      distanceMeters: "",
      weight: "",
      unit: "kg",
      restSeconds: "0",
    },
  },
});
test("encrypted recovery payload is owner/run bound and expires after24h", () => {
  assert.ok(readRecovery(draft(), "a", "r", 2));
  assert.equal(readRecovery(draft(), "b", "r", 2), null);
  assert.equal(readRecovery(draft(), "a", "other", 2), null);
  assert.equal(readRecovery(draft(), "a", "r", 86_400_001), null);
});
test("recovery rejects corrupt or unbounded fields before presentation", () => {
  assert.equal(readRecovery({ ...draft(), revision: 1.5 }, "a", "r", 2), null);
  assert.equal(readRecovery({ ...draft(), updatedAt: Infinity }, "a", "r", 2), null);
  assert.equal(readRecovery({ ...draft(), note: "x".repeat(1001) }, "a", "r", 2), null);
  const changed = draft();
  changed.active.fields.unit = "unknown";
  assert.equal(readRecovery(changed, "a", "r", 2), null);
});
