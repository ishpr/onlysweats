import assert from "node:assert/strict";
import { test } from "node:test";
import { submitWorkout, workoutSubmission } from "./create-workout.ts";

const content = () => ({
  title: "Private strength",
  activity: "strength",
  instructions: "Comfortable effort",
  exercises: [
    {
      id: "exercise-1",
      name: "Squat",
      instructions: "Controlled movement",
      sets: [
        {
          id: "set-1",
          reps: 8,
          durationSeconds: null,
          distanceMeters: null,
          weight: null,
          unit: "bodyweight",
          restSeconds: 45,
        },
      ],
    },
  ],
});
const signal = () => new AbortController().signal;
function server({ lostPlanReply = false, lostRunReply = false } = {}) {
  const calls = [];
  let plan = null;
  let run = null;
  return {
    calls,
    session: {
      isCurrent: () => true,
      request: async (path, { json }) => {
        calls.push({ path, json: structuredClone(json) });
        if (path === "/fitness/plans") {
          plan ??= { ...json, revision: 1 };
          if (lostPlanReply) {
            lostPlanReply = false;
            throw new Error("Lost plan reply");
          }
          return { plan };
        }
        assert.equal(path, "/fitness/runs");
        assert.deepEqual(json, { id: "run-1", planId: "plan-1", expectedPlanRevision: 1 });
        run ??= { id: json.id, status: "in_progress", results: [] };
        if (lostRunReply) {
          lostRunReply = false;
          throw new Error("Lost run reply");
        }
        return { run };
      },
    },
  };
}

test("review receipt is inert; save for later creates a plan without starting a run", async () => {
  const fixture = server();
  const receipt = workoutSubmission("plan-1", "run-1", content(), false);
  assert.equal(fixture.calls.length, 0);
  const result = await submitWorkout(receipt, fixture.session, signal());
  assert.equal(result.run, null);
  assert.deepEqual(
    fixture.calls.map(({ path }) => path),
    ["/fitness/plans"],
  );
});

test("lost save reply retries the reviewed snapshot and IDs without adopting later edits", async () => {
  const fixture = server({ lostPlanReply: true });
  const original = content();
  const receipt = workoutSubmission("plan-1", "run-1", original, true);
  await assert.rejects(submitWorkout(receipt, fixture.session, signal()), /Lost plan reply/);
  original.title = "A different plan";
  original.exercises[0].sets[0].reps = 99;
  const result = await submitWorkout(receipt, fixture.session, signal());
  assert.deepEqual(fixture.calls[0], fixture.calls[1]);
  assert.equal(result.plan.title, "Private strength");
  assert.equal(result.plan.exercises[0].sets[0].reps, 8);
  assert.equal(result.run.status, "in_progress");
  assert.deepEqual(result.run.results, []);
});

test("lost start reply reuses the same run identity and reviewed plan revision", async () => {
  const fixture = server({ lostRunReply: true });
  const receipt = workoutSubmission("plan-1", "run-1", content(), true);
  await assert.rejects(submitWorkout(receipt, fixture.session, signal()), /Lost run reply/);
  const result = await submitWorkout(receipt, fixture.session, signal());
  const starts = fixture.calls.filter(({ path }) => path === "/fitness/runs");
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0], starts[1]);
  assert.equal(result.run.id, "run-1");
  assert.deepEqual(result.run.results, []);
});

test("a replaced session after saving never starts a workout for the next account", async () => {
  let current = true;
  const calls = [];
  const session = {
    isCurrent: () => current,
    request: async (path, { json }) => {
      calls.push(path);
      current = false;
      return { plan: { ...json, revision: 1 } };
    },
  };
  await assert.rejects(
    submitWorkout(workoutSubmission("plan-1", "run-1", content(), true), session, signal()),
    /session changed/,
  );
  assert.deepEqual(calls, ["/fitness/plans"]);
});

test("an abandoned screen aborts before a second write and stale sessions cannot save", async () => {
  const controller = new AbortController();
  const fixture = server();
  const request = fixture.session.request;
  fixture.session.request = async (...args) => {
    const result = await request(...args);
    controller.abort();
    return result;
  };
  const receipt = workoutSubmission("plan-1", "run-1", content(), true);
  await assert.rejects(
    submitWorkout(receipt, fixture.session, controller.signal),
    /session changed/,
  );
  assert.equal(fixture.calls.length, 1);
  fixture.session.isCurrent = () => false;
  await assert.rejects(submitWorkout(receipt, fixture.session, signal()), /session changed/);
  assert.equal(fixture.calls.length, 1);
});
