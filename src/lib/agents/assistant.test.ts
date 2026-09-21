import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import * as pace from "../pace/service.server.ts";
import * as safety from "../pace/safety.server.ts";
import * as blocks from "../pace/training-blocks.server.ts";
import { clusterDate, nextOccurrence } from "../pace/rules.ts";
import * as agents from "./service.server.ts";
import * as assistant from "./assistant.server.ts";
import { makeDb, pair, proposal, HOUR, rpc } from "./test-helpers.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(promise, (err: unknown) => err instanceof pace.PaceError && err.status === status);
const preferences = (now: number) => ({
  enabled: true,
  activity: "run" as const,
  ability: proposal(now).plan.ability,
  durationMin: 60,
  venueIds: ["katy"],
  availability: [
    {
      startAt: new Date(now + 24 * HOUR).toISOString(),
      endAt: new Date(now + 26 * HOUR).toISOString(),
    },
  ],
  approvedIntent: "An easy run with my previous workout partner.",
});

async function ready() {
  const f = await pair(sql);
  await assistant.setPreferences(sql, f.host, preferences(f.now), f.now);
  await assistant.setPreferences(sql, f.member, preferences(f.now), f.now);
  await agents.proposeForMember(
    sql,
    f.host,
    f.room.id,
    { messageId: "first", expectedRevision: 0, plan: proposal(f.now).plan },
    f.now,
  );
  await agents.confirmProposal(sql, f.host, f.room.id, 1, f.now);
  await agents.confirmProposal(sql, f.member, f.room.id, 1, f.now);
  return f;
}

describe("member assistant planning and booking", () => {
  it("shares only explicitly enabled entered preferences and supports withdrawal after blocking or suspension", async () => {
    const f = await pair(sql);
    await assistant.setPreferences(sql, f.host, preferences(f.now), f.now);
    const shared = await assistant.sharedPreferences(sql, f.member, f.room.id);
    assert.deepEqual(
      shared.map((p) => p.memberId),
      [f.host],
    );
    assert.equal(shared[0].preferences.approvedIntent, preferences(f.now).approvedIntent);
    assert.deepEqual(
      await assistant.sharedPreferences(sql, f.member, f.room.id, f.now + 8 * 24 * HOUR),
      [],
    );
    await assistant.setPreferences(
      sql,
      f.host,
      { ...preferences(f.now), enabled: false },
      f.now + 3 * 24 * HOUR,
    );
    assert.deepEqual(await assistant.sharedPreferences(sql, f.member, f.room.id), []);
    await safety.blockMember(sql, f.host, f.member, f.now);
    await sql`update profiles set suspended_at = now() where id = ${f.member}`;
    const stopped = await assistant.setPreferences(
      sql,
      f.member,
      { ...preferences(f.now), enabled: false },
      f.now,
    );
    assert.equal(stopped.enabled, false);
    await rejects(assistant.setPreferences(sql, f.member, preferences(f.now), f.now), 404);
    const withdrawn = await agents.consentToNegotiation(sql, f.member, f.room.id, false, f.now);
    assert.equal(withdrawn.participant_consented, false);
    assert.equal(withdrawn.state, "cancelled");
    await agents.revokeDelegation(sql, f.member, f.memberGrant.id, f.now);
    assert.equal(await agents.authenticateDelegate(sql, f.memberGrant.token, f.now), null);
    await rejects(agents.consentToNegotiation(sql, f.member, f.room.id, true, f.now), 404);
    const other = await pair(sql);
    await sql`update profiles set suspended_at = now() where id = ${other.host}`;
    assert.equal(
      (await agents.cancelNegotiation(sql, other.host, other.room.id, false, other.now)).state,
      "cancelled",
    );
    await rejects(agents.cancelNegotiation(sql, "stranger", other.room.id, false, other.now), 404);
  });
  it("keeps preferences owner scoped, validates availability and rejects health fields", async () => {
    const f = await pair(sql);
    assert.equal((await assistant.getPreferences(sql, f.host)).enabled, false);
    const p = await assistant.setPreferences(sql, f.host, preferences(f.now), f.now);
    assert.equal(p.revision, 1);
    assert.equal((await assistant.getPreferences(sql, f.member)).revision, 0);
    await assert.rejects(
      assistant.setPreferences(sql, f.host, { ...preferences(f.now), heartRate: 75 }, f.now),
    );
    await rejects(
      assistant.setPreferences(
        sql,
        f.host,
        {
          ...preferences(f.now),
          availability: [
            { startAt: new Date(f.now - HOUR).toISOString(), endAt: new Date(f.now).toISOString() },
          ],
        },
        f.now,
      ),
      400,
    );
    await rejects(
      assistant.setPreferences(
        sql,
        f.host,
        { ...preferences(f.now), venueIds: ["private-home"] },
        f.now,
      ),
      400,
    );
    await rejects(assistant.getPreferences(sql, "stranger"), 404);
  });

  it("only enumerates bounded, mutually consented, available real candidates", async () => {
    const f = await pair(sql, false);
    await assistant.setPreferences(sql, f.host, preferences(f.now), f.now);
    await assistant.setPreferences(sql, f.member, preferences(f.now), f.now);
    await rejects(assistant.suggestPlans(sql, f.host, f.room.id, f.now), 404);
    await agents.consentToNegotiation(sql, f.member, f.room.id, true, f.now);
    const found = await assistant.suggestPlans(sql, f.host, f.room.id, f.now);
    assert.ok(found.candidates.length > 0 && found.candidates.length <= 5);
    assert.ok(
      found.candidates.every(
        (p) =>
          p.venueId === "katy" &&
          p.activity === "run" &&
          +new Date(p.startAt) >= f.now + 24 * HOUR &&
          +new Date(p.startAt) + p.durationMin * 60_000 <= f.now + 26 * HOUR,
      ),
    );
    assert.ok(!JSON.stringify(found).includes("heartRate"));
    await assistant.setPreferences(sql, f.member, { ...preferences(f.now), enabled: false }, f.now);
    assert.equal(
      (await assistant.suggestPlans(sql, f.host, f.room.id, f.now)).candidates.length,
      0,
    );
  });

  it("filters generated distances that cannot fit the duration at the fastest entered pace or speed", async () => {
    const f = await pair(sql);
    const run = { ...preferences(f.now), durationMin: 30 };
    for (const memberId of [f.host, f.member])
      await assistant.setPreferences(sql, memberId, run, f.now);
    const tooShortRun = await assistant.suggestPlans(sql, f.host, f.room.id, f.now);
    assert.deepEqual(tooShortRun.candidates, []);
    assert.match(tooShortRun.reason!, /Increase the workout length or choose a shorter distance/);

    // Keep a feasible entered alternative, without inventing a new distance.
    await assistant.setPreferences(
      sql,
      f.member,
      { ...run, ability: { ...run.ability, miles: 2 } },
      f.now,
    );
    const shorter = await assistant.suggestPlans(sql, f.host, f.room.id, f.now);
    assert.ok(shorter.candidates.length > 0);
    assert.ok(shorter.candidates.every((p) => p.ability.kind === "run" && p.ability.miles === 2));

    const exactRun = {
      ...run,
      ability: { ...run.ability, paceMinSec: 450, paceMaxSec: 480, miles: 4 },
    };
    for (const memberId of [f.host, f.member])
      await assistant.setPreferences(sql, memberId, exactRun, f.now);
    assert.ok((await assistant.suggestPlans(sql, f.host, f.room.id, f.now)).candidates.length > 0);

    const ride = {
      ...run,
      activity: "ride",
      ability: { kind: "ride", mphMin: 15, mphMax: 20, miles: 20, surface: "road" },
    };
    for (const memberId of [f.host, f.member])
      await assistant.setPreferences(sql, memberId, ride, f.now);
    const tooShortRide = await assistant.suggestPlans(sql, f.host, f.room.id, f.now);
    assert.deepEqual(tooShortRide.candidates, []);
    assert.match(tooShortRide.reason!, /fastest selected pace or speed/);
    for (const memberId of [f.host, f.member])
      await assistant.setPreferences(sql, memberId, { ...ride, durationMin: 60 }, f.now);
    assert.ok((await assistant.suggestPlans(sql, f.host, f.room.id, f.now)).candidates.length > 0);
  });

  it("requires two separate plan and fee approvals then creates exactly one normal booking", async () => {
    const f = await ready();
    const base =
      await sql`select (select count(*) from sessions) sessions, (select count(*) from bookings) bookings,
      (select count(*) from ledger_events) ledger`;
    const terms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
    assert.equal(terms.chargeNowCents, 0);
    assert.equal(terms.paymentCollectionEnabled, false);
    assert.equal(terms.lateCancelFeeCents, 500);
    assert.equal(terms.noShowFeeCents, 1000);
    const body = { revision: 1, termsHash: terms.termsHash };
    const first = await assistant.approveBookingTerms(sql, f.host, f.room.id, body, f.now);
    assert.equal(first.booked, false);
    assert.deepEqual(first.approvedIds, [f.host]);
    const results = await Promise.all([
      assistant.approveBookingTerms(sql, f.member, f.room.id, body, f.now),
      assistant.approveBookingTerms(sql, f.member, f.room.id, body, f.now),
      assistant.approveBookingTerms(sql, f.host, f.room.id, body, f.now),
    ]);
    assert.ok(results.every((r) => r.booked && r.bookingId === results[0].bookingId));
    const booking = await pace.getBooking(sql, f.member, results[0].bookingId!, f.now);
    assert.equal(booking.status, "confirmed");
    const [session] =
      await sql`select host_id, visibility, capacity from sessions where id = ${results[0].sessionId}`;
    assert.deepEqual(session, { host_id: f.host, visibility: "unlisted", capacity: 2 });
    const [after] =
      await sql`select (select count(*) from sessions) sessions, (select count(*) from bookings) bookings,
      (select count(*) from ledger_events) ledger`;
    assert.equal(Number(after.sessions), Number(base[0].sessions) + 1);
    assert.equal(Number(after.bookings), Number(base[0].bookings) + 1);
    assert.equal(Number(after.ledger), Number(base[0].ledger));
    assert.equal(
      (await assistant.getHistory(sql, f.host, f.room.id)).filter((e) => e.kind === "booked")
        .length,
      1,
    );
    assert.equal(agents.view(await agents.getNegotiation(sql, f.host, f.room.id)).booked, true);
    const task = await rpc(sql, f.hostGrant.token, f.now, "GetTask", { id: f.room.id });
    const wire = await task.json();
    assert.equal(wire.result.metadata.booked, true);
  });

  it("does not allow delegated booking methods or stale revisions and terms", async () => {
    const f = await ready();
    const terms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
    const body = { revision: 1, termsHash: terms.termsHash };
    const forbidden = await rpc(sql, f.hostGrant.token, f.now, "BookWorkout", {
      id: f.room.id,
      ...body,
    });
    assert.ok((await forbidden.json()).error);
    await rejects(assistant.approveBookingTerms(sql, "stranger", f.room.id, body, f.now), 404);
    await rejects(
      assistant.approveBookingTerms(sql, f.host, f.room.id, { ...body, revision: 2 }, f.now),
      409,
    );
    await rejects(
      assistant.approveBookingTerms(
        sql,
        f.host,
        f.room.id,
        { ...body, termsHash: "0".repeat(64) },
        f.now,
      ),
      409,
    );
    const before = await assistant.approveBookingTerms(sql, f.host, f.room.id, body, f.now);
    assert.deepEqual(before.approvedIds, [f.host]);
    await assistant.setPreferences(
      sql,
      f.member,
      { ...preferences(f.now), approvedIntent: "A revised preference." },
      f.now,
    );
    await rejects(assistant.approveBookingTerms(sql, f.member, f.room.id, body, f.now), 409);
    const next = await assistant.getBookingTerms(sql, f.member, f.room.id, f.now);
    assert.notEqual(next.terms.termsHash, body.termsHash);
    assert.deepEqual(next.approvedIds, []);
    const one = await assistant.approveBookingTerms(
      sql,
      f.member,
      f.room.id,
      { revision: 1, termsHash: next.terms.termsHash },
      f.now,
    );
    assert.equal(one.booked, false);
    assert.deepEqual(one.approvedIds, [f.member]);
  });

  it("human counteroffers clear all plan and booking approvals and preserve history", async () => {
    const f = await ready();
    const terms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
    await assistant.approveBookingTerms(
      sql,
      f.host,
      f.room.id,
      { revision: 1, termsHash: terms.termsHash },
      f.now,
    );
    const input = {
      messageId: "counter",
      expectedRevision: 1,
      plan: { ...proposal(f.now).plan, startAt: new Date(f.now + 25 * HOUR).toISOString() },
    };
    const next = await agents.proposeForMember(sql, f.member, f.room.id, input, f.now);
    assert.equal(next.revision, 2);
    assert.equal(next.state, "open");
    assert.deepEqual(next.confirmations, []);
    assert.deepEqual(next.booking_approvals, []);
    assert.equal(
      (await agents.proposeForMember(sql, f.member, f.room.id, input, f.now)).revision,
      2,
    );
    await rejects(
      agents.proposeForMember(
        sql,
        f.member,
        f.room.id,
        { ...input, plan: proposal(f.now).plan },
        f.now,
      ),
      409,
    );
    await rejects(
      assistant.approveBookingTerms(
        sql,
        f.host,
        f.room.id,
        { revision: 1, termsHash: terms.termsHash },
        f.now,
      ),
      409,
    );
    const events = await assistant.getHistory(sql, f.host, f.room.id);
    assert.equal(events.filter((e) => e.kind === "proposal").length, 2);
    await rejects(assistant.getHistory(sql, "stranger", f.room.id), 404);
  });

  it("fresh overlap, withdrawal, expiry, suspension and blocking stop booking", async () => {
    for (const change of [
      "overlap",
      "withdraw",
      "expire",
      "suspend",
      "block",
      "preference",
    ] as const) {
      const f = await ready();
      const terms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
      const body = { revision: 1, termsHash: terms.termsHash };
      await assistant.approveBookingTerms(sql, f.host, f.room.id, body, f.now);
      if (change === "overlap")
        await pace.postSession(
          sql,
          f.member,
          {
            ...proposal(f.now).plan,
            detail: "",
            abilityFlex: "strict",
            visibility: "public",
            capacity: 2,
            joinMode: "instant",
            womenOnly: false,
          },
          f.now,
        );
      if (change === "withdraw")
        await agents.consentToNegotiation(sql, f.member, f.room.id, false, f.now);
      if (change === "expire")
        await sql`update agent_negotiations set expires_at = ${new Date(f.now - 1).toISOString()} where id = ${f.room.id}`;
      if (change === "suspend")
        await sql`update profiles set suspended_at = now() where id = ${f.member}`;
      if (change === "block") await safety.blockMember(sql, f.member, f.host, f.now);
      if (change === "preference")
        await assistant.setPreferences(
          sql,
          f.member,
          { ...preferences(f.now), enabled: false },
          f.now,
        );
      await assert.rejects(
        assistant.approveBookingTerms(sql, f.member, f.room.id, body, f.now),
        (e: unknown) => e instanceof pace.PaceError && [404, 409].includes(e.status),
        change,
      );
      const [row] =
        await sql`select result_booking_id from agent_negotiations where id = ${f.room.id}`;
      assert.equal(row.result_booking_id, null, change);
    }
  });

  it("plan confirmation alone still cannot book and results cannot be countered", async () => {
    const f = await ready();
    const r = await agents.getNegotiation(sql, f.host, f.room.id);
    assert.equal(agents.view(r).booked, false);
    const terms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
    await assistant.approveBookingTerms(
      sql,
      f.host,
      f.room.id,
      { revision: 1, termsHash: terms.termsHash },
      f.now,
    );
    await assistant.approveBookingTerms(
      sql,
      f.member,
      f.room.id,
      { revision: 1, termsHash: terms.termsHash },
      f.now,
    );
    await rejects(
      agents.proposeForMember(
        sql,
        f.host,
        f.room.id,
        { messageId: "too-late", expectedRevision: 1, plan: proposal(f.now).plan },
        f.now,
      ),
      409,
    );
    // Withdrawing delegation consent never cancels the existing normal booking.
    const withdrawn = await agents.consentToNegotiation(sql, f.host, f.room.id, false, f.now);
    const record = await assistant.getBookingTerms(sql, f.host, f.room.id, f.now + 15 * 24 * HOUR);
    assert.equal(record.booked, true);
    assert.equal(
      (await pace.getBooking(sql, f.host, withdrawn.result_booking_id!, f.now)).status,
      "confirmed",
    );
  });

  it("normal posting, joining and training blocks honor an assistant reservation", async () => {
    const f = await ready();
    const terms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
    for (const person of [f.host, f.member])
      await assistant.approveBookingTerms(
        sql,
        person,
        f.room.id,
        { revision: 1, termsHash: terms.termsHash },
        f.now,
      );
    const input = {
      ...proposal(f.now).plan,
      detail: "",
      abilityFlex: "strict" as const,
      visibility: "public" as const,
      capacity: 2,
      joinMode: "instant" as const,
      womenOnly: false,
    };
    await rejects(pace.postSession(sql, f.host, input, f.now), 409);
    const other = await pair(sql);
    const posted = await pace.postSession(sql, other.host, input, f.now);
    await rejects(pace.bookSeat(sql, f.member, posted.id, {}, f.now), 409);
    const blockInput = {
      activity: "run" as const,
      capacity: 2,
      visibility: "public" as const,
      joinMode: "instant" as const,
      womenOnly: false,
      goalKind: "consistency" as const,
      goalDate: clusterDate(f.now + 42 * 24 * HOUR),
      slots: [input],
    };
    await rejects(blocks.postTrainingBlock(sql, f.host, blockInput, f.now), 409);
    const block = await blocks.postTrainingBlock(sql, other.host, blockInput, f.now);
    await rejects(blocks.joinTrainingBlock(sql, f.member, block.id, {}, f.now), 409);
    assert.equal(
      (
        await sql`select 1 from training_block_members where block_id = ${block.id} and profile_id = ${f.member}`
      ).length,
      0,
    );
  });

  it("recurring generation pauses a conflicting occurrence and only notifies once", async () => {
    const f = await pair(sql);
    const start = nextOccurrence(f.now);
    const p = {
      ...preferences(f.now),
      availability: [
        { startAt: new Date(start).toISOString(), endAt: new Date(start + 2 * HOUR).toISOString() },
      ],
    };
    for (const person of [f.host, f.member]) await assistant.setPreferences(sql, person, p, f.now);
    await agents.proposeForMember(
      sql,
      f.host,
      f.room.id,
      {
        messageId: "next-week",
        expectedRevision: 0,
        plan: { ...proposal(f.now).plan, startAt: new Date(start).toISOString() },
      },
      f.now,
    );
    for (const person of [f.host, f.member])
      await agents.confirmProposal(sql, person, f.room.id, 1, f.now);
    const terms = (await assistant.getBookingTerms(sql, f.host, f.room.id, f.now)).terms;
    for (const person of [f.host, f.member])
      await assistant.approveBookingTerms(
        sql,
        person,
        f.room.id,
        { revision: 1, termsHash: terms.termsHash },
        f.now,
      );
    const series = await pace.repeatWeekly(sql, f.host, f.booking.id, f.now);
    assert.equal(series.nextSessionId, null);
    assert.equal(
      await sql.transaction((tx) => pace.ensureNextOccurrence(tx, series.id, f.now)),
      null,
    );
    const notices = await sql`select id from notifications where kind = 'standing_slot_conflict'
      and profile_id in (${f.host}, ${f.member})`;
    assert.equal(notices.length, 2);
    assert.equal(
      (
        await sql`select 1 from sessions where series_id = ${series.id} and start_at > ${new Date(f.now).toISOString()}`
      ).length,
      0,
    );
  });
});
