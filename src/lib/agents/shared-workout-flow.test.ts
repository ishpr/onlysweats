/** Composed acceptance: two real A2A clients, human booking, one frozen plan, private actuals. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { GetTaskRequest, SendMessageRequest, TaskState, type Task } from "@a2a-js/sdk";
import * as pace from "../pace/service.server.ts";
import * as safety from "../pace/safety.server.ts";
import * as plans from "../workout-plans/service.server.ts";
import { completedSet, fixturePlan } from "../workout-plans/fixtures.ts";
import * as agents from "./service.server.ts";
import * as assistant from "./assistant.server.ts";
import { HOUR, makeDb, pair, proposal, rpc, sdkClient } from "./test-helpers.ts";

const rejectsStatus = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (error: unknown) => error instanceof pace.PaceError && error.status === status,
  );
const send = (roomId: string, messageId: string, command: unknown) =>
  SendMessageRequest.fromJSON({
    message: {
      taskId: roomId,
      contextId: roomId,
      messageId,
      role: "ROLE_USER",
      parts: [{ data: command, mediaType: "application/json" }],
    },
  });
const asTask = (value: unknown): Task => {
  assert.ok(value && typeof value === "object" && "status" in value);
  return value as Task;
};

test("two delegated planners reach one human-approved booking and separate revocable workout records", async () => {
  // Entire database, identities, proposal, location check-ins and workout values are synthetic.
  // The official SDK talks only to the in-process A2A adapter; no push worker or provider runs.
  const sql = await makeDb();
  const f = await pair(sql, false);
  const first = await sdkClient(sql, f.hostGrant.token, f.now);
  const second = await sdkClient(sql, f.memberGrant.token, f.now);
  const room = GetTaskRequest.fromJSON({ id: f.room.id });
  const initial = proposal(f.now);
  initial.plan.durationMin = 60;
  const preferences = {
    enabled: true,
    activity: "run" as const,
    ability: initial.plan.ability,
    durationMin: 60,
    venueIds: ["katy"],
    availability: [
      {
        startAt: new Date(f.now + 24 * HOUR).toISOString(),
        endAt: new Date(f.now + 26 * HOUR).toISOString(),
      },
    ],
    approvedIntent: "Synthetic private planning preference",
  };
  for (const member of [f.host, f.member])
    await assistant.setPreferences(sql, member, preferences, f.now);
  await assert.rejects(first.sendMessage(send(f.room.id, "before-consent", initial)));
  assert.equal((await agents.getNegotiation(sql, f.host, f.room.id)).revision, 0);
  await agents.consentToNegotiation(sql, f.member, f.room.id, true, f.now);

  const proposed = asTask(await first.sendMessage(send(f.room.id, "initial", initial)));
  assert.equal(proposed.metadata?.revision, 1);
  assert.equal(
    asTask(await first.sendMessage(send(f.room.id, "initial", initial))).metadata?.revision,
    1,
  );
  await agents.confirmProposal(sql, f.host, f.room.id, 1, f.now);
  const counter = {
    ...initial,
    expectedRevision: 1,
    plan: { ...initial.plan, title: "Synthetic agreed intervals" },
  };
  assert.equal(
    asTask(await second.sendMessage(send(f.room.id, "counter", counter))).metadata?.revision,
    2,
  );
  await assert.rejects(first.sendMessage(send(f.room.id, "stale", initial)));
  await rejectsStatus(agents.confirmProposal(sql, f.host, f.room.id, 1, f.now), 409);
  assert.deepEqual((await agents.getNegotiation(sql, f.host, f.room.id)).confirmations, []);
  for (const member of [f.host, f.member])
    await agents.confirmProposal(sql, member, f.room.id, 2, f.now);
  const approved = await second.getTask(room);
  assert.equal(approved.status?.state, TaskState.TASK_STATE_COMPLETED);
  assert.equal(approved.metadata?.booked, false);

  // Removing a delegate stops its authority, not the member's ability to review or book.
  await agents.revokeDelegation(sql, f.host, f.hostGrant.id, f.now);
  assert.equal(
    (await rpc(sql, f.hostGrant.token, f.now, "GetTask", { id: f.room.id })).status,
    401,
  );
  const forbidden = await rpc(sql, f.memberGrant.token, f.now, "BookWorkout", { id: f.room.id });
  assert.ok((await forbidden.json()).error);
  const before = await sql`select (select count(*) from sessions) sessions,
    (select count(*) from bookings) bookings, (select count(*) from ledger_events) ledger`;
  const staleTerms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
  const staleApproval = { revision: 2, termsHash: staleTerms.termsHash };
  assert.equal(
    (await assistant.approveBookingTerms(sql, f.host, f.room.id, staleApproval, f.now)).booked,
    false,
  );
  await assistant.setPreferences(
    sql,
    f.member,
    { ...preferences, approvedIntent: "Updated synthetic preference" },
    f.now,
  );
  await rejectsStatus(
    assistant.approveBookingTerms(sql, f.member, f.room.id, staleApproval, f.now),
    409,
  );
  const freshReview = await assistant.getBookingTerms(sql, f.member, f.room.id, f.now);
  assert.notEqual(freshReview.terms.termsHash, staleTerms.termsHash);
  assert.deepEqual(freshReview.approvedIds, []);
  const approval = { revision: 2, termsHash: freshReview.terms.termsHash };
  assert.equal(
    (await assistant.approveBookingTerms(sql, f.member, f.room.id, approval, f.now)).booked,
    false,
  );
  const booked = await assistant.approveBookingTerms(sql, f.host, f.room.id, approval, f.now);
  assert.equal(booked.booked, true);
  assert.ok(booked.sessionId && booked.bookingId);
  assert.deepEqual(
    await assistant.approveBookingTerms(sql, f.member, f.room.id, approval, f.now),
    booked,
  );
  const after = await sql`select (select count(*) from sessions) sessions,
    (select count(*) from bookings) bookings, (select count(*) from ledger_events) ledger`;
  assert.equal(Number(after[0].sessions), Number(before[0].sessions) + 1);
  assert.equal(Number(after[0].bookings), Number(before[0].bookings) + 1);
  assert.equal(Number(after[0].ledger), Number(before[0].ledger));
  assert.equal((await pace.getBooking(sql, f.member, booked.bookingId, f.now)).status, "confirmed");

  const input = fixturePlan();
  const plan = await plans.createPlan(sql, f.host, input, f.now);
  const attachment = { planId: plan.id, expectedPlanRevision: plan.revision };
  await rejectsStatus(plans.getPlan(sql, f.member, plan.id), 404);
  await rejectsStatus(
    plans.attachSessionPlan(sql, f.member, booked.sessionId, attachment, f.now),
    403,
  );
  await plans.attachSessionPlan(sql, f.host, booked.sessionId, attachment, f.now);
  const reviewed = await plans.getSessionPlan(sql, f.member, booked.sessionId, f.now);
  assert.ok(reviewed.plan);
  assert.equal(reviewed.canAttach, false);
  assert.deepEqual(
    (await plans.attachSessionPlan(sql, f.host, booked.sessionId, attachment, f.now)).plan,
    reviewed.plan,
  );
  const { id: _id, ...content } = input;
  await plans.updatePlan(
    sql,
    f.host,
    plan.id,
    {
      ...content,
      title: "Changed private library copy",
      expectedRevision: 1,
    },
    f.now,
  );
  await rejectsStatus(
    plans.attachSessionPlan(
      sql,
      f.host,
      booked.sessionId,
      { ...attachment, expectedPlanRevision: 2 },
      f.now,
    ),
    409,
  );
  assert.deepEqual(
    (await plans.getSessionPlan(sql, f.member, booked.sessionId, f.now)).plan,
    reviewed.plan,
  );

  const runTime = new Date(counter.plan.startAt).getTime() - 10 * 60_000;
  const start = {
    id: randomUUID(),
    sessionId: booked.sessionId,
    expectedPlanId: plan.id,
    expectedPlanRevision: reviewed.plan.planRevision,
  };
  await rejectsStatus(
    plans.startRun(sql, f.member, { ...start, expectedPlanRevision: 2 }, runTime),
    409,
  );
  let hostRun = await plans.startRun(sql, f.host, start, runTime);
  let memberRun = await plans.startRun(sql, f.member, { ...start, id: randomUUID() }, runTime);
  assert.notEqual(hostRun.id, memberRun.id);
  assert.deepEqual(hostRun.snapshot, memberRun.snapshot);
  assert.deepEqual(hostRun.snapshot, reviewed.plan.snapshot);
  assert.deepEqual(hostRun.results, []);
  assert.deepEqual(memberRun.results, []);
  assert.deepEqual(await plans.startRun(sql, f.host, start, runTime + 1), hostRun);
  await rejectsStatus(plans.getRun(sql, f.member, hostRun.id), 404);
  await rejectsStatus(plans.getRun(sql, f.host, memberRun.id), 404);

  const hostWrite = {
    expectedRevision: hostRun.revision,
    mutationId: randomUUID(),
    results: [{ ...completedSet(hostRun), durationSeconds: 45 }],
    note: "Host private actuals",
    shareAccountability: true,
    finish: false,
  };
  hostRun = await plans.updateRun(sql, f.host, hostRun.id, hostWrite, runTime + 60_000);
  assert.deepEqual(
    await plans.updateRun(sql, f.host, hostRun.id, hostWrite, runTime + 61_000),
    hostRun,
  );
  await rejectsStatus(plans.updateRun(sql, f.member, hostRun.id, hostWrite, runTime + 61_000), 404);
  memberRun = await plans.updateRun(
    sql,
    f.member,
    memberRun.id,
    {
      expectedRevision: memberRun.revision,
      mutationId: randomUUID(),
      results: [{ ...completedSet(memberRun), durationSeconds: 37 }],
      note: "Buddy private actuals",
      shareAccountability: false,
      finish: false,
    },
    runTime + 62_000,
  );
  assert.equal((await plans.getRun(sql, f.host, hostRun.id)).results[0].durationSeconds, 45);
  assert.equal((await plans.getRun(sql, f.member, memberRun.id)).results[0].durationSeconds, 37);
  assert.equal(memberRun.snapshot.exercises[0].sets[0].durationSeconds, 60);
  const buddyView = await plans.getSessionPlan(sql, f.member, booked.sessionId, runTime + 62_000);
  assert.equal(buddyView.myRun?.id, memberRun.id);
  assert.deepEqual(
    buddyView.accountability.map((entry) => entry.userId),
    [f.host],
  );
  assert.equal(buddyView.accountability[0].completedSets, 1);
  assert.equal("results" in buddyView.accountability[0], false);
  assert.equal("note" in buddyView.accountability[0], false);
  const taskAfterRecording = await second.getTask(room);
  const delegatedData = JSON.stringify(taskAfterRecording);
  assert.equal(taskAfterRecording.metadata?.booked, true);
  for (const privateText of [
    "Host private actuals",
    "Buddy private actuals",
    plan.title,
    "durationSeconds",
    "heartRate",
  ])
    assert.equal(delegatedData.includes(privateText), false);

  hostRun = await plans.updateRun(
    sql,
    f.host,
    hostRun.id,
    {
      expectedRevision: hostRun.revision,
      mutationId: randomUUID(),
      results: hostRun.results,
      note: hostRun.note,
      shareAccountability: false,
      finish: true,
    },
    runTime + 63_000,
  );
  assert.deepEqual(
    (await plans.getSessionPlan(sql, f.member, booked.sessionId, runTime + 63_000)).accountability,
    [],
  );
  await rejectsStatus(plans.updateRun(sql, f.host, hostRun.id, hostWrite, runTime + 64_000), 409);
  const receipt = await agents.consentToNegotiation(
    sql,
    f.member,
    f.room.id,
    false,
    runTime + 64_000,
  );
  assert.equal(receipt.state, "cancelled");
  await assert.rejects(second.getTask(room));
  assert.equal(
    (await pace.getBooking(sql, f.member, booked.bookingId, runTime + 64_000)).status,
    "confirmed",
  );
  assert.equal(
    (await plans.getSessionPlan(sql, f.member, booked.sessionId, runTime + 64_000)).plan?.planId,
    plan.id,
  );
  await safety.blockMember(sql, f.member, f.host, runTime + 65_000);
  await rejectsStatus(plans.getSessionPlan(sql, f.member, booked.sessionId, runTime + 65_000), 404);
  assert.equal((await plans.getRun(sql, f.member, memberRun.id)).note, "Buddy private actuals");
  assert.equal((await plans.getRun(sql, f.host, hostRun.id)).note, "Host private actuals");

  const [attendance] =
    await sql`select host_checked_in_at, participant_checked_in_at from bookings where id = ${booked.bookingId}`;
  assert.equal(attendance.host_checked_in_at, null);
  assert.equal(attendance.participant_checked_in_at, null);
});
