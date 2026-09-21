import assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarizeWorkoutPlan,
  summarizeAIWorkoutPlan,
} from "../../../../shared/workout-plan-summary.ts";

test("mixed timed and rep targets count only explicit time and sum every prescribed rest", () => {
  const summary = summarizeWorkoutPlan({
    instructions: "Warm up for 5 minutes",
    exercises: [
      {
        instructions: "Move slowly for about 3 minutes",
        sets: [
          { durationSeconds: 90, restSeconds: 30, reps: null },
          { durationSeconds: null, restSeconds: 60, reps: 10 },
        ],
      },
      { instructions: "Cool down", sets: [{ durationSeconds: 60, restSeconds: 0, reps: 5 }] },
    ],
  });
  assert.deepEqual(summary, {
    totalSetCount: 3,
    timedTargetSeconds: 150,
    plannedRestSeconds: 90,
    hasUntimedSets: true,
  });
});

test("untimed prescriptions never imply a workout duration", () => {
  assert.deepEqual(
    summarizeWorkoutPlan({
      exercises: [
        {
          sets: [
            { durationSeconds: null, restSeconds: 0, reps: 20, distanceMeters: null },
            { durationSeconds: null, restSeconds: 30, reps: null, distanceMeters: 500 },
          ],
        },
      ],
    }),
    {
      totalSetCount: 2,
      timedTargetSeconds: 0,
      plannedRestSeconds: 30,
      hasUntimedSets: true,
    },
  );
});

test("AI draft totals expand the number of prescribed sets without counting prose phases", () => {
  const summary = summarizeAIWorkoutPlan({
    instructions: "5-minute warmup then 25 minutes of intervals",
    exercises: [{ sets: 5, durationSeconds: 300, restSeconds: 15, reps: null }],
  });
  assert.deepEqual(summary, {
    totalSetCount: 5,
    timedTargetSeconds: 1500,
    plannedRestSeconds: 75,
    hasUntimedSets: false,
  });
  assert.equal(
    summarizeAIWorkoutPlan({
      exercises: [{ sets: 3, durationSeconds: null, restSeconds: 60, reps: 8 }],
    }).hasUntimedSets,
    true,
  );
});
