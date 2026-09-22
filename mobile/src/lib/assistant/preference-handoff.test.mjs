import assert from "node:assert/strict";
import test from "node:test";
import { storePreferenceDraft, takePreferenceDraft } from "./preference-handoff.ts";

test("preference suggestions reach review unchanged, isolated from later mutation and single use", () => {
  const draft = { activity: "running", durationMin: 45, approvedIntent: "A gentle run" };
  storePreferenceDraft("receipt", "a", draft, () => true, 0);
  draft.durationMin = 90;
  assert.deepEqual(takePreferenceDraft("receipt", "a", 1), {
    activity: "running",
    durationMin: 45,
    approvedIntent: "A gentle run",
  });
  assert.equal(takePreferenceDraft("receipt", "a", 2), undefined);
});

test("account switches, stale sessions and expired handoffs cannot reveal a private suggestion", () => {
  const draft = { approvedIntent: "private" };
  storePreferenceDraft("receipt", "a", draft, () => true, 0);
  assert.equal(takePreferenceDraft("receipt", "b", 1), undefined);
  let current = true;
  storePreferenceDraft("receipt", "a", draft, () => current, 0);
  current = false;
  assert.equal(takePreferenceDraft("receipt", "a", 1), undefined);
  storePreferenceDraft("receipt", "a", draft, () => true, 0);
  assert.equal(takePreferenceDraft("receipt", "a", 600_000), undefined);
  storePreferenceDraft("receipt", "a", draft, () => false, 0);
  assert.equal(takePreferenceDraft("receipt", "a", 1), undefined);
});

test("a new handoff replaces the previous suggestion rather than retaining private drafts", () => {
  storePreferenceDraft("old", "a", { durationMin: 30 }, () => true, 0);
  storePreferenceDraft("new", "a", { durationMin: 60 }, () => true, 0);
  assert.equal(takePreferenceDraft("new", "a", 1)?.durationMin, 60);
  assert.equal(takePreferenceDraft("old", "a", 1), undefined);
});
