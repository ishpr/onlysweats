import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import * as pace from "../pace/service.server.ts";
import * as safety from "../pace/safety.server.ts";
import * as agents from "./service.server.ts";
import * as assistant from "./assistant.server.ts";
import * as discovery from "./discovery.server.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const DAY = 86400_000;
async function member(now: number, enabled = true, venue = "katy") {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Pilot member', ${`${id}@example.test`}, true)`;
  await pace.ensureProfile(sql, { id, name: "Pilot member", email: `${id}@example.test` });
  const start = Math.ceil((now + DAY) / 900_000) * 900_000;
  const prefs = {
    enabled: true,
    activity: "run" as const,
    ability: { kind: "run" as const, paceMinSec: 570, paceMaxSec: 600, miles: 1 },
    durationMin: 30,
    venueIds: [venue],
    approvedIntent: "private planning note",
    availability: [
      { startAt: new Date(start).toISOString(), endAt: new Date(start + 3600_000).toISOString() },
    ],
  };
  await assistant.setPreferences(sql, id, prefs, now);
  if (enabled) await discovery.setDiscovery(sql, id, { enabled: true, preferenceRevision: 1 }, now);
  return { id, prefs };
}

describe("explicit first-time introductions", () => {
  it("does not expose opted-out members, exact times, notes or health facts", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now),
      privateMember = await member(now, false);
    const result = await discovery.getDiscovery(sql, a.id, now);
    assert.ok(result.candidates.some((c) => c.memberId === b.id));
    assert.ok(!result.candidates.some((c) => c.memberId === privateMember.id));
    assert.deepEqual(Object.keys(result.candidates[0]).sort(), [
      "activity",
      "memberId",
      "name",
      "sharedVenueCount",
    ]);
    assert.doesNotMatch(JSON.stringify(result), /private planning note|availability|heart|startAt/);
    assert.deepEqual((await discovery.getDiscovery(sql, privateMember.id, now)).candidates, []);
    await assert.rejects(
      discovery.inviteDiscovery(
        sql,
        a.id,
        { memberId: privateMember.id, preferenceRevision: 1 },
        now,
      ),
      /no longer available/,
    );
  });

  it("opens one unaccepted invitation, then requires both members' separate planning and booking approvals", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now);
    const input = { memberId: b.id, preferenceRevision: 1 };
    const rooms = await Promise.all(
      Array.from({ length: 4 }, () => discovery.inviteDiscovery(sql, a.id, input, now)),
    );
    assert.equal(new Set(rooms.map((r) => r.id)).size, 1);
    const room = rooms[0];
    assert.equal(room.booking_id, null);
    assert.equal(room.participant_consented, false);
    await assert.rejects(assistant.suggestPlans(sql, a.id, room.id, now), /unavailable/);
    await agents.consentToNegotiation(sql, b.id, room.id, true, now);
    const [plan] = (await assistant.suggestPlans(sql, a.id, room.id, now)).candidates;
    assert.ok(plan);
    await agents.proposeForMember(
      sql,
      a.id,
      room.id,
      { messageId: randomUUID(), expectedRevision: 0, plan },
      now,
    );
    await agents.confirmProposal(sql, a.id, room.id, 1, now);
    await agents.confirmProposal(sql, b.id, room.id, 1, now);
    const { terms } = await assistant.getBookingTerms(sql, a.id, room.id, now);
    const first = await assistant.approveBookingTerms(
      sql,
      a.id,
      room.id,
      { revision: 1, termsHash: terms.termsHash },
      now,
    );
    assert.equal(first.booked, false);
    const final = await assistant.approveBookingTerms(
      sql,
      b.id,
      room.id,
      { revision: 1, termsHash: terms.termsHash },
      now,
    );
    assert.equal(final.booked, true);
    assert.ok(final.bookingId);
    const [{ n }] = await sql<{
      n: number;
    }>`select count(*)::int n from bookings where id = ${final.bookingId}`;
    assert.equal(n, 1);
  });

  it("expires and pauses discovery on preference edits, with stale revisions rejected", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now);
    await assistant.setPreferences(sql, a.id, { ...a.prefs, approvedIntent: "Changed" }, now + 1);
    assert.equal((await discovery.getDiscovery(sql, a.id, now + 1)).enabled, false);
    await assert.rejects(
      discovery.setDiscovery(sql, a.id, { enabled: true, preferenceRevision: 1 }, now + 1),
      /current planning/,
    );
    await discovery.setDiscovery(sql, a.id, { enabled: true, preferenceRevision: 2 }, now + 1);
    assert.equal((await discovery.getDiscovery(sql, a.id, now + 8 * DAY)).enabled, false);
    await assert.rejects(
      discovery.inviteDiscovery(
        sql,
        a.id,
        { memberId: b.id, preferenceRevision: 2 },
        now + 8 * DAY,
      ),
      /no longer available/,
    );
  });

  it("withdraws unanswered invitations and prevents repeated contact after decline", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now);
    const room = await discovery.inviteDiscovery(
      sql,
      a.id,
      { memberId: b.id, preferenceRevision: 1 },
      now,
    );
    await discovery.setDiscovery(sql, b.id, { enabled: false }, now + 1);
    assert.equal((await agents.getNegotiation(sql, a.id, room.id)).state, "cancelled");
    await assert.rejects(agents.consentToNegotiation(sql, b.id, room.id, true, now + 1));
    await discovery.setDiscovery(sql, b.id, { enabled: true, preferenceRevision: 1 }, now + 2);
    await assert.rejects(
      discovery.inviteDiscovery(sql, a.id, { memberId: b.id, preferenceRevision: 1 }, now + 2),
      /Give this person time/,
    );
  });

  it("rechecks blocks and suspension and still allows withdrawal", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now);
    await safety.blockMember(sql, b.id, a.id, now);
    await assert.rejects(
      discovery.inviteDiscovery(sql, a.id, { memberId: b.id, preferenceRevision: 1 }, now),
      /unavailable/,
    );
    assert.ok(
      !(await discovery.getDiscovery(sql, a.id, now)).candidates.some((c) => c.memberId === b.id),
    );
    await sql`update profiles set suspended_at = ${new Date(now)} where id = ${a.id}`;
    await assert.rejects(
      discovery.setDiscovery(sql, a.id, { enabled: true, preferenceRevision: 1 }, now),
    );
    assert.equal((await discovery.setDiscovery(sql, a.id, { enabled: false }, now)).enabled, false);
  });

  it("allows reports before acceptance and after blocking, without exposing conversations to strangers", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now),
      stranger = await member(now, false);
    const room = await discovery.inviteDiscovery(
      sql,
      a.id,
      { memberId: b.id, preferenceRevision: 1 },
      now,
    );
    const input = {
      reportedId: a.id,
      negotiationId: room.id,
      reason: "unsafe" as const,
      alsoBlock: true,
    };
    const report = await safety.reportMember(sql, b.id, input, now);
    assert.equal(report.blocked, true);
    assert.equal((await safety.reportMember(sql, b.id, input, now)).id, report.id);
    await assert.rejects(safety.reportMember(sql, stranger.id, input, now), /unavailable/);
  });

  it("keeps an unanswered invitation's human history minimal and unavailable to delegated agents", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now);
    const room = await discovery.inviteDiscovery(
      sql,
      a.id,
      { memberId: b.id, preferenceRevision: 1 },
      now,
    );
    const received = agents.view(await agents.getNegotiation(sql, b.id, room.id));
    assert.equal(received.plan, null);
    assert.deepEqual(received.confirmedIds, []);
    const history = await assistant.getHistory(sql, b.id, room.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].kind, "consent");
    assert.deepEqual(history[0].data, { allowed: true });
    assert.doesNotMatch(
      JSON.stringify({ received, history }),
      /private planning note|availability|paceMinSec|startAt|heart/,
    );
    await assert.rejects(agents.getNegotiation(sql, a.id, room.id, true), /unavailable/);
    await assert.rejects(agents.getNegotiation(sql, b.id, room.id, true), /unavailable/);
  });

  it("stops discovery without withdrawing the separate consent for a mutually joined conversation", async () => {
    const now = Date.now();
    const a = await member(now),
      b = await member(now);
    const room = await discovery.inviteDiscovery(
      sql,
      a.id,
      { memberId: b.id, preferenceRevision: 1 },
      now,
    );
    await agents.consentToNegotiation(sql, b.id, room.id, true, now);
    assert.equal(
      (await discovery.setDiscovery(sql, a.id, { enabled: false }, now + 1)).enabled,
      false,
    );
    const joined = await agents.getNegotiation(sql, a.id, room.id, true);
    assert.equal(joined.state, "open");
    assert.equal(joined.host_consented, true);
    assert.equal(joined.participant_consented, true);
    assert.ok((await assistant.suggestPlans(sql, a.id, room.id, now + 1)).candidates.length);
  });
});
