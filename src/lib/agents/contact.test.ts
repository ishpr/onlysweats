import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import * as pace from "../pace/service.server.ts";
import * as safety from "../pace/safety.server.ts";
import * as agents from "./service.server.ts";
import * as assistant from "./assistant.server.ts";
import * as discovery from "./discovery.server.ts";
import * as coordination from "./coordination.server.ts";
import * as contacts from "./contact.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import { wrap } from "../workout-plans/postgres-test-db.ts";
import { rpc } from "./test-helpers.ts";

let sql: Sql;
const DAY = 86_400_000;
before(async () => {
  sql = await makeDb();
});
beforeEach(async () => {
  await sql`update agent_contact_authorities set enabled = false`;
});

async function terms(id: string, now: number) {
  await sql.transaction(async (tx) => {
    await tx`insert into app_terms_acceptances
      (user_id, version, accepted_at, assistant_consent_generation, fitness_consent_generation)
      values (${id}, ${APP_TERMS_VERSION}, ${new Date(now)}, ${randomUUID()}, ${randomUUID()})
      on conflict do nothing`;
    await contacts.initializeAgentContactsFromTerms(tx, id, now);
  });
}
async function member(now: number, accept = true) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Synthetic member', ${`${id}@example.test`}, true)`;
  await pace.ensureProfile(sql, { id, name: "Synthetic member", email: `${id}@example.test` });
  const start = Math.ceil((now + DAY) / 900_000) * 900_000;
  const prefs = {
    enabled: true,
    activity: "run" as const,
    ability: { kind: "run" as const, paceMinSec: 570, paceMaxSec: 600, miles: 1 },
    durationMin: 30,
    venueIds: ["katy"],
    approvedIntent: "Private entered planning note",
    availability: [
      { startAt: new Date(start).toISOString(), endAt: new Date(start + 3600_000).toISOString() },
    ],
  };
  await assistant.setPreferences(sql, id, prefs, now);
  if (accept) await terms(id, now);
  return { id, prefs };
}
async function roomFor(id: string) {
  const [room] = await sql<agents.Negotiation>`select * from agent_negotiations
    where host_id = ${id} or participant_id = ${id} order by created_at desc limit 1`;
  return room;
}
async function runFor(room: agents.Negotiation) {
  const [run] = await sql<{
    id: string;
    status: string;
  }>`select id, status from agent_coordination_runs where negotiation_id = ${room.id}`;
  return run;
}

function deferredWorker(db: Sql): Sql {
  const query = async <T>(tx: Sql, text: string, params?: unknown[]) => {
    if (/select \* from agent_coordination_runs where id =/.test(text))
      throw new Error("Synthetic request interruption after durable contact");
    return tx.query<T>(text, params);
  };
  return wrap(
    (text, params) => query(db, text, params),
    (fn) =>
      db.transaction((tx) => {
        const observed: Sql = wrap(
          (text, params) => query(tx, text, params),
          (nested) => nested(observed),
        );
        return fn(observed);
      }),
  );
}

describe("Terms-authorized agent contacts", () => {
  it("replans in the same room, clears old approvals, recovers no-match and treats identical save retries as unchanged", async () => {
    const now = Date.now(),
      a = await member(now),
      b = await member(now);
    await contacts.checkAgentMatching(sql, a.id, now);
    const original = await roomFor(a.id);
    for (const id of [a.id, b.id])
      await agents.confirmProposal(sql, id, original.id, original.revision, now + 1);
    const { terms: booking } = await assistant.getBookingTerms(sql, a.id, original.id, now + 1);
    const oldApproval = { revision: original.revision, termsHash: booking.termsHash };
    await assistant.approveBookingTerms(sql, a.id, original.id, oldApproval, now + 2);
    const shifted = {
      ...a.prefs,
      availability: a.prefs.availability.map((w) => ({
        startAt: new Date(+new Date(w.startAt) + 900_000).toISOString(),
        endAt: new Date(+new Date(w.endAt) + 900_000).toISOString(),
      })),
    };
    const changed = await assistant.setPreferences(sql, a.id, shifted, now + 3);
    await contacts.checkAgentMatching(sql, a.id, now + 3);
    const next = await roomFor(a.id);
    assert.equal(next.id, original.id);
    assert.ok(next.revision > original.revision);
    assert.notEqual(next.plan?.startAt, original.plan?.startAt);
    assert.deepEqual(next.confirmations, []);
    assert.deepEqual(next.booking_approvals, []);
    await assert.rejects(assistant.approveBookingTerms(sql, b.id, next.id, oldApproval, now + 4));
    assert.equal(
      (await assistant.setPreferences(sql, a.id, shifted, now + 5)).revision,
      changed.revision,
    );
    await contacts.checkAgentMatching(sql, a.id, now + 5);
    assert.equal((await roomFor(a.id)).revision, next.revision);
    const before =
      await sql`select id from agent_coordination_runs where negotiation_id = ${next.id}`;
    assert.equal(before.length, 2);
    const noOverlap = {
      ...shifted,
      availability: shifted.availability.map((w) => ({
        startAt: new Date(+new Date(w.startAt) + 7200_000).toISOString(),
        endAt: new Date(+new Date(w.endAt) + 7200_000).toISOString(),
      })),
    };
    await assistant.setPreferences(sql, a.id, noOverlap, now + 6);
    // Simulates a preferences request dying before its contact follow-up.
    await contacts.sweepAgentContacts(sql, now + 7);
    const unmatched = await coordination.getCoordination(sql, a.id, next.id, now + 7);
    assert.equal(unmatched.latestRun?.status, "no_match");
    assert.match(unmatched.reason ?? "", /No shared|No current/);
    assert.equal((await roomFor(a.id)).plan, null);
    await assistant.setPreferences(
      sql,
      b.id,
      { ...b.prefs, availability: noOverlap.availability },
      now + 8,
    );
    await contacts.checkAgentMatching(sql, b.id, now + 8);
    assert.equal((await roomFor(a.id)).id, original.id);
    assert.equal(
      (await coordination.getCoordination(sql, a.id, next.id, now + 8)).latestRun?.status,
      "awaiting_review",
    );
    assert.ok((await roomFor(a.id)).plan);
    const events = await assistant.getHistory(sql, a.id, next.id);
    assert.equal(events.filter((e) => e.data.action === "preferences_changed").length, 3);
    // Four runs total include the original and the no-match. A further edit
    // invalidates obsolete approvals without exceeding the automatic limit.
    await assistant.setPreferences(
      sql,
      a.id,
      { ...noOverlap, approvedIntent: "Another entered note" },
      now + 9,
    );
    await contacts.checkAgentMatching(sql, a.id, now + 9);
    assert.equal((await roomFor(a.id)).plan, null);
    assert.match(
      (await coordination.getCoordination(sql, a.id, next.id, now + 9)).reason ?? "",
      /limit/,
    );
    assert.equal(
      (await sql`select id from agent_coordination_runs where negotiation_id = ${next.id}`).length,
      4,
    );
    const limited = await assistant.getHistory(sql, a.id, next.id);
    await contacts.checkAgentMatching(sql, a.id, now + 10);
    assert.deepEqual(await assistant.getHistory(sql, a.id, next.id), limited);
  });

  it("does not regrant stopped rooms, reopen withdrawals, alter bookings or resume disabled preferences", async () => {
    const now = Date.now();
    for (const kind of ["room_stop", "withdrawal", "booked", "preferences_paused"] as const) {
      await sql`update agent_contact_authorities set enabled = false`;
      const a = await member(now),
        b = await member(now);
      await contacts.checkAgentMatching(sql, a.id, now);
      const room = await roomFor(a.id);
      if (kind === "room_stop")
        await coordination.setCoordinationPermission(
          sql,
          b.id,
          room.id,
          { enabled: false },
          now + 1,
        );
      if (kind === "withdrawal")
        await agents.consentToNegotiation(sql, b.id, room.id, false, now + 1);
      if (kind === "booked") {
        for (const id of [a.id, b.id])
          await agents.confirmProposal(sql, id, room.id, room.revision, now + 1);
        const { terms } = await assistant.getBookingTerms(sql, a.id, room.id, now + 1);
        for (const id of [a.id, b.id])
          await assistant.approveBookingTerms(
            sql,
            id,
            room.id,
            { revision: room.revision, termsHash: terms.termsHash },
            now + 1,
          );
      }
      if (kind === "preferences_paused")
        await assistant.setPreferences(sql, b.id, { ...b.prefs, enabled: false }, now + 1);
      const unchanged = await roomFor(a.id);
      const history = await assistant.getHistory(sql, a.id, room.id);
      await assistant.setPreferences(
        sql,
        a.id,
        { ...a.prefs, approvedIntent: "Changed private note" },
        now + 2,
      );
      await contacts.checkAgentMatching(sql, a.id, now + 2);
      assert.deepEqual(await roomFor(a.id), unchanged, kind);
      assert.deepEqual(await assistant.getHistory(sql, a.id, room.id), history, kind);
      assert.equal(
        (await sql`select id from agent_coordination_runs where negotiation_id = ${room.id}`)
          .length,
        1,
        kind,
      );
    }
  });

  it("skips a stricter women's-only verification requirement and continues to an ordinary compatible partner", async () => {
    const now = Date.now(),
      own = await member(now),
      b = await member(now),
      c = await member(now);
    const [stricter, ordinary] = await sql<{
      id: string;
    }>`select id from profiles where id in (${b.id}, ${c.id})
      order by md5(id || ${new Date(now).toISOString().slice(0, 13)}), id`;
    for (const id of [own.id, b.id, c.id])
      await sql`update profiles set gender = 'woman', verified_member_at = ${new Date(now)} where id = ${id}`;
    await sql`update profiles set verified_id_at = ${new Date(now)} where id = ${stricter.id}`;
    await contacts.setAgentMatching(sql, stricter.id, { enabled: true, womenOnly: true }, now);
    const prior = process.env.VERIFICATION_ENFORCED;
    process.env.VERIFICATION_ENFORCED = "1";
    try {
      await contacts.checkAgentMatching(sql, own.id, now);
      const room = await roomFor(own.id);
      assert.ok(room);
      assert.deepEqual(
        new Set([room.host_id, room.participant_id]),
        new Set([own.id, ordinary.id]),
      );
      assert.equal(await roomFor(stricter.id), undefined);
    } finally {
      if (prior === undefined) delete process.env.VERIFICATION_ENFORCED;
      else process.env.VERIFICATION_ENFORCED = prior;
    }
  });

  it("starts immediately and fences delegated transport and final booking after Terms authority is removed", async () => {
    const now = Date.now(),
      a = await member(now),
      b = await member(now);
    await contacts.checkAgentMatching(sql, a.id, now);
    const room = await roomFor(a.id);
    assert.equal((await runFor(room)).status, "awaiting_review");
    const events = await assistant.getHistory(sql, a.id, room.id);
    const proposal = events.find((e) => e.kind === "proposal")!;
    assert.equal(proposal.data.source, "agent_contact");
    assert.equal(proposal.data.authorityRevision, 1);
    assert.equal(proposal.data.preferenceRevision, 1);
    assert.equal((proposal.data.message as { role: string }).role, "ROLE_AGENT");
    const grant = await agents.createDelegation(sql, a.id, { label: "Synthetic agent" }, now);
    const current = await agents.getNegotiation(sql, a.id, room.id);
    for (const id of [a.id, b.id])
      await agents.confirmProposal(sql, id, room.id, current.revision, now + 1);
    const { terms: booking } = await assistant.getBookingTerms(sql, a.id, room.id, now + 1);
    const request = { revision: current.revision, termsHash: booking.termsHash };
    await assistant.approveBookingTerms(sql, a.id, room.id, request, now + 2);
    assert.ok(
      (await (await rpc(sql, grant.token, now + 2, "GetTask", { id: room.id })).json()).result,
    );
    await sql`delete from app_terms_acceptances where user_id = ${b.id}`;
    assert.ok(
      (await (await rpc(sql, grant.token, now + 3, "GetTask", { id: room.id })).json()).error,
    );
    const listed = await (await rpc(sql, grant.token, now + 3, "ListTasks", {})).json();
    assert.equal(listed.error, undefined);
    assert.deepEqual(listed.result.tasks ?? [], []);
    assert.equal(Number(listed.result.totalSize ?? 0), 0);
    await assert.rejects(
      assistant.approveBookingTerms(sql, b.id, room.id, request, now + 3),
      /permission|preferences/,
    );
    assert.equal((await agents.getNegotiation(sql, a.id, room.id)).result_booking_id, null);
  });

  it("does not infer authority from old discovery and preserves prior opt-outs on acceptance/replay", async () => {
    const now = Date.now(),
      a = await member(now, false),
      b = await member(now);
    await discovery.setDiscovery(sql, a.id, { enabled: true, preferenceRevision: 1 }, now);
    assert.equal((await contacts.checkAgentMatching(sql, a.id, now)).needs, "terms");
    assert.equal(await roomFor(a.id), undefined);
    await assert.rejects(
      sql.transaction((tx) => contacts.initializeAgentContactsFromTerms(tx, a.id, now)),
      /Terms/,
    );
    await discovery.setDiscovery(sql, a.id, { enabled: false }, now + 1);
    await terms(a.id, now + 2);
    assert.equal((await contacts.getAgentMatching(sql, a.id, now + 2)).enabled, false);
    await terms(a.id, now + 3);
    assert.equal((await contacts.getAgentMatching(sql, a.id, now + 3)).enabled, false);
    // Explicit Resume is a privacy control; it need not rewrite an old discovery grant.
    await contacts.setAgentMatching(sql, a.id, { enabled: true }, now + 4);
    assert.equal((await contacts.checkAgentMatching(sql, a.id, now + 4)).ready, true);
    assert.ok(await roomFor(a.id));
    await assistant.setPreferences(sql, b.id, { ...b.prefs, enabled: false }, now + 5);
    await terms(b.id, now + 6);
    assert.equal((await contacts.getAgentMatching(sql, b.id, now + 6)).needs, "preferences");
    assert.equal((await assistant.getPreferences(sql, b.id)).enabled, false);
  });

  it("atomically contacts both agents, recovers queued work, exposes actual exchanges and requires two human approvals to book", async () => {
    const now = Date.now(),
      a = await member(now),
      b = await member(now),
      stranger = await member(now, false);
    await Promise.all([
      contacts.checkAgentMatching(deferredWorker(sql), a.id, now),
      contacts.checkAgentMatching(deferredWorker(sql), b.id, now),
    ]);
    const room = await roomFor(a.id);
    assert.ok(room && room.host_contact_revision && room.participant_contact_revision);
    assert.deepEqual(new Set([room.host_id, room.participant_id]), new Set([a.id, b.id]));
    const [{ n }] = await sql<{ n: number }>`select count(*)::int n from agent_negotiations
      where host_id in (${a.id},${b.id}) or participant_id in (${a.id},${b.id})`;
    assert.equal(n, 1);
    assert.equal((await runFor(room)).status, "queued");
    await coordination.advanceCoordination(sql, (await runFor(room)).id, now + 1);
    const recovery = await coordination.sweepCoordination(sql, now + 2);
    assert.ok(recovery.awaitingReview >= 1);
    const events = await assistant.getHistory(sql, a.id, room.id);
    assert.deepEqual(events, await assistant.getHistory(sql, b.id, room.id));
    const messages = events.filter((e) => e.kind === "agent_message");
    assert.deepEqual(
      messages.map((e) => e.data.action),
      ["contact", "matched_preferences", "checked_preferences", "ready_for_review"],
    );
    for (const e of messages) {
      assert.equal(e.data.actorKind, "agent");
      assert.equal(e.data.source, "agent_contact");
      assert.equal((e.data.message as { role: string }).role, "ROLE_AGENT");
      assert.ok(e.data.authorityRevision);
    }
    assert.doesNotMatch(JSON.stringify(events), /Private entered planning note|availability/);
    assert.ok(
      !events.some((e) => e.kind === "consent" || e.kind === "confirmation" || e.kind === "booked"),
    );
    await assert.rejects(assistant.getHistory(sql, stranger.id, room.id), /unavailable/);
    const current = await agents.getNegotiation(sql, a.id, room.id);
    assert.deepEqual(current.confirmations, []);
    assert.equal(current.result_booking_id, null);
    await assert.rejects(
      assistant.approveBookingTerms(
        sql,
        a.id,
        room.id,
        { revision: current.revision, termsHash: "unreviewed" },
        now + 3,
      ),
    );
    for (const id of [a.id, b.id])
      await agents.confirmProposal(sql, id, room.id, current.revision, now + 3);
    const { terms: booking } = await assistant.getBookingTerms(sql, a.id, room.id, now + 3);
    const request = { revision: current.revision, termsHash: booking.termsHash };
    assert.equal(
      (await assistant.approveBookingTerms(sql, a.id, room.id, request, now + 4)).booked,
      false,
    );
    const result = await assistant.approveBookingTerms(sql, b.id, room.id, request, now + 4);
    assert.equal(result.booked, true);
    assert.equal(
      (await assistant.approveBookingTerms(sql, b.id, room.id, request, now + 5)).bookingId,
      result.bookingId,
    );
    await contacts.setAgentMatching(sql, a.id, { enabled: false }, now + 6);
    assert.equal(
      (await agents.getNegotiation(sql, a.id, room.id)).result_booking_id,
      result.bookingId,
    );
    await contacts.checkAgentMatching(sql, a.id, now + 6);
    assert.equal((await roomFor(a.id)).id, room.id);
  });

  it("fences every step on preference changes, pause, legacy withdrawal and Terms revocation", async () => {
    const now = Date.now();
    for (const revoke of ["preferences", "pause", "legacy", "terms"] as const) {
      await sql`update agent_contact_authorities set enabled = false`;
      const a = await member(now),
        b = await member(now);
      await contacts.checkAgentMatching(deferredWorker(sql), a.id, now);
      const room = await roomFor(a.id),
        run = await runFor(room);
      await coordination.advanceCoordination(sql, run.id, now + 1);
      if (revoke === "preferences")
        await assistant.setPreferences(
          sql,
          b.id,
          { ...b.prefs, approvedIntent: "Edited" },
          now + 2,
        );
      if (revoke === "pause")
        await contacts.setAgentMatching(sql, b.id, { enabled: false }, now + 2);
      if (revoke === "legacy") await discovery.setDiscovery(sql, b.id, { enabled: false }, now + 2);
      if (revoke === "terms") await sql`delete from app_terms_acceptances where user_id = ${b.id}`;
      const next = await coordination.advanceCoordination(sql, run.id, now + 3);
      assert.equal(next?.status, "cancelled", revoke);
      assert.equal(next?.stepsUsed, 1, revoke);
      assert.equal((await agents.getNegotiation(sql, a.id, room.id)).result_booking_id, null);
      if (revoke === "pause" || revoke === "legacy")
        assert.equal((await roomFor(a.id)).state, "cancelled");
    }
  });

  it("rechecks blocks, freeze, audience and expired preferences, then applies the pair cooldown after decline", async () => {
    const now = Date.now(),
      a = await member(now),
      b = await member(now);
    await safety.blockMember(sql, a.id, b.id, now);
    await contacts.checkAgentMatching(sql, a.id, now);
    assert.equal(await roomFor(a.id), undefined);
    await sql`delete from blocks where blocker_id = ${a.id} and blocked_id = ${b.id}`;
    await sql`update profiles set frozen_until = ${new Date(now + DAY)} where id = ${b.id}`;
    await contacts.checkAgentMatching(sql, a.id, now + 3600_001);
    assert.equal(await roomFor(a.id), undefined);
    await sql`update profiles set frozen_until = null, gender = 'woman' where id = ${a.id}`;
    await sql`update profiles set frozen_until = null, gender = 'man' where id = ${b.id}`;
    await contacts.setAgentMatching(sql, a.id, { enabled: true, womenOnly: true }, now + 3600_002);
    await contacts.checkAgentMatching(sql, a.id, now + 3600_002);
    assert.equal(await roomFor(a.id), undefined);
    await contacts.setAgentMatching(sql, a.id, { enabled: true, womenOnly: false }, now + 3600_003);
    await contacts.checkAgentMatching(sql, a.id, now + 3600_003);
    const room = await roomFor(a.id);
    assert.ok(room);
    await agents.consentToNegotiation(sql, b.id, room.id, false, now + 3600_004);
    await contacts.checkAgentMatching(sql, a.id, now + 7200_005);
    assert.equal((await roomFor(a.id)).id, room.id);
    assert.equal((await contacts.getAgentMatching(sql, a.id, now + 8 * DAY)).ready, false);
  });

  it("does not accept old unanswered invitations, bypass quotas, or leave half-created contacts after an enqueue failure", async () => {
    const now = Date.now(),
      a = await member(now),
      b = await member(now);
    for (const user of [a, b])
      await discovery.setDiscovery(sql, user.id, { enabled: true, preferenceRevision: 1 }, now);
    const old = await discovery.inviteDiscovery(
      sql,
      a.id,
      { memberId: b.id, preferenceRevision: 1 },
      now,
    );
    await contacts.checkAgentMatching(sql, a.id, now);
    assert.equal((await agents.getNegotiation(sql, a.id, old.id)).participant_consented, false);
    assert.equal(await runFor(old), undefined);
    await sql`update agent_contact_authorities set enabled = false`;
    const c = await member(now),
      d = await member(now);
    // The real transaction is retained; inject a database failure at durable enqueue.
    const faulty = Object.assign(
      (() => {
        throw new Error("unused outer template");
      }) as unknown as Sql,
      {
        query: sql.query,
        transaction: async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> =>
          sql.transaction(async (tx) => {
            const wrapped = Object.assign(
              (async (strings: TemplateStringsArray, ...values: unknown[]) => {
                if (strings.join("").includes("insert into agent_coordination_runs"))
                  throw new Error("Synthetic queue failure");
                return tx(strings, ...values);
              }) as Sql,
              {
                query: tx.query,
                transaction: async <R>(inner: (tx: Sql) => Promise<R>) => inner(wrapped),
              },
            );
            return fn(wrapped);
          }),
      },
    );
    // check() uses statements outside its nested transaction too.
    const passThrough = Object.assign(
      (async (strings: TemplateStringsArray, ...values: unknown[]) =>
        sql(strings, ...values)) as Sql,
      { query: sql.query, transaction: faulty.transaction },
    );
    await assert.rejects(
      contacts.checkAgentMatching(passThrough, c.id, now),
      /Synthetic queue failure/,
    );
    assert.equal(await roomFor(c.id), undefined);
    assert.equal(await roomFor(d.id), undefined);
    // A claimed failed scan is recoverable at its durable retry time.
    await contacts.checkAgentMatching(sql, c.id, now + 3600_001);
    assert.ok(await roomFor(c.id));
    await sql`update agent_contact_authorities set enabled = false`;
    const capped = await member(now),
      target = await member(now);
    for (let i = 0; i < 5; i++)
      await sql`insert into agent_negotiations
      (id, booking_id, host_id, participant_id, state, expires_at, created_at, updated_at)
      values (${randomUUID()}, null, ${capped.id}, ${a.id}, 'cancelled', ${new Date(now + DAY)}, ${new Date(now)}, ${new Date(now)})`;
    await contacts.checkAgentMatching(sql, capped.id, now);
    assert.equal(await roomFor(target.id), undefined);
  });
});
