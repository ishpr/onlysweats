/** Block, report, account deletion and the admin queue — against real SQL. */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import * as safety from "./safety.server.ts";
import * as svc from "./service.server.ts";
import { makeDb } from "./test-db.ts";

const HOUR = 60 * 60_000;
const ADMIN = "ops@samepace.app";
const RUN = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 } as const;

let sql: Sql;
let n = 0;

/** A signed-up member: an auth user row plus the profile first contact creates. */
async function member(name: string) {
  n += 1;
  const id = `u${n}_${name.toLowerCase()}`;
  const email = `${id}@example.com`;
  await sql`
    insert into "user" (id, name, email, "emailVerified") values (${id}, ${name}, ${email}, true)`;
  await svc.ensureProfile(sql, { id, name, email });
  return { id, email };
}

const post = (hostId: string, patch: Partial<svc.PostSessionInput> = {}) =>
  svc.postSession(sql, hostId, {
    venueId: "katy",
    activity: "run",
    title: "Easy miles",
    detail: "",
    ability: RUN,
    abilityFlex: "strict",
    startAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    durationMin: 40,
    capacity: 2,
    visibility: "public",
    joinMode: "instant",
    womenOnly: false,
    ...patch,
  });

const rejects = (p: Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof svc.PaceError, String(err));
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });

const visibleTo = async (viewer: string) =>
  (await svc.listPublicSessions(sql, viewer)).sessions.map((s) => s.id);

/** Historical human messages still participate in reports and retention; this creates no sender API. */
async function legacyMessageFixture(fromId: string, bookingId: string, text: string) {
  await sql`insert into messages (id, booking_id, from_id, text, created_at)
    values (${`legacy-${crypto.randomUUID()}`}, ${bookingId}, ${fromId}, ${text}, now() - interval '1 hour')`;
}

before(async () => {
  sql = await makeDb();
});

describe("block", () => {
  it("hides each side's sessions from the other and refuses the seat", async () => {
    const [a, b, c] = [await member("Ana"), await member("Ben"), await member("Cy")];
    const s = await post(a.id);
    assert.ok((await visibleTo(b.id)).includes(s.id));

    await safety.blockMember(sql, b.id, a.id);
    assert.ok(!(await visibleTo(b.id)).includes(s.id), "blocker no longer sees it");
    assert.ok((await visibleTo(c.id)).includes(s.id), "everyone else still does");
    await rejects(svc.getSession(sql, b.id, s.id), 404);
    await rejects(svc.bookSeat(sql, b.id, s.id), 404);

    // The other direction: what the blocker posts is gone for the blocked member.
    const mine = await post(b.id);
    assert.ok(!(await visibleTo(a.id)).includes(mine.id));
    await rejects(svc.bookSeat(sql, a.id, mine.id), 404);

    assert.deepEqual((await safety.listBlocks(sql, b.id)).map((p) => p.id), [a.id]);
    assert.deepEqual(await safety.listBlocks(sql, a.id), [], "being blocked is never shown");

    await safety.unblockMember(sql, b.id, a.id);
    assert.ok((await visibleTo(b.id)).includes(s.id));
  });

  it("releases the seat they share, free, and closes the thread", async () => {
    const [a, b] = [await member("Dee"), await member("Eli")];
    // Inside 12h, where a normal cancel would cost $5.
    const s = await post(a.id, { startAt: new Date(Date.now() + 2 * HOUR).toISOString() });
    const seat = await svc.bookSeat(sql, b.id, s.id);
    await safety.blockMember(sql, b.id, a.id);

    assert.equal((await svc.getBooking(sql, b.id, seat.id)).status, "cancelled");
    assert.equal((await svc.getMe(sql, b.id)).feesCents, 0);
    assert.equal((await svc.getMe(sql, a.id)).feesCents, 0);
    await rejects(svc.sendMessage(sql, a.id, seat.id, "hey"), 409);
  });

  it("covers a fellow joiner, not just the poster", async () => {
    const [a, b, c] = [await member("Fay"), await member("Gus"), await member("Hal")];
    const s = await post(a.id, { capacity: 3 });
    await svc.bookSeat(sql, b.id, s.id);
    await safety.blockMember(sql, c.id, b.id);
    assert.ok(!(await visibleTo(c.id)).includes(s.id));
    await rejects(svc.bookSeat(sql, c.id, s.id), 404);
  });

  it("releases only the blocker when both already hold group seats, without fees or the meeting pin", async () => {
    const [host, a, b] = [await member("GroupHost"), await member("GroupA"), await member("GroupB")];
    const s = await post(host.id, { capacity: 3, startAt: new Date(Date.now() + 2 * HOUR).toISOString() });
    const aSeat = await svc.bookSeat(sql, a.id, s.id);
    const bSeat = await svc.bookSeat(sql, b.id, s.id);
    await safety.blockMember(sql, a.id, b.id);
    assert.equal((await svc.getBooking(sql, a.id, aSeat.id)).status, "cancelled");
    assert.equal((await svc.getBooking(sql, b.id, bSeat.id)).status, "confirmed");
    assert.equal((await svc.getSession(sql, a.id, s.id)).session.pinHint, null);
    assert.equal((await svc.getMe(sql, a.id)).feesCents, 0);
    assert.equal((await svc.getMe(sql, b.id)).feesCents, 0);
    await rejects(svc.bookSeat(sql, a.id, s.id), 404);
  });

  it("ends the standing slot they share, and stops a new one", async () => {
    const [a, b] = [await member("Vic"), await member("Wes")];
    const KATY = { lat: 32.8019, lng: -96.8074 };
    const meet = async () => {
      const s = await post(a.id, { startAt: new Date(Date.now() + 31 * 60_000).toISOString() });
      const seat = await svc.bookSeat(sql, b.id, s.id);
      const inWindow = Date.now() + 25 * 60_000;
      await svc.checkInGeo(sql, b.id, seat.id, KATY, inWindow);
      await svc.checkInGeo(sql, a.id, seat.id, KATY, inWindow);
      return seat;
    };
    const series = await svc.repeatWeekly(sql, b.id, (await meet()).id);
    assert.ok(series.nextSessionId);

    await safety.blockMember(sql, b.id, a.id);
    assert.deepEqual(await svc.listMySeries(sql, a.id), []);
    assert.deepEqual(await svc.listMySeries(sql, b.id), []);
    const [next] = await sql<{ status: string }>`
      select status from sessions where id = ${series.nextSessionId}`;
    assert.equal(next.status, "cancelled");
  });

  it("refuses a new standing slot when two past joiners blocked each other", async () => {
    const [host, a, b] = [await member("RepeatHost"), await member("RepeatA"), await member("RepeatB")];
    const start = Date.now() + 31 * 60_000;
    const s = await post(host.id, { capacity: 3, startAt: new Date(start).toISOString() });
    const first = await svc.bookSeat(sql, a.id, s.id);
    const second = await svc.bookSeat(sql, b.id, s.id);
    const katy = { lat: 32.8019, lng: -96.8074 };
    await svc.checkInGeo(sql, a.id, first.id, katy, start);
    await svc.checkInGeo(sql, b.id, second.id, katy, start);
    await svc.checkInGeo(sql, host.id, first.id, katy, start);
    await safety.blockMember(sql, a.id, b.id, start + HOUR);
    await rejects(svc.repeatWeekly(sql, host.id, first.id, start + HOUR), 409, /can’t be set up/);
    assert.deepEqual(await svc.listMySeries(sql, host.id), []);
  });

  it("refuses blocking yourself or nobody", async () => {
    const a = await member("Ida");
    await rejects(safety.blockMember(sql, a.id, a.id), 400);
    await rejects(safety.blockMember(sql, a.id, "nope"), 404);
  });
});

describe("report", () => {
  it("files once per session, and can block in the same step", async () => {
    const [a, b] = [await member("Jo"), await member("Kai")];
    const s = await post(a.id);
    const seat = await svc.bookSeat(sql, b.id, s.id);

    await legacyMessageFixture(a.id, seat.id, "Historical message retained for this report.");

    const first = await safety.reportMember(sql, b.id, {
      reportedId: a.id,
      reason: "date_framing",
      detail: "Kept calling it a date.",
      bookingId: seat.id,
      alsoBlock: true,
    });
    assert.equal(first.blocked, true);
    const again = await safety.reportMember(sql, b.id, {
      reportedId: a.id,
      reason: "date_framing",
      bookingId: seat.id,
    });
    assert.equal(again.id, first.id, "an open report isn't duplicated");
    assert.deepEqual((await safety.listBlocks(sql, b.id)).map((p) => p.id), [a.id]);

    const { reports } = await safety.adminListReports(sql, "open");
    const mine = reports.find((r) => r.id === first.id)!;
    assert.equal(mine.session?.id, s.id);
    assert.ok(mine.messages.length > 0, "the booking's chat travels with the report");
  });

  it("lets anyone report a public listing, but not strangers on it", async () => {
    const [a, b, c] = [await member("Lu"), await member("Mo"), await member("Ny")];
    const s = await post(a.id);
    await svc.bookSeat(sql, b.id, s.id);
    await safety.reportMember(sql, c.id, { reportedId: a.id, reason: "fake_or_spam", sessionId: s.id });
    await rejects(
      safety.reportMember(sql, c.id, { reportedId: b.id, reason: "other", sessionId: s.id }),
      404,
    );
    await rejects(safety.reportMember(sql, c.id, { reportedId: a.id, reason: "other" }), 400);

    const hidden = await post(a.id, { visibility: "unlisted" });
    await rejects(
      safety.reportMember(sql, c.id, { reportedId: a.id, reason: "other", sessionId: hidden.id }),
      404,
    );
  });

  it("stops at ten a day", async () => {
    const reporter = await member("Oz");
    for (let i = 0; i < 10; i += 1) {
      const host = await member(`Host${i}`);
      const s = await post(host.id);
      await safety.reportMember(sql, reporter.id, { reportedId: host.id, reason: "other", sessionId: s.id });
    }
    const host = await member("Extra");
    const s = await post(host.id);
    await rejects(
      safety.reportMember(sql, reporter.id, { reportedId: host.id, reason: "other", sessionId: s.id }),
      409,
      /support@samepace\.app/,
    );
  });
});

describe("delete my account", () => {
  it("does not resurrect deleted or suspended past participants through repeat weekly", async () => {
    for (const kind of ["delete", "suspend"] as const) {
      const [host, joiner] = [await member(`PastHost${kind}`), await member(`PastJoiner${kind}`)];
      const start = Date.now() + 31 * 60_000;
      const s = await post(host.id, { startAt: new Date(start).toISOString() });
      const b = await svc.bookSeat(sql, joiner.id, s.id);
      const katy = { lat: 32.8019, lng: -96.8074 };
      await svc.checkInGeo(sql, joiner.id, b.id, katy, start);
      await svc.checkInGeo(sql, host.id, b.id, katy, start);
      if (kind === "delete") await safety.deleteAccount(sql, host.id, start + HOUR);
      else await safety.adminSuspend(sql, ADMIN, host.id, "Test suspension", start + HOUR);
      await rejects(svc.repeatWeekly(sql, joiner.id, b.id, start + HOUR), 409, /can’t be set up/);
      const future = await sql`
        select 1 from sessions where host_id = ${host.id} and status = 'open'`;
      assert.equal(future.length, 0);
    }
  });

  it("removes the identity, scrubs the profile, and clears the calendar free", async () => {
    const [a, b] = [await member("Pia"), await member("Quin")];
    await svc.updateProfile(sql, a.id, { neighborhood: "Uptown", gender: "woman" });
    const hosted = await post(a.id, { startAt: new Date(Date.now() + 2 * HOUR).toISOString() });
    const seatOnHosted = await svc.bookSeat(sql, b.id, hosted.id);
    const theirs = await post(b.id);
    const seat = await svc.bookSeat(sql, a.id, theirs.id);
    await legacyMessageFixture(a.id, seat.id, "See you at the trailhead");
    await sql`
      insert into agent_delegations (id, profile_id, label, token_hash, expires_at) values
        ('delete-delegate', ${a.id}, 'Private assistant', 'delete-hash', now() + interval '1 day'),
        ('keep-delegate', ${b.id}, 'Other assistant', 'keep-hash', now() + interval '1 day')`;
    await sql`
      insert into agent_negotiations (id, booking_id, host_id, participant_id, expires_at) values
        ('delete-host-room', ${seatOnHosted.id}, ${a.id}, ${b.id}, now() + interval '1 day'),
        ('delete-joiner-room', ${seat.id}, ${b.id}, ${a.id}, now() + interval '1 day')`;
    await sql`
      insert into agent_negotiation_events
        (negotiation_id, profile_id, message_id, command_hash, kind, revision, data)
      values ('delete-host-room', ${a.id}, 'private-message', 'private-hash', 'proposal', 1,
        '{"note":"Private scheduling preference"}'::jsonb)`;

    await safety.deleteAccount(sql, a.id);

    assert.deepEqual(await sql`select 1 from "user" where id = ${a.id}`, []);
    assert.deepEqual(await sql`select 1 from agent_delegations where profile_id = ${a.id}`, []);
    assert.equal((await sql`select 1 from agent_delegations where profile_id = ${b.id}`).length, 1);
    assert.deepEqual(await sql`
      select 1 from agent_negotiations where host_id = ${a.id} or participant_id = ${a.id}`, []);
    assert.deepEqual(await sql`
      select 1 from agent_negotiation_events where negotiation_id = 'delete-host-room'`, []);
    const [p] = await sql<Record<string, unknown>>`select * from profiles where id = ${a.id}`;
    assert.equal(p.name, "Deleted member");
    assert.equal(p.neighborhood, "");
    assert.equal(p.gender, null);
    assert.ok(p.deleted_at);
    assert.equal((await svc.ensureProfile(sql, { id: a.id, name: "Pia", email: a.email })).deleted, true);

    assert.equal((await svc.getBooking(sql, b.id, seatOnHosted.id)).status, "cancelled");
    assert.equal((await svc.getBooking(sql, b.id, seat.id)).status, "cancelled");
    assert.ok(!(await visibleTo(b.id)).includes(hosted.id));
    const left = await sql`select 1 from messages where from_id = ${a.id}`;
    assert.deepEqual(left, []);
    // Nobody pays for a deletion, even inside 12 hours.
    assert.deepEqual(await sql`select 1 from ledger_events where profile_id = ${a.id}`, []);
  });

  it("keeps a reported thread, and keeps a suspended member out afterwards", async () => {
    const [a, b] = [await member("Rex"), await member("Sol")];
    const s = await post(b.id);
    const seat = await svc.bookSeat(sql, a.id, s.id);
    await legacyMessageFixture(a.id, seat.id, "so is this a date");
    const report = await safety.reportMember(sql, b.id, {
      reportedId: a.id,
      reason: "date_framing",
      bookingId: seat.id,
    });
    await safety.adminResolveReport(sql, ADMIN, report.id, { action: "suspend", note: "Date framing" });
    assert.equal((await svc.getMe(sql, a.id)).suspended?.reason, "Date framing");

    await safety.deleteAccount(sql, a.id);
    const kept = await sql`select 1 from messages where from_id = ${a.id} and booking_id = ${seat.id}`;
    assert.equal(kept.length, 1);
    await rejects(svc.ensureProfile(sql, { id: "fresh-id", name: "Rex", email: a.email.toUpperCase() }), 403);
  });
});

describe("admin", () => {
  it("counts only a verified allow-listed email in production", () => {
    const env = { ADMIN_EMAILS: `${ADMIN}, second@samepace.app`, VERCEL_ENV: "production" };
    assert.equal(safety.isAdmin({ email: ADMIN, emailVerified: true }, env), true);
    assert.equal(safety.isAdmin({ email: "OPS@samepace.app", emailVerified: true }, env), true);
    assert.equal(safety.isAdmin({ email: ADMIN, emailVerified: false }, env), false);
    assert.equal(safety.isAdmin({ email: "x@example.com", emailVerified: true }, env), false);
    assert.equal(safety.isAdmin({ email: ADMIN, emailVerified: true }, { VERCEL_ENV: "production" }), false);
    assert.equal(safety.isAdmin({ email: ADMIN, emailVerified: false }, { ADMIN_EMAILS: ADMIN }), true);
  });

  it("suspending clears the calendar; removing a listing releases its seats", async () => {
    const [a, b] = [await member("Tia"), await member("Uma")];
    const s = await post(a.id);
    const seat = await svc.bookSeat(sql, b.id, s.id);
    await safety.adminSuspend(sql, ADMIN, a.id, "Harassment");
    assert.equal((await svc.getBooking(sql, b.id, seat.id)).status, "cancelled");
    assert.ok(!(await visibleTo(b.id)).includes(s.id));
    const m = await safety.adminGetMember(sql, a.id);
    assert.equal(m.suspended?.reason, "Harassment");
    assert.equal(m.upcomingSessions, 0);

    await safety.adminUnsuspend(sql, ADMIN, a.id);
    assert.equal((await svc.getMe(sql, a.id)).suspended, null);

    const s2 = await post(a.id);
    const seat2 = await svc.bookSeat(sql, b.id, s2.id);
    const report = await safety.reportMember(sql, b.id, {
      reportedId: a.id,
      reason: "misrepresented",
      sessionId: s2.id,
    });
    await safety.adminResolveReport(sql, ADMIN, report.id, { action: "remove_session", note: "Not a workout" });
    assert.equal((await svc.getBooking(sql, b.id, seat2.id)).status, "cancelled");
    await rejects(safety.adminResolveReport(sql, ADMIN, report.id, { action: "dismiss" }), 409);

    const actions = (await safety.adminListActions(sql)).map((x) => x.action);
    for (const expected of ["suspend", "unsuspend", "remove_session", "report_remove_session"]) {
      assert.ok(actions.includes(expected), expected);
    }
    assert.equal((await safety.adminSearchMembers(sql, "tia"))[0]?.person.id, a.id);
    assert.ok((await safety.adminOverview(sql)).members > 0);
  });
});
