import assert from "node:assert/strict";
import { test } from "node:test";
import {
  storeGeneratedWorkoutPlanDraft,
  storeWorkoutPlanDraft,
  takeWorkoutEditorDraft,
  takeWorkoutPlanDraft,
} from "./draft-handoff.ts";

const draft = () => ({
  title: "Buddy strength",
  note: "A private note",
  exercises: [{ name: "Squat", sets: 3, reps: 8, weight: null, unit: null }],
});

test("plan draft is bound to the original identity and invalidated on session change", () => {
  let current = true;
  storeWorkoutPlanDraft("first", "member-a", draft(), () => current, 0);
  assert.equal(takeWorkoutPlanDraft("first", "member-b", 1), null);
  storeWorkoutPlanDraft("second", "member-a", draft(), () => current, 0);
  current = false;
  assert.equal(takeWorkoutPlanDraft("second", "member-a", 1), null);
});

test("plan draft expires, is single use, and does not adopt mutated source data", () => {
  const original = draft();
  storeWorkoutPlanDraft("first", "member-a", original, () => true, 0);
  original.exercises[0].reps = 99;
  assert.equal(takeWorkoutPlanDraft("first", "member-a", 1)?.exercises[0].reps, 8);
  assert.equal(takeWorkoutPlanDraft("first", "member-a", 2), null);
  storeWorkoutPlanDraft("expired", "member-a", draft(), () => true, 0);
  assert.equal(takeWorkoutPlanDraft("expired", "member-a", 600_000), null);
});

test("generated and extracted handoffs replace one another without sharing another identity's draft", () => {
  const generated = {
    title: "Future plan",
    activity: "strength",
    instructions: "Review",
    exercises: [
      {
        name: "Squat",
        instructions: "Controlled movement",
        sets: 2,
        reps: 5,
        durationSeconds: null,
        restSeconds: 60,
      },
    ],
  };
  storeWorkoutPlanDraft("extracted", "a", draft(), () => true, 0);
  storeGeneratedWorkoutPlanDraft("generated", "a", generated, () => true, 0);
  generated.exercises[0].reps = 100;
  assert.equal(takeWorkoutEditorDraft("extracted", "a", 1), null);
  const value = takeWorkoutEditorDraft("generated", "a", 1);
  assert.equal(value.kind, "generated");
  assert.equal(value.draft.exercises[0].reps, 5);
  assert.equal(takeWorkoutEditorDraft("generated", "a", 1), null);
});
