import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  isAIWorkoutPlanDraft,
  planContentFromAIDraft,
} from "../../../../shared/workout-plan-draft.ts";
import { workoutPlanContentInput } from "../../../../src/lib/workout-plans/contracts.ts";
import { parseLocalWorkoutPlanResult } from "./plan-draft.ts";

const draft = () => ({
  title: "Buddy circuit",
  activity: "strength",
  instructions: "Review each exercise and choose the targets together.",
  exercises: [
    {
      name: "Squat",
      instructions: "Use a controlled movement.",
      sets: 3,
      reps: 8,
      durationSeconds: null,
      restSeconds: 60,
    },
    {
      name: "Plank",
      instructions: "Keep breathing.",
      sets: 2,
      reps: null,
      durationSeconds: 20,
      restSeconds: 30,
    },
  ],
});
const native = () => ({
  status: "available",
  execution: "on_device",
  modelUsed: true,
  requiresReview: true,
  planDraft: draft(),
});

test("AI plans are expanded into valid prescriptions with independent code-assigned identifiers", () => {
  const value = draft();
  assert.equal(isAIWorkoutPlanDraft(value), true);
  const content = planContentFromAIDraft(value, randomUUID);
  assert.equal(workoutPlanContentInput.safeParse(content).success, true);
  assert.equal(content.exercises[0].sets.length, 3);
  assert.equal(content.exercises[1].sets.length, 2);
  const ids = content.exercises.flatMap((exercise) => [
    exercise.id,
    ...exercise.sets.map((set) => set.id),
  ]);
  assert.equal(new Set(ids).size, 7);
  for (const exercise of content.exercises)
    for (const set of exercise.sets) {
      assert.equal(set.weight, null);
      assert.equal(set.distanceMeters, null);
      assert.equal(set.unit, "kg");
      assert.equal("completed" in set, false);
      assert.equal("startedAt" in set, false);
    }
  content.exercises[0].sets[0].reps = 5;
  assert.equal(value.exercises[0].reps, 8);
  assert.equal(content.exercises[0].sets[1].reps, 8);
});

test("plan draft validation rejects invented actions, missing targets and budget overflows", () => {
  const invalid = [
    (d) => {
      d.saved = true;
    },
    (d) => {
      d.title = " ";
    },
    (d) => {
      d.title = "x".repeat(121);
    },
    (d) => {
      d.activity = "medical_rehab";
    },
    (d) => {
      d.instructions = "x".repeat(1001);
    },
    (d) => {
      d.exercises = [];
    },
    (d) => {
      d.exercises = Array.from({ length: 13 }, () => ({ ...d.exercises[0] }));
    },
    (d) => {
      d.exercises = Array.from({ length: 7 }, () => ({ ...d.exercises[0], sets: 20 }));
    },
    (d) => {
      d.exercises[0].sets = 21;
    },
    (d) => {
      d.exercises[0].sets = 1.5;
    },
    (d) => {
      d.exercises[0].name = "x".repeat(101);
    },
    (d) => {
      d.exercises[0].instructions = "x".repeat(501);
    },
    (d) => {
      d.exercises[0].reps = null;
    },
    (d) => {
      d.exercises[0].reps = 1001;
    },
    (d) => {
      delete d.exercises[0].durationSeconds;
    },
    (d) => {
      d.exercises[0].durationSeconds = 86401;
    },
    (d) => {
      d.exercises[0].durationSeconds = 0;
    },
    (d) => {
      d.exercises[0].restSeconds = -1;
    },
    (d) => {
      d.exercises[0].weight = 100;
    },
    (d) => {
      d.exercises[0].completed = true;
    },
  ];
  for (const change of invalid) {
    const value = draft();
    change(value);
    assert.equal(isAIWorkoutPlanDraft(value), false);
    assert.throws(() => planContentFromAIDraft(value, randomUUID));
  }
  assert.equal(isAIWorkoutPlanDraft(null), false);
});

test("identifier creation never accepts model identifiers or duplicate app identifiers", () => {
  assert.throws(() => planContentFromAIDraft(draft(), () => "model-id"));
  const id = randomUUID();
  assert.throws(() => planContentFromAIDraft(draft(), () => id));
});

test("local plan response requires review, local channel, valid draft and actual model use", () => {
  const result = parseLocalWorkoutPlanResult(JSON.stringify(native()));
  assert.equal(result.status, "available");
  assert.equal(result.requiresReview, true);
  assert.deepEqual(result.draft, draft());
  for (const patch of [
    { requiresReview: false },
    { modelUsed: false },
    { execution: "cloud" },
    { planDraft: null },
  ]) {
    assert.equal(
      parseLocalWorkoutPlanResult(JSON.stringify({ ...native(), ...patch })).status,
      "error",
    );
  }
  assert.equal(parseLocalWorkoutPlanResult("not-json").status, "error");
  assert.equal(parseLocalWorkoutPlanResult("x".repeat(16001)).status, "error");
});

test("unavailable and cancelled native plans cannot leak provisional drafts or provider error text", () => {
  for (const status of ["cancelled", "unavailable", "error"]) {
    const result = parseLocalWorkoutPlanResult(
      JSON.stringify({ ...native(), status, reason: "sensitive raw provider error" }),
    );
    assert.deepEqual(result, { status, execution: "on_device", reason: "unavailable" });
  }
  const result = parseLocalWorkoutPlanResult(
    JSON.stringify({
      status: "unavailable",
      execution: "on_device",
      reason: "plan_build_required",
    }),
  );
  assert.equal(result.reason, "plan_build_required");
});
