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
    assert.equal((await svc.getInvite(sql, "ann", s.inviteCode!)).session.inviteCode, undefined);
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
    assert.equal((await svc.listMessages(sql, "ann", b.id)).length, 1);
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

describe("chat", () => {
  it("is booking-scoped and expires 24h after the session", async () => {
    const s = await svc.postSession(sql, "host", listing());
    const b = await svc.bookSeat(sql, "bob", s.id);
    const thread = await svc.sendMessage(sql, "bob", b.id, "  On my way.  ");
    assert.equal(thread.at(-1)?.text, "On my way.");
    await rejects(svc.sendMessage(sql, "ann", b.id, "hi"), 404);
    await rejects(svc.sendMessage(sql, "bob", b.id, "   "), 400);
    await rejects(svc.sendMessage(sql, "bob", b.id, "late", Date.now() + 50 * HOUR), 409, /expired/);
  });
});
