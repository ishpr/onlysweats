import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkoutTimer,
  createWorkoutTimerLifecycle,
  fieldsWithTimedDuration,
  formatTimerSeconds,
  MAX_TIMER_SECONDS,
  workoutSetTimerIdentity,
} from "./workout-timer.ts";
import { emptySetFields, parseSetFields } from "./forms.ts";
import { acknowledgeUpload, newOfflineRun, prepareUpload } from "./offline-data.ts";

function fixture() {
  let now = 0,
    current = true;
  const timer = createWorkoutTimer({ now: () => now, isCurrent: () => current });
  return {
    timer,
    at: (value) => {
      now = value;
    },
    revoke: () => {
      current = false;
    },
  };
}

test("pause excludes time outside the foreground and resume retains partial seconds", () => {
  const { timer, at } = fixture();
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
  timer.start();
  at(1750);
  timer.pause();
  assert.deepEqual(timer.read(), { elapsedSeconds: 1, running: false });
  at(90_000);
  assert.equal(timer.read().elapsedSeconds, 1);
  timer.start();
  at(90_300);
  timer.pause();
  assert.equal(timer.confirmedDuration(), 2);
  at(300_000);
  assert.equal(timer.confirmedDuration(), 2);
});

test("reaching or exceeding a prescribed time never supplies a duration without explicit pause and confirmation", () => {
  const { timer, at } = fixture();
  const fields = emptySetFields();
  timer.start();
  at(75_900); // A 60-second prescription has passed; no target enters this clock.
  assert.equal(timer.read().elapsedSeconds, 75);
  assert.equal(timer.confirmedDuration(), null);
  assert.equal(fields.durationSeconds, "");
  assert.throws(() => parseSetFields(fields, true));
  timer.pause();
  const confirmed = fieldsWithTimedDuration(fields, timer.confirmedDuration());
  assert.equal(confirmed.durationSeconds, "75");
  assert.equal(fields.durationSeconds, "", "The editable source remains immutable.");
  assert.deepEqual(parseSetFields(confirmed, true), {
    reps: null,
    durationSeconds: 75,
    distanceMeters: null,
    weight: null,
    unit: "kg",
    restSeconds: 60,
  });
  assert.equal("status" in confirmed, false, "Filling duration is not marking a set completed.");
});

test("explicit duration confirmation changes only duration, never prescriptions, reps, distance or load", () => {
  const fields = {
    ...emptySetFields(),
    reps: "6",
    weight: "",
    unit: "bodyweight",
    distanceMeters: "",
    restSeconds: "0",
  };
  const next = fieldsWithTimedDuration(fields, 12);
  assert.deepEqual(next, { ...fields, durationSeconds: "12" });
  assert.deepEqual(fields, {
    ...emptySetFields(),
    reps: "6",
    weight: "",
    unit: "bodyweight",
    distanceMeters: "",
    restSeconds: "0",
  });
});

test("reset pauses and discards elapsed duration, with no automatic restart", () => {
  const { timer, at } = fixture();
  timer.start();
  at(10_000);
  timer.reset();
  at(60_000);
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
  assert.equal(timer.confirmedDuration(), null);
  timer.start();
  at(60_900);
  timer.pause();
  assert.equal(
    timer.confirmedDuration(),
    null,
    "Do not round a fraction up into performed seconds.",
  );
});

test("account revocation and disposal fence even a previously paused duration", () => {
  for (const dispose of [false, true]) {
    const { timer, at, revoke } = fixture();
    timer.start();
    at(5000);
    timer.pause();
    assert.equal(timer.confirmedDuration(), 5);
    if (dispose) timer.dispose();
    else revoke();
    assert.equal(timer.confirmedDuration(), null);
    timer.start();
    at(10_000);
    assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
  }
});

test("a changed run revision, active set or conflict fences a queued old timer confirmation", () => {
  for (const next of ["2:exercise:set-a", "1:exercise:set-b", null]) {
    let scope = "1:exercise:set-a";
    const captured = scope;
    let now = 0;
    const timer = createWorkoutTimer({ now: () => now, isCurrent: () => scope === captured });
    timer.start();
    now = 12_000;
    timer.pause();
    scope = next;
    assert.equal(timer.confirmedDuration(), null);
    assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
  }
});

test("clock values and confirmations are bounded to valid recorded durations", () => {
  const { timer, at } = fixture();
  timer.start();
  at(1e12);
  timer.pause();
  assert.equal(timer.confirmedDuration(), MAX_TIMER_SECONDS);
  for (const value of [null, 0, -1, 0.5, NaN, Infinity, MAX_TIMER_SECONDS + 1])
    assert.throws(() => fieldsWithTimedDuration(emptySetFields(), value));
  timer.reset();
  at(NaN);
  timer.start();
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
  assert.equal(formatTimerSeconds(75), "1:15");
  assert.equal(formatTimerSeconds(600), "10:00");
});

function lifecycleFixture(options = {}) {
  let now = 0;
  const timer = createWorkoutTimerLifecycle({
    now: () => now,
    isCurrent: () => true,
    autoStart: true,
    disabled: false,
    ...options,
  });
  return {
    timer,
    at: (value) => {
      now = value;
    },
  };
}

test("a rest timer mounted during save waits for enablement and starts only once", () => {
  const { timer, at } = lifecycleFixture({ disabled: true });
  timer.focus(true);
  at(20_000); // Save callback and query invalidation have not finished.
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
  timer.setDisabled(false);
  assert.equal(timer.read().running, true);
  at(23_000);
  assert.equal(timer.read().elapsedSeconds, 3, "Saving time is excluded.");
  timer.setDisabled(true);
  at(40_000);
  timer.setDisabled(false);
  assert.deepEqual(timer.read(), { elapsedSeconds: 3, running: false });
  timer.start();
  at(42_000);
  timer.pause();
  assert.equal(timer.confirmedDuration(), 5);
});

test("leaving screen or foreground while initial save is pending cancels deferred start", () => {
  for (const leave of ["screen", "app"]) {
    const { timer, at } = lifecycleFixture({ disabled: true });
    timer.focus(true);
    if (leave === "screen") timer.blur();
    else timer.foregroundChanged(false);
    at(10_000);
    timer.setDisabled(false);
    if (leave === "screen") timer.focus(true);
    else timer.foregroundChanged(true);
    assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
    timer.start();
    at(12_000);
    timer.pause();
    assert.equal(timer.confirmedDuration(), 2);
  }
});

test("initial inactive app waits for first foreground, but later foreground never resumes", () => {
  const { timer, at } = lifecycleFixture();
  timer.focus(false);
  at(10_000);
  timer.foregroundChanged(true);
  assert.equal(timer.read().running, true);
  at(12_000);
  timer.foregroundChanged(false);
  at(90_000);
  timer.foregroundChanged(true);
  assert.deepEqual(timer.read(), { elapsedSeconds: 2, running: false });
  timer.blur();
  timer.focus(true);
  assert.deepEqual(timer.read(), { elapsedSeconds: 2, running: false });
});

test("explicit pause/reset and revoked scope prevent a deferred initial start", () => {
  for (const action of ["pause", "reset"]) {
    const { timer } = lifecycleFixture({ disabled: true });
    timer.focus(true);
    timer[action]();
    timer.setDisabled(false);
    assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
  }
  let current = true;
  const { timer } = lifecycleFixture({ disabled: true, isCurrent: () => current });
  timer.focus(true);
  current = false;
  timer.setDisabled(false);
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false });
});

const timedRun = () => ({
  id: "run",
  revision: 1,
  planId: "plan",
  planRevision: 1,
  sessionId: null,
  startedAt: "2026-09-21T12:00:00Z",
  updatedAt: "2026-09-21T12:00:00Z",
  finishedAt: null,
  status: "in_progress",
  note: "",
  shareAccountability: false,
  results: [],
  snapshot: {
    title: "Two sets",
    activity: "mobility",
    instructions: "",
    exercises: [
      {
        id: "exercise",
        name: "Hold",
        instructions: "",
        sets: ["first", "second"].map((id) => ({
          id,
          reps: null,
          durationSeconds: 30,
          distanceMeters: null,
          weight: null,
          unit: "bodyweight",
          restSeconds: 30,
        })),
      },
    ],
  },
});

test("acknowledging the previous offline set preserves the active timer and unrecorded duration", () => {
  let entry = newOfflineRun(timedRun(), 0);
  const first = {
    exerciseId: "exercise",
    setId: "first",
    status: "completed",
    reps: null,
    durationSeconds: 20,
    distanceMeters: null,
    weight: null,
    unit: "bodyweight",
  };
  entry = prepareUpload(
    { ...entry, version: 1, draft: { ...entry.draft, results: [first] } },
    "mutation",
  );
  entry = {
    ...entry,
    version: 2,
    active: { exerciseId: "exercise", setId: "second", fields: emptySetFields() },
  };
  const identity = workoutSetTimerIdentity(entry.base, "exercise", "second");
  const currentIdentity = () =>
    entry.conflict ? null : workoutSetTimerIdentity(entry.base, "exercise", "second");
  const { timer, at } = lifecycleFixture({ isCurrent: () => currentIdentity() === identity });
  timer.focus(true);
  at(7_000);
  entry = acknowledgeUpload(entry, "mutation", { ...entry.base, revision: 2, results: [first] });
  assert.equal(entry.base.revision, 2);
  assert.equal(currentIdentity(), identity, "The mounted timer key stays unchanged.");
  at(12_000);
  assert.deepEqual(timer.read(), { elapsedSeconds: 12, running: true });
  assert.equal(timer.confirmedDuration(), null);
  assert.equal(entry.active.fields.durationSeconds, "");
  assert.equal(
    entry.draft.results.some((result) => result.setId === "second"),
    false,
  );
  timer.pause();
  assert.equal(timer.confirmedDuration(), 12);
  entry = { ...entry, conflict: { ...entry.base, revision: 3 } };
  assert.equal(timer.confirmedDuration(), null, "Conflict review fences prior elapsed values.");
});

test("replaced targets, actuals, plans and completed runs change the active timer identity", () => {
  const run = timedRun();
  const original = workoutSetTimerIdentity(run, "exercise", "second");
  for (const change of [
    (value) => {
      value.snapshot.exercises[0].sets[1].durationSeconds = 45;
    },
    (value) => {
      value.planRevision = 2;
    },
    (value) => {
      value.results = [
        {
          exerciseId: "exercise",
          setId: "second",
          status: "skipped",
          reps: null,
          durationSeconds: null,
          distanceMeters: null,
          weight: null,
          unit: "bodyweight",
        },
      ];
    },
    (value) => {
      value.status = "completed";
    },
    (value) => {
      value.snapshot.exercises[0].sets.pop();
    },
  ]) {
    const changed = structuredClone(run);
    change(changed);
    assert.notEqual(workoutSetTimerIdentity(changed, "exercise", "second"), original);
  }
});
