/**
 * Service-layer integration tests against a real (embedded) Postgres with the
 * shipped migrations applied — the SQL is what's under test, not a mock.
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import * as svc from "./service.server.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const KATY = { lat: 32.8019, lng: -96.8074 };

function wrap(q: { query: PGlite["query"] }, transaction: Sql["transaction"]): Sql {
  const run = async <T>(text: string, params: unknown[] = []) =>
    (await q.query<T>(text, params)).rows;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  }) as unknown as Sql;
  sql.query = run as Sql["query"];
  sql.transaction = transaction;
  return sql;
}

async function makeDb(): Promise<Sql> {
  const pg = new PGlite({ parsers: { 20: Number } });
  const dir = join(import.meta.dirname, "../../../migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(dir, f), "utf8"));
  }
  return wrap(pg, (fn) =>
    pg.transaction((tx) => {
      const inner: Sql = wrap(tx as unknown as PGlite, (f) => f(inner));
      return fn(inner);
    }),
  );
}

let sql: Sql;
const user = (id: string, name: string) => svc.ensureProfile(sql, { id, name, email: null });

const RUN = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 } as const;

const listing = (patch: Partial<svc.PostSessionInput> = {}): svc.PostSessionInput => ({
  venueId: "katy",
  activity: "run",
  title: "Easy miles I’m doing anyway",
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

const ledgerFor = async (profileId: string) =>
  (
    await sql<{ kind: string; amount_cents: number; status: string }>`
      select kind, amount_cents, status from ledger_events where profile_id = ${profileId}
      order by created_at, kind`
  ).map((r) => `${r.kind}:${r.amount_cents}:${r.status}`);

// Post for 31 min out (the minimum), then move the clock instead of the row.
const soon = () => new Date(Date.now() + 31 * MIN).toISOString();
const inWindow = () => Date.now() + 25 * MIN;

before(async () => {
  sql = await makeDb();
  await user("host", "Maya Chen");
  await user("ann", "Ann Lee");
  await user("bob", "Bob Ray");
});

describe("posting + discovery", () => {
  it("creates a profile once, with a handle and initials", async () => {
    const me = await user("host", "Someone Else");
    assert.equal(me.name, "Maya Chen");
    assert.equal(me.initials, "MC");
    assert.equal(me.freeSessionsLeft, 2);
  });

  it("requires a level, and labels it on the card", async () => {
    await rejects(
      svc.postSession(sql, "host", listing({ ability: undefined as never })),
      400,
      /level/,
    );
    await rejects(svc.postSession(sql, "host", listing({ venueId: "nope" })), 400);
    const s = await svc.postSession(sql, "host", listing());
    assert.equal(s.abilityLabel, "9:30–10:00 /mi · 5 mi");
    assert.match(s.code ?? "", /^\d{4}$/);
  });

  it("hides the code and the exact pin from strangers, and says whether it fits them", async () => {
    const s = await svc.postSession(sql, "host", listing());
    const before = (await svc.listPublicSessions(sql, "ann")).sessions.find((x) => x.id === s.id)!;
    assert.equal(before.code, null);
    assert.equal(before.pinHint, null);
    assert.equal(before.seatsLeft, 1);
    assert.equal(before.fitsMe, null, "no level set yet — nothing is hidden");
    await svc.updateProfile(sql, "ann", { abilities: { run: { paceMinSec: 420, paceMaxSec: 480 } } });
    const fast = (await svc.listPublicSessions(sql, "ann")).sessions.find((x) => x.id === s.id)!;
    assert.equal(fast.fitsMe, false);
    await svc.updateProfile(sql, "ann", { abilities: { hike: { difficulty: "easy" } } });
    const me = await svc.getMe(sql, "ann");
    assert.deepEqual(Object.keys(me.abilities).sort(), ["hike", "run"], "levels merge per activity");
    await svc.updateProfile(sql, "ann", { abilities: { run: { paceMinSec: 560, paceMaxSec: 620 } } });
    const fits = (await svc.listPublicSessions(sql, "ann")).sessions.find((x) => x.id === s.id)!;
    assert.equal(fits.fitsMe, true);
  });

  it("keeps unlisted sessions out of discovery and behind the invite link", async () => {
    const s = await svc.postSession(sql, "host", listing({ visibility: "unlisted" }));
    assert.ok(s.inviteCode);
    const { sessions } = await svc.listPublicSessions(sql, "ann");
    assert.equal(sessions.some((x) => x.id === s.id), false);
    await rejects(svc.getSession(sql, "ann", s.id), 404);
    await rejects(svc.bookSeat(sql, "ann", s.id), 404);
    await rejects(svc.getSession(sql, "ann", s.id, { inviteCode: "wrong" }), 404);
    const viaLink = await svc.getSession(sql, "ann", s.id, { inviteCode: s.inviteCode });
    assert.equal(viaLink.session.pinHint, null, "the link shows the session, not the pin");
    const invited = await svc.getInvite(sql, "ann", s.inviteCode!);
    assert.ok("session" in invited);
    assert.equal(invited.session.inviteCode, undefined);
    const b = await svc.bookSeat(sql, "ann", s.id, { inviteCode: s.inviteCode });
    assert.equal(b.status, "confirmed");
    assert.ok((await svc.getSession(sql, "ann", s.id)).session.pinHint);
  });

  it("shows women-only sessions only to the members they are open to", async () => {
    await user("priya", "Priya N");
    await rejects(svc.postSession(sql, "priya", listing({ womenOnly: true })), 400, /women/i);
    await svc.updateProfile(sql, "priya", { gender: "woman" });
    const s = await svc.postSession(sql, "priya", listing({ womenOnly: true }));
    const seenBy = async (id: string) =>
      (await svc.listPublicSessions(sql, id)).sessions.some((x) => x.id === s.id);
    assert.equal(await seenBy("bob"), false);
    await rejects(svc.bookSeat(sql, "bob", s.id), 409, /women-only/);
    await svc.updateProfile(sql, "ann", { gender: "woman" });
    assert.equal(await seenBy("ann"), true);
    assert.equal((await svc.bookSeat(sql, "ann", s.id)).status, "confirmed");
  });
});

describe("joining", () => {
  it("holds an instant seat, unlocks the pin, and never double-books", async () => {
    const s = await svc.postSession(sql, "host", listing());
    const b = await svc.bookSeat(sql, "ann", s.id);
    assert.equal(b.status, "confirmed");
    assert.ok((await svc.getSession(sql, "ann", s.id)).session.pinHint);
    await rejects(svc.bookSeat(sql, "ann", s.id), 409, /already/);
    await rejects(svc.bookSeat(sql, "bob", s.id), 409, /full/);
    await rejects(svc.bookSeat(sql, "host", s.id), 409, /posted/);
    assert.equal((await svc.listMessages(sql, "ann", b.id)).length, 0);
    await rejects(svc.listMessages(sql, "bob", b.id), 404);
    assert.deepEqual(await ledgerFor("ann"), [], "joining costs nothing");
  });

  it("never oversells under concurrent requests", async () => {
    const s = await svc.postSession(sql, "host", listing({ capacity: 3 }));
    for (const id of ["c1", "c2", "c3", "c4"]) await user(id, `Member ${id}`);
    const results = await Promise.allSettled(
      ["c1", "c2", "c3", "c4"].map((id) => svc.bookSeat(sql, id, s.id)),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  });

  it("approve mode: only the poster approves or declines", async () => {
    const s = await svc.postSession(sql, "host", listing({ joinMode: "approve" }));
    const b = await svc.bookSeat(sql, "ann", s.id);
    assert.equal(b.status, "pending");
    assert.equal((await svc.getSession(sql, "ann", s.id)).session.pinHint, null);
    await rejects(svc.approveBooking(sql, "ann", b.id), 403);
    assert.equal((await svc.approveBooking(sql, "host", b.id)).status, "confirmed");
    await rejects(svc.declineBooking(sql, "host", b.id), 409);
  });

  it("cancelling is free 12h+ ahead, and $5 inside 12h unless someone covers the seat", async () => {
    await user("dee", "Dee Late");
    await user("sub", "Sub Stitute");
    const far = await svc.postSession(sql, "host", listing());
    const b1 = await svc.bookSeat(sql, "dee", far.id);
    assert.equal((await svc.cancelBooking(sql, "dee", b1.id)).status, "cancelled");
    assert.deepEqual(await ledgerFor("dee"), []);
    assert.equal((await svc.bookSeat(sql, "dee", far.id)).status, "confirmed", "seat reopens");

    const near = await svc.postSession(
      sql,
      "host",
      listing({ startAt: new Date(Date.now() + 2 * HOUR).toISOString() }),
    );
    const b2 = await svc.bookSeat(sql, "dee", near.id);
    const late = await svc.cancelBooking(sql, "dee", b2.id);
    assert.equal(late.status, "late_cancel");
    assert.equal(late.myFeeCents, 500);
    await rejects(svc.cancelBooking(sql, "ann", b2.id), 403);

    // A substitute takes the seat: the late cancel is Covered and costs nothing.
    await svc.bookSeat(sql, "sub", near.id);
    const covered = await svc.getBooking(sql, "dee", b2.id);
    assert.equal(covered.status, "covered");
    assert.equal(covered.myFeeCents, 0);
    assert.deepEqual(await ledgerFor("dee"), ["late_cancel_fee:500:waived"]);
  });

  it("the poster pays the same $5 for calling it off late; early is free", async () => {
    await user("pat", "Pat Poster");
    const early = await svc.postSession(sql, "pat", listing());
    const b = await svc.bookSeat(sql, "bob", early.id);
    await rejects(svc.cancelSession(sql, "bob", early.id), 404);
    await svc.cancelSession(sql, "pat", early.id);
    assert.equal((await svc.getBooking(sql, "bob", b.id)).status, "cancelled");
    assert.deepEqual(await ledgerFor("pat"), []);

    const late = await svc.postSession(
      sql,
      "pat",
      listing({ startAt: new Date(Date.now() + 2 * HOUR).toISOString() }),
    );
    await svc.bookSeat(sql, "bob", late.id);
    await svc.cancelSession(sql, "pat", late.id);
    assert.deepEqual(await ledgerFor("pat"), ["late_cancel_fee:500:assessed"]);
    assert.deepEqual(await ledgerFor("bob"), [], "the joiner owes nothing");
  });
});

describe("check-in + settlement", () => {
  it("inherits the host's earlier arrival for a late instant join", async () => {
    for (const id of ["lateHost", "earlyJoiner", "lateJoiner"]) await user(id, id);
    const start = Date.now() + 31 * MIN;
    const s = await svc.postSession(sql, "lateHost", listing({
      capacity: 3, startAt: new Date(start).toISOString(),
    }));
    const early = await svc.bookSeat(sql, "earlyJoiner", s.id);
    await svc.checkInGeo(sql, "lateHost", early.id, KATY, start - 19 * MIN);
    const late = await svc.bookSeat(sql, "lateJoiner", s.id, {}, start - 10 * MIN);
    assert.equal(late.hostCheckedInAt, new Date(start - 19 * MIN).toISOString());
    await svc.checkInGeo(sql, "earlyJoiner", early.id, KATY, start);
    await svc.checkInGeo(sql, "lateJoiner", late.id, KATY, start);
    await svc.settleDue(sql, start + 26 * MIN);
    for (const seat of [early, late]) {
      assert.equal((await svc.getBooking(sql, "lateHost", seat.id)).status, "completed");
    }
    const host = await svc.getMe(sql, "lateHost");
    assert.equal(host.completedCount, 1, "a group workout consumes only one host session");
    assert.equal(host.strikes, 0);
    assert.equal(host.feesCents, 0);
    assert.equal((await svc.getMe(sql, "lateJoiner")).completedCount, 1);
  });

  it("inherits host attendance when a pending seat is approved after arrival", async () => {
    for (const id of ["approveHost", "approveFirst", "approveLater"]) await user(id, id);
    const start = Date.now() + 31 * MIN;
    const s = await svc.postSession(sql, "approveHost", listing({
      capacity: 3, joinMode: "approve", startAt: new Date(start).toISOString(),
    }));
    const first = await svc.bookSeat(sql, "approveFirst", s.id);
    const later = await svc.bookSeat(sql, "approveLater", s.id);
    await svc.approveBooking(sql, "approveHost", first.id);
    await svc.checkInGeo(sql, "approveHost", first.id, KATY, start - 19 * MIN);
    await svc.checkInGeo(sql, "approveFirst", first.id, KATY, start - 18 * MIN);
    const approved = await svc.approveBooking(sql, "approveHost", later.id, start - 10 * MIN);
    assert.ok(approved.hostCheckedInAt);
    const done = await svc.checkInGeo(sql, "approveLater", later.id, KATY, start);
    assert.equal(done.status, "completed");
    assert.equal((await svc.getMe(sql, "approveHost")).completedCount, 1);
  });

  it("accepts legacy booking-only attendance written during a rolling deployment", async () => {
    for (const id of ["rollingHost", "rollingFirst", "rollingLater"]) await user(id, id);
    const start = Date.now() + 31 * MIN;
    const s = await svc.postSession(sql, "rollingHost", listing({
      capacity: 3, startAt: new Date(start).toISOString(),
    }));
    const first = await svc.bookSeat(sql, "rollingFirst", s.id);
    // Old code can still write a booking check-in after the migration ran.
    await sql`
      update bookings set host_checked_in_at = ${new Date(start - 19 * MIN).toISOString()}
      where id = ${first.id}`;
    const later = await svc.bookSeat(sql, "rollingLater", s.id, {}, start - 10 * MIN);
    assert.equal(later.hostCheckedInAt, new Date(start - 19 * MIN).toISOString());
    assert.equal((await svc.checkInGeo(sql, "rollingFirst", first.id, KATY, start)).status, "completed");
    assert.equal((await svc.checkInGeo(sql, "rollingLater", later.id, KATY, start)).status, "completed");
    assert.equal((await svc.getMe(sql, "rollingHost")).completedCount, 1);
    assert.equal((await svc.getMe(sql, "rollingHost")).feesCents, 0);
  });

  it("assesses one host fee and strike per missed group session, crediting every present joiner", async () => {
    for (const id of ["absentGroupHost", "groupAnn", "groupBob"]) await user(id, id);
    const start = Date.now() + 31 * MIN;
    const s = await svc.postSession(sql, "absentGroupHost", listing({
      capacity: 3, startAt: new Date(start).toISOString(),
    }));
    const seats = [];
    for (const id of ["groupAnn", "groupBob"]) {
      const seat = await svc.bookSeat(sql, id, s.id);
      await svc.checkInGeo(sql, id, seat.id, KATY, start);
      seats.push(seat);
    }
    await svc.settleDue(sql, start + 26 * MIN);
    await svc.settleDue(sql, start + 26 * MIN);
    const host = await svc.getMe(sql, "absentGroupHost");
    assert.equal(host.feesCents, 1000);
    assert.equal(host.strikes, 1);
    assert.equal(host.frozenUntil, null);
    for (const seat of seats) {
      assert.equal((await svc.getBooking(sql, seat.participantId, seat.id)).status, "host_no_show");
      assert.equal((await svc.getMe(sql, seat.participantId)).creditCents, 500);
    }
    const notices = await sql`
      select 1 from notifications where profile_id = 'absentGroupHost' and kind = 'no_show'`;
    assert.equal(notices.length, 1);
  });

  it("recognizes a legacy booking-linked host fee when settling the rest of a group", async () => {
    for (const id of ["legacyHost", "legacyAnn", "legacyBob"]) await user(id, id);
    const start = Date.now() + 31 * MIN;
    const s = await svc.postSession(sql, "legacyHost", listing({
      capacity: 3, startAt: new Date(start).toISOString(),
    }));
    const first = await svc.bookSeat(sql, "legacyAnn", s.id);
    const second = await svc.bookSeat(sql, "legacyBob", s.id);
    await sql`update bookings set status = 'host_no_show' where id = ${first.id}`;
    await sql`
      insert into ledger_events (id, profile_id, booking_id, kind, amount_cents)
      values ('legacy-fee', 'legacyHost', ${first.id}, 'no_show_fee', 1000)`;
    await sql`
      insert into strikes (id, profile_id, booking_id)
      values ('legacy-strike', 'legacyHost', ${first.id})`;
    await svc.checkInGeo(sql, "legacyBob", second.id, KATY, start);
    await svc.settleDue(sql, start + 26 * MIN);
    assert.equal((await svc.getMe(sql, "legacyHost")).feesCents, 1000);
    assert.equal((await svc.getMe(sql, "legacyHost")).strikes, 1);
    assert.equal((await svc.getMe(sql, "legacyBob")).creditCents, 500);
  });

  it("both check in: nothing is charged, both profiles complete, ratings land", async () => {
    await user("h2", "Jordan Post");
    await user("p2", "Pat Join");
    const s = await svc.postSession(sql, "h2", listing({ startAt: soon() }));
    const b = await svc.bookSeat(sql, "p2", s.id);
    await rejects(svc.checkInGeo(sql, "p2", b.id, KATY, Date.now()), 409, /window/);
    const now = inWindow();
    await rejects(svc.checkInGeo(sql, "p2", b.id, { lat: 32.8332, lng: -96.7281 }, now), 409, /m out/);
    const half = await svc.checkInGeo(sql, "p2", b.id, KATY, now);
    assert.equal(half.status, "confirmed");
    const done = await svc.checkInGeo(sql, "h2", b.id, KATY, now);
    assert.equal(done.status, "completed");
    assert.deepEqual([...(await ledgerFor("h2")), ...(await ledgerFor("p2"))], []);
    const me = await svc.getMe(sql, "p2");
    assert.equal(me.completedCount, 1);
    assert.equal(me.freeSessionsLeft, 1);

    const rating = { showedUp: true, onTime: false, matchedListing: true, respectful: true, wouldJoinAgain: true };
    await svc.submitRating(sql, "p2", b.id, rating);
    await rejects(svc.submitRating(sql, "p2", b.id, rating), 409);
    const [poster] = await svc.people(sql, ["h2"]);
    assert.equal(poster.onTimePct, 0);
    assert.equal(poster.wouldJoinPct, 100);
  });

  it("code fallback: poster-only reveal, rotating code, checks in both", async () => {
    await user("h3", "Sam Post");
    await user("p3", "Dev Join");
    const s = await svc.postSession(sql, "h3", listing({ startAt: soon() }));
    const b = await svc.bookSeat(sql, "p3", s.id);
    const now = inWindow();
    await rejects(svc.revealCode(sql, "p3", s.id, now), 404);
    await rejects(svc.checkInCode(sql, "p3", b.id, s.code!, now), 409, /revealed/);
    const first = await svc.revealCode(sql, "h3", s.id, now);
    const second = await svc.revealCode(sql, "h3", s.id, now);
    await rejects(svc.checkInCode(sql, "p3", b.id, "0000", now), 409, /match/);
    if (first.code !== second.code) {
      await rejects(svc.checkInCode(sql, "p3", b.id, first.code, now), 409, /match/);
    }
    await rejects(svc.checkInCode(sql, "p3", b.id, second.code, now + 11 * MIN), 409, /expired/);
    const done = await svc.checkInCode(sql, "p3", b.id, second.code, now);
    assert.equal(done.status, "completed");
    assert.equal(done.checkinMethod, "code");
    assert.ok(done.hostCheckedInAt);
  });

  it("a no-show costs the absent side $10 and a strike — poster or joiner alike", async () => {
    await user("flakyPoster", "Flaky Poster");
    await user("solid", "Solid Member");
    await user("flakyJoiner", "Flaky Joiner");
    const later = Date.now() + 2 * HOUR;

    const s1 = await svc.postSession(sql, "host", listing({ startAt: soon() }));
    const b1 = await svc.bookSeat(sql, "flakyJoiner", s1.id);
    await svc.checkInGeo(sql, "host", b1.id, KATY, inWindow());

    const s2 = await svc.postSession(sql, "flakyPoster", listing({ startAt: soon() }));
    const b2 = await svc.bookSeat(sql, "solid", s2.id);
    await svc.checkInGeo(sql, "solid", b2.id, KATY, inWindow());

    const s3 = await svc.postSession(sql, "host", listing({ startAt: soon() }));
    const b3 = await svc.bookSeat(sql, "solid", s3.id);
    const s4 = await svc.postSession(sql, "host", listing({ startAt: soon(), joinMode: "approve" }));
    const b4 = await svc.bookSeat(sql, "flakyJoiner", s4.id);

    await svc.settleDue(sql, later);
    assert.equal(await svc.settleDue(sql, later), 0, "idempotent");

    const joinerGone = await svc.getBooking(sql, "flakyJoiner", b1.id);
    assert.equal(joinerGone.status, "no_show");
    assert.equal(joinerGone.myFeeCents, 1000);
    assert.deepEqual(await ledgerFor("flakyJoiner"), ["no_show_fee:1000:assessed"]);

    assert.equal((await svc.getBooking(sql, "solid", b2.id)).status, "host_no_show");
    assert.deepEqual(await ledgerFor("flakyPoster"), ["no_show_fee:1000:assessed"]);
    assert.deepEqual(await ledgerFor("solid"), ["show_up_credit:500:assessed"]);
    const solid = await svc.getMe(sql, "solid");
    assert.equal(solid.creditCents, 500);
    assert.equal(solid.feesCents, 0);

    assert.equal((await svc.getBooking(sql, "solid", b3.id)).status, "void", "nobody came: no fee");
    assert.equal((await svc.getBooking(sql, "flakyJoiner", b4.id)).status, "declined");
    assert.equal((await svc.getMe(sql, "flakyJoiner")).strikes, 1);
  });

  it("two strikes in 60 days pause public sessions for 14 days — invites still work", async () => {
    const s = await svc.postSession(sql, "host", listing({ startAt: soon() }));
    const b = await svc.bookSeat(sql, "flakyJoiner", s.id);
    await svc.checkInGeo(sql, "host", b.id, KATY, inWindow());
    await svc.settleDue(sql, Date.now() + 2 * HOUR);

    const me = await svc.getMe(sql, "flakyJoiner");
    assert.equal(me.strikes, 2);
    assert.ok(me.frozenUntil);
    const open = await svc.postSession(sql, "host", listing());
    await rejects(svc.bookSeat(sql, "flakyJoiner", open.id), 409, /paused/);
    await rejects(svc.postSession(sql, "flakyJoiner", listing()), 400, /paused/);
    const invite = await svc.postSession(sql, "host", listing({ visibility: "unlisted" }));
    const seat = await svc.bookSeat(sql, "flakyJoiner", invite.id, { inviteCode: invite.inviteCode });
    assert.equal(seat.status, "confirmed");
  });
});

describe("standing slots", () => {
  const meet = async (poster: string, joiner: string) => {
    const s = await svc.postSession(sql, poster, listing({ startAt: soon() }));
    const b = await svc.bookSeat(sql, joiner, s.id);
    await svc.checkInGeo(sql, joiner, b.id, KATY, inWindow());
    await svc.checkInGeo(sql, poster, b.id, KATY, inWindow());
    return { s, b };
  };

  it("“same time next week” turns a completed session into a weekly slot", async () => {
    await user("maya", "Maya Reg");
    await user("dev", "Dev Reg");
    const open = await svc.postSession(sql, "maya", listing());
    const pending = await svc.bookSeat(sql, "dev", open.id);
    await rejects(svc.repeatWeekly(sql, "dev", pending.id), 409, /showed up/);

    const { s, b } = await meet("maya", "dev");
    await rejects(svc.repeatWeekly(sql, "bob", b.id), 404);
    const series = await svc.repeatWeekly(sql, "dev", b.id);
    assert.deepEqual(series.memberIds.sort(), ["dev", "maya"]);
    assert.ok(series.nextSessionId);
    const gap = new Date(series.nextStartAt!).getTime() - new Date(s.startAt).getTime();
    assert.ok(Math.abs(gap - 7 * 24 * HOUR) <= HOUR, "a week on, same wall-clock time");
    assert.equal((await svc.repeatWeekly(sql, "maya", b.id)).id, series.id, "one slot, not two");

    const mine = await svc.listMyBookings(sql, "dev");
    const nextSeat = mine.bookings.find((x) => x.sessionId === series.nextSessionId)!;
    assert.equal(nextSeat.status, "confirmed", "regulars are already in");
    assert.equal(mine.series.length, 1);
  });

  it("skipping a week opens a substitute seat; the regular keeps their place", async () => {
    await user("ria", "Ria Reg");
    await user("omar", "Omar Reg");
    await user("sub2", "Tess Sub");
    const { b } = await meet("ria", "omar");
    const series = await svc.repeatWeekly(sql, "ria", b.id);
    const next = series.nextSessionId!;
    const omarSeat = (await svc.listMyBookings(sql, "omar")).bookings.find((x) => x.sessionId === next)!;

    const before = (await svc.listPublicSessions(sql, "sub2")).sessions.find((x) => x.id === next)!;
    assert.equal(before.substituteSeat, false, "full slot: nothing to offer");
    assert.equal((await svc.cancelBooking(sql, "omar", omarSeat.id)).status, "cancelled");

    const offered = (await svc.listPublicSessions(sql, "sub2")).sessions.find((x) => x.id === next)!;
    assert.equal(offered.substituteSeat, true);
    const seat = await svc.bookSeat(sql, "sub2", next);
    assert.equal(seat.substituteFor, "omar");
    const after = await svc.listMySeries(sql, "omar");
    assert.equal(after.length, 1, "omar is still a regular");
    assert.equal((await svc.listMySeries(sql, "sub2")).length, 0, "a substitute joins one occurrence only");
  });

  it("closes an entirely skipped occurrence and schedules the following week once", async () => {
    await user("skipHost", "Skip Host");
    await user("skipRegular", "Skip Regular");
    const { b } = await meet("skipHost", "skipRegular");
    const series = await svc.repeatWeekly(sql, "skipHost", b.id);
    const start = new Date(series.nextStartAt!).getTime();
    const seat = (await svc.listMyBookings(sql, "skipRegular")).bookings.find(
      (x) => x.sessionId === series.nextSessionId,
    )!;
    await svc.cancelBooking(sql, "skipRegular", seat.id);
    await svc.settleDue(sql, start + 26 * MIN);
    const [rolled] = await svc.listMySeries(sql, "skipHost", start + 26 * MIN);
    assert.ok(rolled.nextSessionId);
    assert.notEqual(rolled.nextSessionId, series.nextSessionId);
    assert.equal(rolled.streak, 0, "a skipped workout is not an attended occurrence");
    assert.equal((await svc.getSession(sql, "skipHost", series.nextSessionId!)).session.status, "completed");
    await svc.settleDue(sql, start + 26 * MIN);
    const [{ n }] = await sql<{ n: number }>`
      select count(*) as n from sessions where series_id = ${series.id} and status = 'open'`;
    assert.equal(Number(n), 1);
    assert.equal((await svc.getMe(sql, "skipHost")).feesCents, 0);
    assert.equal((await svc.getMe(sql, "skipRegular")).feesCents, 0);
  });

  it("stops automatic recurrence if any regular has become ineligible", async () => {
    await user("invalidHost", "Invalid Host");
    await user("invalidRegular", "Invalid Regular");
    const { b } = await meet("invalidHost", "invalidRegular");
    const series = await svc.repeatWeekly(sql, "invalidHost", b.id);
    // Simulate a legacy series missed by account withdrawal, to exercise the
    // defensive eligibility check at generation rather than only API cleanup.
    await sql`update profiles set suspended_at = now() where id = 'invalidRegular'`;
    const start = new Date(series.nextStartAt!).getTime();
    await svc.settleDue(sql, start + 26 * MIN);
    const [row] = await sql<{ status: string }>`select status from series where id = ${series.id}`;
    assert.equal(row.status, "ended");
    const future = await sql`
      select 1 from sessions where series_id = ${series.id} and status = 'open'`;
    assert.equal(future.length, 0);
  });

  it("rolls forward after each occurrence, keeps a streak, and ends when regulars leave", async () => {
    await user("kim", "Kim Reg");
    await user("lee", "Lee Reg");
    const { b } = await meet("kim", "lee");
    const series = await svc.repeatWeekly(sql, "kim", b.id);
    const startAt = new Date(series.nextStartAt!).getTime();
    const seat = (await svc.listMyBookings(sql, "lee")).bookings.find(
      (x) => x.sessionId === series.nextSessionId,
    )!;
    await svc.checkInGeo(sql, "lee", seat.id, KATY, startAt);
    await svc.checkInGeo(sql, "kim", seat.id, KATY, startAt);

    const [rolled] = await svc.listMySeries(sql, "kim", startAt);
    assert.equal(rolled.streak, 1);
    assert.notEqual(rolled.nextSessionId, series.nextSessionId);
    assert.ok(new Date(rolled.nextStartAt!).getTime() > startAt + 6 * 24 * HOUR);

    await rejects(svc.leaveSeries(sql, "bob", series.id), 404);
    await svc.leaveSeries(sql, "lee", series.id, startAt);
    assert.deepEqual(await svc.listMySeries(sql, "kim", startAt), [], "one person is not a slot");
    const gone = await svc.getSession(sql, "kim", rolled.nextSessionId!);
    assert.equal(gone.session.status, "cancelled");
  });
});

describe("read-only legacy chat", () => {
  it("preserves scoped history while disabling all direct-message writes", async () => {
    const s = await svc.postSession(sql, "host", listing());
    const b = await svc.bookSeat(sql, "bob", s.id);
    assert.equal(b.chatOpen, false);
    assert.deepEqual(await svc.listMessages(sql, "bob", b.id), []);
    await sql`insert into messages (id, booking_id, from_id, text)
      values ('historical-member-message', ${b.id}, 'bob', 'Historical member text')`;
    const before = await sql`select id from notifications`;
    await rejects(svc.sendMessage(sql, "ann", b.id, "hi"), 404);
    for (const text of ["Hello", "", "   "]) {
      await rejects(svc.sendMessage(sql, "bob", b.id, text), 409, /agents/);
    }
    await rejects(
      svc.sendMessage(sql, "host", b.id, "late", Date.now() + 50 * HOUR),
      409,
      /agents/,
    );
    const history = await svc.listMessages(sql, "bob", b.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].fromId, "bob");
    assert.equal(history[0].text, "Historical member text");
    assert.deepEqual(await sql`select id from notifications`, before);
    await rejects(svc.listMessages(sql, "ann", b.id), 404);
  });
});

describe("session attendance migration", () => {
  it("backfills arrival into the session and a legacy late seat, and is safe to rerun", async () => {
    const pg = new PGlite({ parsers: { 20: Number } });
    try {
      const dir = join(import.meta.dirname, "../../../migrations");
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql") && x < "0011").sort()) {
        await pg.exec(readFileSync(join(dir, f), "utf8"));
      }
      await pg.exec(`
        insert into profiles (id, name, handle, initials) values
          ('migration-host', 'Host', 'migration-host', 'H'),
          ('migration-first', 'First', 'migration-first', 'F'),
          ('migration-second', 'Second', 'migration-second', 'S');
        insert into sessions (id, host_id, venue_id, activity, title, ability, start_at,
          duration_min, capacity, visibility, join_mode, code)
        values ('migration-session', 'migration-host', 'katy', 'run', 'Legacy group',
          '{"kind":"run","paceMinSec":570,"paceMaxSec":600,"miles":5}',
          '2030-01-01T12:00:00Z', 40, 3, 'public', 'instant', '1234');
        insert into bookings (id, session_id, participant_id, status, host_checked_in_at)
        values ('migration-first-seat', 'migration-session', 'migration-first', 'confirmed', '2030-01-01T11:41:00Z'),
          ('migration-second-seat', 'migration-session', 'migration-second', 'confirmed', null);
      `);
      const migration = readFileSync(join(dir, "0011_session_attendance.sql"), "utf8");
      await pg.exec(migration);
      await pg.exec(migration);
      const { rows } = await pg.query<{ host_checked_in_at: Date }>(
        `select host_checked_in_at from sessions where id = 'migration-session'
         union all select host_checked_in_at from bookings where session_id = 'migration-session'`,
      );
      assert.equal(rows.length, 3);
      for (const row of rows) {
        assert.equal(new Date(row.host_checked_in_at).toISOString(), "2030-01-01T11:41:00.000Z");
      }
    } finally {
      await pg.close();
    }
  });
});
