import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkoutTimer,
  createWorkoutTimerLifecycle,
  fieldsWithTimedDuration,
  formatTimerSeconds,
  MAX_TIMER_SECONDS,
  MAX_TIMER_SCOPE_LENGTH,
  readWorkoutTimerCheckpoint,
  workoutSetTimerIdentity,
} from "./workout-timer.ts";
import { emptySetFields, parseSetFields } from "./forms.ts";
import { acknowledgeUpload, newOfflineRun, prepareUpload } from "./offline-data.ts";

function fixture() {
  let now = 0,
    current = true;
  const timer = createWorkoutTimer({ now: () => now, isCurrent: () => current, scope: "test" });
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

test("explicit pause excludes paused time and resume retains partial seconds", () => {
  const { timer, at } = fixture();
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false, reviewReason: null });
  timer.start();
  at(1750);
  timer.pause();
  assert.deepEqual(timer.read(), { elapsedSeconds: 1, running: false, reviewReason: null });
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
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false, reviewReason: null });
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
    assert.deepEqual(timer.read(), { elapsedSeconds: null, running: false, reviewReason: null });
  }
});

test("a changed run revision, active set or conflict fences a queued old timer confirmation", () => {
  for (const next of ["2:exercise:set-a", "1:exercise:set-b", null]) {
    let scope = "1:exercise:set-a";
    const captured = scope;
    let now = 0;
    const timer = createWorkoutTimer({
      now: () => now,
      isCurrent: () => scope === captured,
      scope: captured,
    });
    timer.start();
    now = 12_000;
    timer.pause();
    scope = next;
    assert.equal(timer.confirmedDuration(), null);
    assert.deepEqual(timer.read(), { elapsedSeconds: null, running: false, reviewReason: null });
  }
});

test("clock values and confirmations are bounded to valid recorded durations", () => {
  const { timer, at } = fixture();
  timer.start();
  at(1e12);
  timer.pause();
  assert.equal(timer.confirmedDuration(), null);
  assert.deepEqual(timer.read(), {
    elapsedSeconds: null,
    running: false,
    reviewReason: "duration_limit",
  });
  for (const value of [null, 0, -1, 0.5, NaN, Infinity, MAX_TIMER_SECONDS + 1])
    assert.throws(() => fieldsWithTimedDuration(emptySetFields(), value));
  timer.reset();
  at(NaN);
  timer.start();
  assert.deepEqual(timer.read(), {
    elapsedSeconds: null,
    running: false,
    reviewReason: "clock_changed",
  });
  assert.equal(formatTimerSeconds(75), "1:15");
  assert.equal(formatTimerSeconds(600), "10:00");
});

function lifecycleFixture(options = {}) {
  let now = 0;
  const timer = createWorkoutTimerLifecycle({
    now: () => now,
    scope: "test",
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

test("a rest timer mounted during save waits for enablement, then continues through later saves", () => {
  const { timer, at } = lifecycleFixture({ disabled: true });
  timer.focus(true);
  at(20_000); // Save callback and query invalidation have not finished.
  assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false, reviewReason: null });
  timer.setDisabled(false);
  assert.equal(timer.read().running, true);
  at(23_000);
  assert.equal(timer.read().elapsedSeconds, 3, "Saving time is excluded.");
  timer.setDisabled(true);
  at(40_000);
  timer.setDisabled(false);
  assert.deepEqual(timer.read(), { elapsedSeconds: 20, running: true, reviewReason: null });
  timer.start();
  at(42_000);
  timer.pause();
  assert.equal(timer.confirmedDuration(), 22);
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
    assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false, reviewReason: null });
    timer.start();
    at(12_000);
    timer.pause();
    assert.equal(timer.confirmedDuration(), 2);
  }
});

test("background and screen changes keep an already-started clock running without recording results", () => {
  const { timer, at } = lifecycleFixture();
  timer.focus(false);
  at(10_000);
  timer.foregroundChanged(true);
  assert.equal(timer.read().running, true);
  at(12_000);
  timer.foregroundChanged(false);
  at(90_000);
  assert.equal(timer.confirmedDuration(), null);
  timer.foregroundChanged(true);
  assert.deepEqual(timer.read(), { elapsedSeconds: 80, running: true, reviewReason: null });
  timer.blur();
  at(100_000);
  timer.focus(true);
  assert.deepEqual(timer.read(), { elapsedSeconds: 90, running: true, reviewReason: null });
  timer.pause();
  timer.foregroundChanged(false);
  at(200_000);
  timer.foregroundChanged(true);
  assert.deepEqual(timer.read(), { elapsedSeconds: 90, running: false, reviewReason: null });
});

test("explicit pause/reset and revoked scope prevent a deferred initial start", () => {
  for (const action of ["pause", "reset"]) {
    const { timer } = lifecycleFixture();
    timer.focus(true);
    timer[action]();
    timer.setDisabled(false);
    assert.deepEqual(timer.read(), { elapsedSeconds: 0, running: false, reviewReason: null });
  }
  let current = true;
  const { timer } = lifecycleFixture({ disabled: true, isCurrent: () => current });
  timer.focus(true);
  current = false;
  timer.setDisabled(false);
  assert.deepEqual(timer.read(), { elapsedSeconds: null, running: false, reviewReason: null });
});

test("a serialized start continues across lock and process restart with no automatic actuals", () => {
  let now = 1000;
  const options = { now: () => now, isCurrent: () => true, scope: "owner-run-set" };
  const first = createWorkoutTimer(options);
  const fields = emptySetFields();
  first.start();
  const persisted = JSON.parse(JSON.stringify(first.checkpoint()));
  assert.deepEqual(persisted, {
    schema: 1,
    scope: options.scope,
    elapsedMs: 0,
    startedAtMs: 1000,
    checkpointAtMs: 1000,
    reviewReason: null,
  });
  now = 2500;
  first.read();
  now = 4000;
  first.read();
  assert.equal(persisted.elapsedMs, 0, "Polling does not require a persisted update.");
  first.dispose();
  now = 61_900;
  const restored = createWorkoutTimer({ ...options, checkpoint: persisted });
  assert.deepEqual(restored.read(), { elapsedSeconds: 60, running: true, reviewReason: null });
  assert.equal(restored.confirmedDuration(), null);
  assert.equal(fields.durationSeconds, "");
  assert.throws(() => parseSetFields(fields, true));
  restored.pause();
  assert.equal(restored.confirmedDuration(), 60);
  const confirmed = fieldsWithTimedDuration(fields, restored.confirmedDuration());
  assert.equal(confirmed.durationSeconds, "60");
  assert.equal("status" in confirmed, false);
  assert.equal(fields.durationSeconds, "");
});

test("serialization retains fractional seconds through pause, restart and explicit resume", () => {
  let now = 1000;
  const options = { now: () => now, isCurrent: () => true, scope: "same-set" };
  const first = createWorkoutTimer(options);
  first.start();
  now = 2750;
  first.pause();
  const saved = JSON.parse(JSON.stringify(first.checkpoint()));
  now = 80_000;
  const restored = createWorkoutTimerLifecycle({
    ...options,
    checkpoint: saved,
    autoStart: true,
    disabled: false,
  });
  restored.focus(true);
  assert.deepEqual(restored.read(), { elapsedSeconds: 1, running: false, reviewReason: null });
  restored.start();
  now = 80_300;
  restored.pause();
  assert.equal(restored.confirmedDuration(), 2);
  const pauseAgain = restored.checkpoint();
  restored.reset();
  assert.deepEqual(restored.read(), { elapsedSeconds: 0, running: false, reviewReason: null });
  assert.equal(pauseAgain.elapsedMs, 2050, "Checkpoints are independent immutable values.");
});

test("a running checkpoint reanchors once without double-counting elapsed time after restart", () => {
  let now = 1000;
  const options = { now: () => now, isCurrent: () => true, scope: "same-set" };
  const timer = createWorkoutTimer(options);
  timer.start();
  now = 7500;
  const saved = JSON.parse(JSON.stringify(timer.checkpoint()));
  assert.equal(saved.elapsedMs, 6500);
  assert.equal(saved.startedAtMs, 7500);
  now = 10_000;
  const restored = createWorkoutTimer({ ...options, checkpoint: saved });
  assert.equal(restored.read().elapsedSeconds, 9);
  assert.equal(timer.read().elapsedSeconds, 9);
  now = NaN;
  restored.pause();
  assert.equal(restored.read().elapsedSeconds, null);
  assert.equal(restored.read().reviewReason, "clock_changed");
  assert.equal(restored.confirmedDuration(), null);
});

test("scope and session fences refuse restored state and checkpoint exports", () => {
  const { timer, at, revoke } = fixture();
  timer.start();
  at(2500);
  const saved = timer.checkpoint();
  assert.equal(readWorkoutTimerCheckpoint(saved, "another-set"), null);
  const wrongSet = createWorkoutTimer({
    now: () => 3000,
    isCurrent: () => true,
    scope: "another-set",
    checkpoint: saved,
  });
  assert.deepEqual(wrongSet.read(), {
    elapsedSeconds: null,
    running: false,
    reviewReason: "invalid_checkpoint",
  });
  revoke();
  assert.equal(timer.checkpoint(), null);
  assert.equal(timer.restore(saved), false);
  assert.equal(timer.confirmedDuration(), null);
  assert.deepEqual(timer.read(), { elapsedSeconds: null, running: false, reviewReason: null });
});

test("corrupt checkpoints cannot invent elapsed values or unsafe running intervals", () => {
  const { timer } = fixture();
  timer.start();
  const valid = timer.checkpoint();
  for (const checkpoint of [
    null,
    [],
    {},
    { ...valid, schema: 2 },
    { ...valid, scope: "" },
    { ...valid, elapsedMs: null },
    { ...valid, elapsedMs: -1 },
    { ...valid, elapsedMs: Infinity },
    { ...valid, elapsedMs: "1" },
    { ...valid, elapsedMs: 1.5 },
    { ...valid, elapsedMs: MAX_TIMER_SECONDS * 1000 + 1 },
    { ...valid, startedAtMs: 2, checkpointAtMs: 1 },
    { ...valid, checkpointAtMs: NaN },
    { ...valid, startedAtMs: 0, checkpointAtMs: MAX_TIMER_SECONDS * 1000 + 1 },
    { ...valid, reviewReason: "clock_changed" },
    { ...valid, reviewReason: "unknown" },
  ])
    assert.equal(readWorkoutTimerCheckpoint(checkpoint, "test"), null);
  assert.equal(
    readWorkoutTimerCheckpoint(
      { ...valid, scope: "a".repeat(MAX_TIMER_SCOPE_LENGTH + 1) },
      "a".repeat(MAX_TIMER_SCOPE_LENGTH + 1),
    ),
    null,
  );
  assert.equal(timer.restore({ ...valid, elapsedMs: null }), false);
  assert.equal(timer.confirmedDuration(), null);
  assert.equal(timer.read().reviewReason, "invalid_checkpoint");
});

test("clock regression yields unknown elapsed time that remains unknown after restart", () => {
  let now = 10_000;
  const options = { now: () => now, isCurrent: () => true, scope: "same-set" };
  const timer = createWorkoutTimer(options);
  timer.start();
  now = 15_000;
  assert.equal(timer.read().elapsedSeconds, 5);
  now = 14_999;
  assert.deepEqual(timer.read(), {
    elapsedSeconds: null,
    running: false,
    reviewReason: "clock_changed",
  });
  timer.pause();
  timer.start();
  assert.equal(timer.confirmedDuration(), null);
  const saved = JSON.parse(JSON.stringify(timer.checkpoint()));
  assert.equal(
    saved.elapsedMs,
    5000,
    "Previously observed time is retained, but not asserted as total duration.",
  );
  now = 50_000;
  const restored = createWorkoutTimer({ ...options, checkpoint: saved });
  assert.equal(restored.read().elapsedSeconds, null);
  assert.equal(restored.confirmedDuration(), null);
  restored.reset();
  restored.start();
  now = 52_000;
  restored.pause();
  assert.equal(restored.confirmedDuration(), 2);
});

test("restart beyond the bounded interval requires review rather than capping a fabricated actual", () => {
  const { timer } = fixture();
  timer.start();
  const restored = createWorkoutTimer({
    now: () => (MAX_TIMER_SECONDS + 1) * 1000,
    isCurrent: () => true,
    scope: "test",
    checkpoint: JSON.parse(JSON.stringify(timer.checkpoint())),
  });
  assert.deepEqual(restored.read(), {
    elapsedSeconds: null,
    running: false,
    reviewReason: "duration_limit",
  });
  assert.equal(restored.confirmedDuration(), null);
  const backwards = createWorkoutTimer({
    now: () => 0,
    isCurrent: () => true,
    scope: "test",
    checkpoint: { ...timer.checkpoint(), startedAtMs: 1000, checkpointAtMs: 1000 },
  });
  assert.equal(backwards.read().reviewReason, "clock_changed");
});

test("optional monotonic detection rejects a large same-process wall jump within the duration limit", () => {
  let now = 1000,
    monotonic = 0;
  const timer = createWorkoutTimer({
    now: () => now,
    monotonicNow: () => monotonic,
    isCurrent: () => true,
    scope: "test",
  });
  timer.start();
  now = 4000;
  monotonic = 3000;
  assert.equal(timer.read().elapsedSeconds, 3);
  now = 3_604_000;
  monotonic = 4000;
  assert.equal(timer.read().reviewReason, "clock_changed");
  assert.equal(timer.confirmedDuration(), null);
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
  assert.deepEqual(timer.read(), { elapsedSeconds: 12, running: true, reviewReason: null });
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
