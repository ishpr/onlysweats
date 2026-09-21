import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { bookSeat, PaceError } from "../pace/service.server.ts";
import type { WorkoutSetResult } from "../../../shared/workout-plans.ts";
import {
  acknowledgeUpload,
  hasPendingRun,
  newOfflineRun,
  prepareUpload,
  readOfflineDocument,
  resolveRunConflict,
  type OfflineRun,
  type RunDraft,
} from "../../../mobile/src/lib/workout-plans/offline-data.ts";
import { fixtureMember, fixturePlan, fixtureSession, runTime, testNow } from "./fixtures.ts";
import * as plans from "./service.server.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});

function edit(entry: OfflineRun, draft: RunDraft, now: number): OfflineRun {
  return { ...entry, draft, version: entry.version + 1, updatedAt: now };
}
function request(entry: OfflineRun) {
  assert.ok(entry.pending, "An upload must be durably prepared before sending.");
  return { ...entry.pending.payload, mutationId: entry.pending.mutationId };
}
function restore(entry: OfflineRun, ownerId: string, now: number) {
  const binding = "synthetic-local-owner-binding";
  const persisted = JSON.stringify({
    schema: 1,
    binding,
    ownerId,
    verifiedAt: runTime,
    runs: [entry],
  });
  const document = readOfflineDocument(JSON.parse(persisted), binding, now);
  assert.ok(document, "A valid offline record must survive process restart.");
  assert.equal(document.runs.length, 1);
  return document.runs[0];
}

describe("mobile offline drafts against real workout services", () => {
  it("saves explicit sets exactly once after a lost response while preserving newer disconnected edits", async () => {
    const owner = await fixtureMember(sql);
    const input = fixturePlan();
    input.activity = "strength";
    input.exercises[0].name = "Squat";
    input.exercises[0].sets = input.exercises[0].sets.slice(0, 2).map((set) => ({
      ...set,
      reps: 10,
      durationSeconds: null,
      weight: 25,
      unit: "kg" as const,
    }));
    input.exercises.push({
      id: randomUUID(),
      name: "Plank",
      instructions: "An entered target only.",
      sets: Array.from({ length: 2 }, () => ({
        id: randomUUID(),
        reps: null,
        durationSeconds: 30,
        distanceMeters: null,
        weight: null,
        unit: "bodyweight" as const,
        restSeconds: 60,
      })),
    });
    const plan = await plans.createPlan(sql, owner, input, testNow);
    const run = await plans.startRun(
      sql,
      owner,
      {
        id: randomUUID(),
        planId: plan.id,
        expectedPlanRevision: plan.revision,
      },
      runTime,
    );
    let local = newOfflineRun(run, runTime);
    assert.deepEqual(local.draft.results, [], "Prescribed sets are not entered actuals.");
    const first: WorkoutSetResult = {
      exerciseId: run.snapshot.exercises[0].id,
      setId: run.snapshot.exercises[0].sets[0].id,
      status: "completed",
      reps: 6,
      durationSeconds: null,
      distanceMeters: null,
      weight: null,
      unit: "kg",
    };
    const second: WorkoutSetResult = {
      ...first,
      setId: run.snapshot.exercises[0].sets[1].id,
      reps: 7,
      weight: 12.5,
    };
    local = edit(
      local,
      { results: [first, second], note: "Two entered sets", finish: false },
      runTime + 1000,
    );
    local = restore(prepareUpload(local, randomUUID()), owner, runTime + 1000);
    const firstRequest = structuredClone(request(local));

    // The API commits, but the device never receives its response.
    const committed = await plans.updateRun(sql, owner, run.id, firstRequest, runTime + 2000);
    assert.equal(committed.revision, 2);
    assert.equal(committed.finishedAt, null);
    const timed: WorkoutSetResult = {
      exerciseId: run.snapshot.exercises[1].id,
      setId: run.snapshot.exercises[1].sets[0].id,
      status: "completed",
      reps: null,
      durationSeconds: 22.5,
      distanceMeters: null,
      weight: null,
      unit: "bodyweight",
    };
    const corrected = { ...first, reps: 8 };
    local = edit(
      local,
      {
        results: [corrected, second, timed],
        note: "Corrected and explicitly finished with one untouched set",
        finish: true,
      },
      runTime + 3000,
    );
    local = restore(prepareUpload(local, randomUUID()), owner, runTime + 3000);
    assert.deepEqual(
      request(local),
      firstRequest,
      "New edits cannot alter a request whose acknowledgment was lost.",
    );
    const replay = await plans.updateRun(sql, owner, run.id, request(local), runTime + 4000);
    assert.deepEqual(replay, committed);
    local = acknowledgeUpload(local, firstRequest.mutationId, replay);
    assert.equal(local.base.revision, 2);
    assert.deepEqual(local.draft.results, [corrected, second, timed]);
    assert.equal(local.draft.finish, true);
    assert.equal(hasPendingRun(local), true);

    local = prepareUpload(local, randomUUID());
    const nextRequest = request(local);
    assert.notEqual(nextRequest.mutationId, firstRequest.mutationId);
    assert.equal(nextRequest.expectedRevision, 2);
    const finished = await plans.updateRun(sql, owner, run.id, nextRequest, runTime + 5000);
    local = acknowledgeUpload(local, nextRequest.mutationId, finished);
    assert.equal(hasPendingRun(local), false);
    assert.equal(finished.status, "completed");
    assert.equal(finished.finishedAt, new Date(runTime + 5000).toISOString());
    assert.equal(finished.revision, 3);
    assert.deepEqual(finished.results, [corrected, second, timed]);
    assert.equal(finished.results[0].weight, null, "Unknown load does not become the target load.");
    assert.equal(
      finished.results.some((result) => result.setId === run.snapshot.exercises[1].sets[1].id),
      false,
    );
    assert.equal(finished.shareAccountability, false);
    assert.deepEqual((await plans.listRuns(sql, owner)).runs, [finished]);
    assert.deepEqual(await plans.getRun(sql, owner, run.id), finished);
    assert.deepEqual(
      await plans.updateRun(sql, owner, run.id, nextRequest, runTime + 6000),
      finished,
    );
  });

  it("requires conflict review after another device revokes sharing and preserves that revocation when local actuals are chosen", async () => {
    const host = await fixtureMember(sql),
      buddy = await fixtureMember(sql);
    const plan = await plans.createPlan(sql, host, fixturePlan(), testNow);
    const session = await fixtureSession(sql, host);
    await plans.attachSessionPlan(
      sql,
      host,
      session.id,
      {
        planId: plan.id,
        expectedPlanRevision: plan.revision,
      },
      testNow,
    );
    const booking = await bookSeat(sql, buddy, session.id, {}, testNow);
    const started = await plans.startRun(
      sql,
      buddy,
      {
        id: randomUUID(),
        sessionId: session.id,
        expectedPlanId: plan.id,
        expectedPlanRevision: plan.revision,
      },
      runTime,
    );
    const actual: WorkoutSetResult = {
      exerciseId: started.snapshot.exercises[0].id,
      setId: started.snapshot.exercises[0].sets[0].id,
      status: "completed",
      reps: null,
      durationSeconds: 25,
      distanceMeters: 41.5,
      weight: null,
      unit: "bodyweight",
    };
    const shared = await plans.updateRun(
      sql,
      buddy,
      started.id,
      {
        expectedRevision: started.revision,
        results: [actual],
        note: "Explicitly shared counts",
        shareAccountability: true,
        finish: false,
      },
      runTime + 1000,
    );
    let local = newOfflineRun(shared, runTime + 1000);
    const offlineActual = { ...actual, durationSeconds: 31, distanceMeters: 46.5 };
    local = edit(
      local,
      { results: [offlineActual], note: "Local result correction", finish: false },
      runTime + 2000,
    );
    local = prepareUpload(local, randomUUID());
    const pendingRequest = structuredClone(request(local));
    const lostAcknowledgment = await plans.updateRun(
      sql,
      buddy,
      started.id,
      pendingRequest,
      runTime + 3000,
    );
    const fromOtherDevice = await plans.updateRun(
      sql,
      buddy,
      started.id,
      {
        expectedRevision: lostAcknowledgment.revision,
        mutationId: randomUUID(),
        results: [{ ...actual, durationSeconds: 44 }],
        note: "Other device made this private and finished it",
        shareAccountability: false,
        finish: true,
      },
      runTime + 4000,
    );
    assert.deepEqual((await plans.getSessionPlan(sql, host, session.id)).accountability, []);

    await assert.rejects(
      plans.updateRun(sql, buddy, started.id, request(local), runTime + 5000),
      (error: unknown) => error instanceof PaceError && error.status === 409,
    );
    assert.deepEqual(await plans.getRun(sql, buddy, started.id), fromOtherDevice);
    local = { ...local, conflict: await plans.getRun(sql, buddy, started.id) };
    assert.deepEqual(
      prepareUpload(local, randomUUID()).pending,
      local.pending,
      "A conflict cannot silently overwrite the latest server version.",
    );
    local = resolveRunConflict(local, "local", runTime + 6000);
    assert.equal(local.base.shareAccountability, false);
    assert.equal(
      local.draft.finish,
      true,
      "A saved finish remains finished during reconciliation.",
    );
    assert.deepEqual(local.draft.results, [offlineActual]);
    local = prepareUpload(local, randomUUID());
    const reviewedRequest = request(local);
    assert.notEqual(reviewedRequest.mutationId, pendingRequest.mutationId);
    assert.equal(reviewedRequest.expectedRevision, fromOtherDevice.revision);
    assert.equal(
      reviewedRequest.shareAccountability,
      false,
      "Choosing local actuals cannot restore revoked sharing.",
    );
    const saved = await plans.updateRun(sql, buddy, started.id, reviewedRequest, runTime + 7000);
    local = acknowledgeUpload(local, reviewedRequest.mutationId, saved);
    assert.equal(hasPendingRun(local), false);
    assert.deepEqual(saved.results, [offlineActual]);
    assert.equal(saved.finishedAt, fromOtherDevice.finishedAt);
    assert.equal(saved.results.length, 1, "Two unrecorded prescribed intervals stay unrecorded.");
    assert.equal(saved.results[0].durationSeconds, 31);
    assert.notEqual(
      saved.results[0].durationSeconds,
      saved.snapshot.exercises[0].sets[0].durationSeconds,
    );
    assert.deepEqual((await plans.getSessionPlan(sql, host, session.id)).accountability, []);
    assert.equal((await plans.listRuns(sql, buddy)).runs.length, 1);
    const [seat] =
      await sql`select participant_checked_in_at,status from bookings where id=${booking.id}`;
    assert.equal(seat.participant_checked_in_at, null);
    assert.equal(seat.status, "confirmed");
  });
});
