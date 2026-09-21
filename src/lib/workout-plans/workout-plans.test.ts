import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { bookSeat, cancelBooking, cancelSession, PaceError } from "../pace/service.server.ts";
import { blockMember, deleteAccount } from "../pace/safety.server.ts";
import * as plans from "./service.server.ts";
import { createPlanInput, updateRunInput } from "./contracts.ts";
import { exportFitness } from "../fitness/service.server.ts";
import {
  fixtureMember,
  fixturePlan,
  fixtureSession,
  completedSet,
  runTime,
  testNow as now,
} from "./fixtures.ts";
let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (error: unknown) => error instanceof PaceError && error.status === status,
  );
async function setup(booked = true) {
  const host = await fixtureMember(sql),
    buddy = await fixtureMember(sql),
    visitor = await fixtureMember(sql);
  const input = fixturePlan(),
    plan = await plans.createPlan(sql, host, input, now);
  const session = await fixtureSession(sql, host);
  await plans.attachSessionPlan(
    sql,
    host,
    session.id,
    { planId: plan.id, expectedPlanRevision: 1 },
    now,
  );
  const booking = booked ? await bookSeat(sql, buddy, session.id, {}, now) : null;
  return { host, buddy, visitor, plan, input, session, booking };
}

describe("private prescribed workout library", () => {
  it("isolates owners, retries identical creation, and rejects conflicting IDs or stale edits", async () => {
    const owner = await fixtureMember(sql),
      other = await fixtureMember(sql),
      input = fixturePlan();
    const saved = await plans.createPlan(sql, owner, input, now);
    assert.deepEqual(await plans.createPlan(sql, owner, input, now + 1), saved);
    await rejects(plans.createPlan(sql, owner, { ...input, title: "Changed" }, now), 409);
    await rejects(plans.getPlan(sql, other, saved.id), 404);
    await rejects(plans.deletePlan(sql, other, saved.id), 404);
    assert.equal((await plans.listPlans(sql, other)).plans.length, 0);
    const { id: _id, ...content } = input;
    const edited = await plans.updatePlan(
      sql,
      owner,
      saved.id,
      { ...content, title: "Edited", expectedRevision: 1 },
      now + 1,
    );
    assert.equal(edited.revision, 2);
    await rejects(plans.updatePlan(sql, owner, saved.id, { ...content, expectedRevision: 1 }), 409);
  });
  it("rejects unknown fields, missing targets, duplicate IDs, nonfinite values, units and unbounded sets", () => {
    const input = fixturePlan(),
      exercise = input.exercises[0],
      set = exercise.sets[0];
    for (const patch of [
      { measuredCalories: 100 },
      { title: "" },
      { exercises: [{ ...exercise, sets: [{ ...set, durationSeconds: null }] }] },
      { exercises: [{ ...exercise, sets: [set, set] }] },
      { exercises: [{ ...exercise, sets: [{ ...set, durationSeconds: Infinity }] }] },
      { exercises: [{ ...exercise, sets: [{ ...set, weight: 50 }] }] },
      { exercises: Array.from({ length: 13 }, () => ({ ...exercise, id: randomUUID() })) },
    ])
      assert.equal(createPlanInput.safeParse({ ...input, ...patch }).success, false);
    const many = Array.from({ length: 7 }, () => ({
      ...exercise,
      id: randomUUID(),
      sets: Array.from({ length: 20 }, () => ({ ...set, id: randomUUID() })),
    }));
    assert.equal(createPlanInput.safeParse({ ...input, exercises: many }).success, false);
  });
  it("paginates without gaps for equal creation times and rejects malformed cursors", async () => {
    const owner = await fixtureMember(sql);
    for (let i = 0; i < 5; i++) await plans.createPlan(sql, owner, fixturePlan(), now);
    const first = await plans.listPlans(sql, owner, { limit: 2 });
    const second = await plans.listPlans(sql, owner, { limit: 2, cursor: first.nextCursor! });
    const third = await plans.listPlans(sql, owner, { limit: 2, cursor: second.nextCursor! });
    assert.equal(
      new Set([...first.plans, ...second.plans, ...third.plans].map((p) => p.id)).size,
      5,
    );
    assert.equal(third.nextCursor, null);
    await rejects(plans.listPlans(sql, owner, { cursor: "bad" }), 400);
  });
});

describe("explicit shared session prescriptions", () => {
  it("shares only with booked members and freezes the snapshot despite library edits/deletion", async () => {
    const { host, buddy, visitor, plan, input, session } = await setup();
    await rejects(plans.getSessionPlan(sql, visitor, session.id, now), 404);
    await rejects(
      plans.attachSessionPlan(
        sql,
        buddy,
        session.id,
        { planId: plan.id, expectedPlanRevision: 1 },
        now,
      ),
      403,
    );
    const { id: _id, ...content } = input;
    await plans.updatePlan(
      sql,
      host,
      plan.id,
      { ...content, title: "Later version", expectedRevision: 1 },
      now,
    );
    const view = await plans.getSessionPlan(sql, buddy, session.id, now);
    assert.equal(view.plan?.snapshot.title, input.title);
    assert.equal(view.canAttach, false);
    await rejects(
      plans.attachSessionPlan(
        sql,
        host,
        session.id,
        { planId: plan.id, expectedPlanRevision: 2 },
        now,
      ),
      409,
    );
    await rejects(
      plans.removeSessionPlan(
        sql,
        host,
        session.id,
        { expectedPlanId: plan.id, expectedPlanRevision: 1 },
        now,
      ),
      409,
    );
    const copied = await plans.copySessionPlan(
      sql,
      buddy,
      session.id,
      { id: randomUUID(), expectedPlanId: plan.id, expectedPlanRevision: 1 },
      now,
    );
    await plans.deletePlan(sql, host, plan.id);
    assert.equal(
      (await plans.getSessionPlan(sql, buddy, session.id, now)).plan?.snapshot.title,
      input.title,
    );
    assert.equal((await plans.getPlan(sql, buddy, copied.id)).title, input.title);
  });
  it("rejects stale snapshot removal and copying even if another plan has the same revision", async () => {
    const { host, plan, session } = await setup(false);
    await rejects(
      plans.removeSessionPlan(
        sql,
        host,
        session.id,
        { expectedPlanId: randomUUID(), expectedPlanRevision: 1 },
        now,
      ),
      409,
    );
    await rejects(
      plans.copySessionPlan(
        sql,
        host,
        session.id,
        { id: randomUUID(), expectedPlanId: randomUUID(), expectedPlanRevision: 1 },
        now,
      ),
      409,
    );
    await plans.removeSessionPlan(
      sql,
      host,
      session.id,
      { expectedPlanId: plan.id, expectedPlanRevision: 1 },
      now,
    );
    assert.equal((await plans.getSessionPlan(sql, host, session.id, now)).plan, null);
  });
  it("revokes shared access when a buddy leaves or either side blocks", async () => {
    const { host, buddy, session, booking } = await setup();
    const run = await plans.startRun(
      sql,
      buddy,
      { id: randomUUID(), sessionId: session.id },
      runTime,
    );
    await cancelBooking(sql, buddy, booking!.id, now + 1000);
    await rejects(plans.getSessionPlan(sql, buddy, session.id, now), 404);
    assert.equal((await plans.getRun(sql, buddy, run.id)).id, run.id);
    const other = await setup();
    await blockMember(sql, other.buddy, other.host, now);
    await rejects(plans.getSessionPlan(sql, other.buddy, other.session.id, now), 404);
    assert.ok(host);
  });
  it("prevents initial attachment once a booking exists and prevents starting early or after cancellation", async () => {
    const host = await fixtureMember(sql),
      buddy = await fixtureMember(sql);
    const plan = await plans.createPlan(sql, host, fixturePlan(), now),
      session = await fixtureSession(sql, host);
    await bookSeat(sql, buddy, session.id, {}, now);
    await rejects(
      plans.attachSessionPlan(
        sql,
        host,
        session.id,
        { planId: plan.id, expectedPlanRevision: 1 },
        now,
      ),
      409,
    );
    const other = await setup(false);
    await rejects(
      plans.startRun(sql, other.host, { id: randomUUID(), sessionId: other.session.id }, now),
      409,
    );
    await cancelSession(sql, other.host, other.session.id, now);
    await rejects(
      plans.startRun(sql, other.host, { id: randomUUID(), sessionId: other.session.id }, runTime),
      409,
    );
  });
});

describe("member-entered execution and opt-in accountability", () => {
  it("starts with no actuals, deduplicates retries, and refuses future proof, unknown sets and stale updates", async () => {
    const { buddy, host, session } = await setup();
    const input = { id: randomUUID(), sessionId: session.id };
    const run = await plans.startRun(sql, buddy, input, runTime);
    assert.deepEqual(run.results, []);
    assert.equal(run.shareAccountability, false);
    assert.deepEqual(await plans.startRun(sql, buddy, input, runTime + 1), run);
    await rejects(
      plans.startRun(sql, buddy, { id: randomUUID(), sessionId: session.id }, runTime),
      409,
    );
    await rejects(plans.getRun(sql, host, run.id), 404);
    const args = {
      expectedRevision: 1,
      results: [completedSet(run)],
      note: "Private note",
      shareAccountability: false,
      finish: false,
    };
    await rejects(
      plans.updateRun(
        sql,
        buddy,
        run.id,
        { ...args, results: [{ ...completedSet(run), setId: randomUUID() }] },
        runTime,
      ),
      400,
    );
    await rejects(plans.updateRun(sql, buddy, run.id, args, runTime - 1), 400);
    await assert.rejects(
      plans.updateRun(sql, buddy, run.id, { ...args, finish: true, results: [] }, runTime),
      z.ZodError,
    );
    assert.equal(
      updateRunInput.safeParse({
        ...args,
        results: [{ ...completedSet(run), durationSeconds: null }],
      }).success,
      false,
    );
    assert.equal(
      updateRunInput.safeParse({ ...args, results: [{ ...completedSet(run), status: "skipped" }] })
        .success,
      false,
    );
    const edited = await plans.updateRun(sql, buddy, run.id, args, runTime + 1);
    assert.equal(edited.results[0].durationSeconds, 52);
    assert.equal(edited.snapshot.exercises[0].sets[0].durationSeconds, 60);
    await rejects(plans.updateRun(sql, buddy, run.id, args, runTime + 2), 409);
  });
  it("shares only chosen summary counts, immediately withdraws sharing, and does not award attendance", async () => {
    const { host, buddy, session, booking } = await setup();
    const run = await plans.startRun(
      sql,
      buddy,
      { id: randomUUID(), sessionId: session.id },
      runTime,
    );
    const args = {
      expectedRevision: 1,
      results: [completedSet(run)],
      note: "Private effort details",
      shareAccountability: false,
      finish: true,
    };
    let saved = await plans.updateRun(sql, buddy, run.id, args, runTime + 1000);
    assert.deepEqual((await plans.getSessionPlan(sql, host, session.id)).accountability, []);
    saved = await plans.updateRun(
      sql,
      buddy,
      run.id,
      { ...args, expectedRevision: saved.revision, shareAccountability: true },
      runTime + 2000,
    );
    const shared = (await plans.getSessionPlan(sql, host, session.id)).accountability;
    assert.equal(shared.length, 1);
    assert.equal(shared[0].completedSets, 1);
    assert.equal(shared[0].plannedSets, 3);
    assert.equal(shared[0].status, "completed");
    assert.equal(JSON.stringify(shared).includes("Private effort"), false);
    assert.equal("results" in shared[0], false);
    assert.equal("durationSeconds" in shared[0], false);
    const [seat] = await sql<{
      participant_checked_in_at: Date | null;
      status: string;
    }>`select participant_checked_in_at,status from bookings where id = ${booking!.id}`;
    assert.equal(seat.participant_checked_in_at, null);
    assert.equal(seat.status, "confirmed");
    await plans.updateRun(
      sql,
      buddy,
      run.id,
      { ...args, expectedRevision: saved.revision },
      runTime + 3000,
    );
    assert.deepEqual((await plans.getSessionPlan(sql, host, session.id)).accountability, []);
  });
  it("corrects completed private records after leaving and removes own records even after blocking", async () => {
    const { buddy, host, session } = await setup();
    let run = await plans.startRun(
      sql,
      buddy,
      { id: randomUUID(), sessionId: session.id },
      runTime,
    );
    run = await plans.updateRun(
      sql,
      buddy,
      run.id,
      {
        expectedRevision: 1,
        results: [completedSet(run)],
        note: "",
        shareAccountability: true,
        finish: true,
      },
      runTime,
    );
    await blockMember(sql, buddy, host, runTime + 1);
    run = await plans.updateRun(
      sql,
      buddy,
      run.id,
      {
        expectedRevision: run.revision,
        results: [completedSet(run)],
        note: "Corrected",
        shareAccountability: false,
        finish: true,
      },
      runTime + 2,
    );
    assert.equal(run.note, "Corrected");
    await plans.deleteRun(sql, buddy, run.id);
    await rejects(plans.getRun(sql, buddy, run.id), 404);
  });
  it("keeps suspended members' private data readable, exportable and removable while denying new writes", async () => {
    const owner = await fixtureMember(sql),
      input = fixturePlan();
    const plan = await plans.createPlan(sql, owner, input, now);
    const run = await plans.startRun(
      sql,
      owner,
      { id: randomUUID(), planId: plan.id, expectedPlanRevision: 1 },
      now,
    );
    await sql`update profiles set suspended_at = ${new Date(now)} where id = ${owner}`;
    assert.equal((await plans.getPlan(sql, owner, plan.id)).id, plan.id);
    assert.equal((await plans.getRun(sql, owner, run.id)).id, run.id);
    assert.equal((await plans.listPlans(sql, owner)).plans.length, 1);
    assert.equal((await plans.listRuns(sql, owner)).runs.length, 1);
    const exported = await exportFitness(sql, owner, { limit: 100 });
    assert.ok(
      exported.records.some(
        (record) => record.kind === "workout_plan" && record.value.id === plan.id,
      ),
    );
    assert.ok(
      exported.records.some(
        (record) => record.kind === "workout_run" && record.value.id === run.id,
      ),
    );
    await rejects(plans.createPlan(sql, owner, fixturePlan(), now), 403);
    await plans.deletePlan(sql, owner, plan.id);
    await plans.deleteRun(sql, owner, run.id);
    assert.equal((await plans.listRuns(sql, owner)).runs.length, 0);
  });
  it("preserves standalone snapshots and bounds active runs without manufacturing any sensor records", async () => {
    const owner = await fixtureMember(sql),
      input = fixturePlan();
    const plan = await plans.createPlan(sql, owner, input, now);
    const runs = [];
    for (let i = 0; i < 10; i++)
      runs.push(
        await plans.startRun(
          sql,
          owner,
          {
            id: randomUUID(),
            planId: plan.id,
            expectedPlanRevision: 1,
          },
          now + i,
        ),
      );
    await rejects(
      plans.startRun(
        sql,
        owner,
        { id: randomUUID(), planId: plan.id, expectedPlanRevision: 1 },
        now,
      ),
      409,
    );
    const page1 = await plans.listRuns(sql, owner, { limit: 6 });
    const page2 = await plans.listRuns(sql, owner, { limit: 6, cursor: page1.nextCursor! });
    assert.equal(new Set([...page1.runs, ...page2.runs].map((run) => run.id)).size, 10);
    await plans.deletePlan(sql, owner, plan.id);
    assert.equal((await plans.getRun(sql, owner, runs[0].id)).snapshot.title, plan.title);
    await rejects(
      plans.updateRun(
        sql,
        owner,
        runs[0].id,
        {
          expectedRevision: 1,
          results: [completedSet(runs[0])],
          note: "",
          shareAccountability: true,
          finish: true,
        },
        now,
      ),
      400,
    );
    assert.equal((await sql`select 1 from health_records where user_id = ${owner}`).length, 0);
    assert.equal(
      (await sql`select 1 from fitness_strength_logs where user_id = ${owner}`).length,
      0,
    );
  });
  it("keeps independent buddy copies and private results when author deletes account; deletes all of the owner's private data", async () => {
    const { host, buddy, plan, session } = await setup();
    const copied = await plans.copySessionPlan(
      sql,
      buddy,
      session.id,
      { id: randomUUID(), expectedPlanId: plan.id, expectedPlanRevision: 1 },
      now,
    );
    const run = await plans.startRun(
      sql,
      buddy,
      { id: randomUUID(), sessionId: session.id },
      runTime,
    );
    await deleteAccount(sql, host, now + 1);
    assert.equal((await sql`select 1 from workout_plans where user_id = ${host}`).length, 0);
    assert.equal(
      (await sql`select 1 from session_workout_plans where session_id = ${session.id}`).length,
      0,
    );
    assert.equal((await plans.getRun(sql, buddy, run.id)).snapshot.title, plan.title);
    assert.equal((await plans.getPlan(sql, buddy, copied.id)).title, plan.title);
    await deleteAccount(sql, buddy, now + 2);
    assert.equal((await sql`select 1 from workout_runs where user_id = ${buddy}`).length, 0);
    assert.equal((await sql`select 1 from workout_plans where user_id = ${buddy}`).length, 0);
  });
});
