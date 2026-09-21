/** Notifications: what gets queued, who it's pushed to, and what happens when push fails. */
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import * as notify from "./notify.server.ts";
import * as svc from "./service.server.ts";
import { makeDb } from "./test-db.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const RUN = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 } as const;
const KATY = { lat: 32.8019, lng: -96.8074 };

let sql: Sql;
let n = 0;

async function member(name: string, device = true) {
  n += 1;
  const id = `n${n}_${name.toLowerCase()}`;
  await svc.ensureProfile(sql, { id, name: `${name} Test`, email: null });
  if (device) {
    await notify.registerDevice(sql, id, { token: `ExponentPushToken[${id}]`, platform: "ios" });
  }
  return id;
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

const kindsFor = async (profileId: string) =>
  (await notify.listNotifications(sql, profileId)).notifications.map((x) => x.kind);

/** A stand-in for Expo's push API that records what it was asked to send. */
function fakeExpo(reply?: (to: string) => object) {
  const sent: { to: string; title: string; body: string; data: { url: string | null } }[] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    const batch = JSON.parse(String(init.body)) as typeof sent;
    sent.push(...batch);
    return Response.json({
      data: batch.map(
        (m, i) => reply?.(m.to) ?? { status: "ok", id: `tkt_${crypto.randomUUID()}_${i}` },
      ),
    });
  };
  return { sent, fetch };
}

before(async () => {
  sql = await makeDb();
});

describe("what gets queued", () => {
  it("tells the poster about a join, and each side about what follows", async () => {
    const [host, joiner] = [await member("Ana"), await member("Ben")];
    const s = await post(host, { joinMode: "approve" });
    const seat = await svc.bookSeat(sql, joiner, s.id);
    assert.deepEqual(await kindsFor(host), ["seat_requested"]);

    await svc.approveBooking(sql, host, seat.id);
    assert.deepEqual(await kindsFor(joiner), ["seat_approved"]);

    await svc.sendMessage(sql, joiner, seat.id, "See you at the trailhead");
    const inbox = await notify.listNotifications(sql, host);
    assert.equal(inbox.notifications[0].kind, "message");
    assert.equal(inbox.notifications[0].title, "Ben", "first name only");
    assert.equal(inbox.notifications[0].url, `/thread/${seat.id}`);
    assert.equal(inbox.unread, 2);

    await svc.cancelBooking(sql, joiner, seat.id);
    assert.equal((await kindsFor(host))[0], "seat_cancelled");

    await notify.markAllRead(sql, host);
    assert.equal((await notify.listNotifications(sql, host)).unread, 0);
  });

  it("tells every seat when the poster calls it off", async () => {
    const [host, a, b] = [await member("Cy"), await member("Dee"), await member("Eli")];
    const s = await post(host, { capacity: 3 });
    await svc.bookSeat(sql, a, s.id);
    await svc.bookSeat(sql, b, s.id);
    await svc.cancelSession(sql, host, s.id);
    assert.ok((await kindsFor(a)).includes("session_cancelled"));
    assert.ok((await kindsFor(b)).includes("session_cancelled"));
  });

  it("a no-show hears about the fee; the one who came hears about the credit", async () => {
    const [host, joiner] = [await member("Fay"), await member("Gus")];
    const s = await post(host, { startAt: new Date(Date.now() + 31 * MIN).toISOString() });
    const seat = await svc.bookSeat(sql, joiner, s.id);
    await svc.checkInGeo(sql, host, seat.id, KATY, Date.now() + 25 * MIN);
    await svc.settleDue(sql, Date.now() + 2 * HOUR);
    assert.ok((await kindsFor(joiner)).includes("no_show"));
    assert.ok((await kindsFor(host)).includes("stood_up"));
  });

  it("reminds both sides once an hour out, and once when check-in opens", async () => {
    const [host, joiner] = [await member("Hal"), await member("Ida")];
    const startAt = Date.now() + 3 * HOUR;
    const s = await post(host, { startAt: new Date(startAt).toISOString() });
    await svc.bookSeat(sql, joiner, s.id);

    await notify.enqueueReminders(sql, startAt - 2 * HOUR);
    assert.ok(!(await kindsFor(joiner)).includes("starts_soon"), "too early");

    await notify.enqueueReminders(sql, startAt - 50 * MIN);
    await notify.enqueueReminders(sql, startAt - 40 * MIN);
    assert.equal((await kindsFor(joiner)).filter((k) => k === "starts_soon").length, 1);
    assert.equal((await kindsFor(host)).filter((k) => k === "starts_soon").length, 1);

    await notify.enqueueReminders(sql, startAt - 10 * MIN);
    await notify.enqueueReminders(sql, startAt + 5 * MIN);
    assert.equal((await kindsFor(joiner)).filter((k) => k === "checkin_open").length, 1);
  });

  it("offers a skipped standing-slot seat to members at that level who show up", async () => {
    const [host, regular] = [await member("Jo"), await member("Kai")];
    const s = await post(host, { startAt: new Date(Date.now() + 31 * MIN).toISOString() });
    const seat = await svc.bookSeat(sql, regular, s.id);
    const inWindow = Date.now() + 25 * MIN;
    await svc.checkInGeo(sql, regular, seat.id, KATY, inWindow);
    await svc.checkInGeo(sql, host, seat.id, KATY, inWindow);
    const series = await svc.repeatWeekly(sql, regular, seat.id);

    const fits = await member("Lu");
    const tooFast = await member("Mo");
    const unproven = await member("Ny");
    const noDevice = await member("Oz", false);
    await svc.updateProfile(sql, fits, {
      abilities: { run: { paceMinSec: 560, paceMaxSec: 620 } },
    });
    await svc.updateProfile(sql, tooFast, {
      abilities: { run: { paceMinSec: 360, paceMaxSec: 400 } },
    });
    await svc.updateProfile(sql, unproven, {
      abilities: { run: { paceMinSec: 560, paceMaxSec: 620 } },
    });
    await svc.updateProfile(sql, noDevice, {
      abilities: { run: { paceMinSec: 560, paceMaxSec: 620 } },
    });
    await sql.query("update profiles set completed_count = 3 where id = any($1)", [
      [fits, tooFast, noDevice],
    ]);

    const mine = await svc.listMyBookings(sql, regular);
    const next = mine.bookings.find((b) => b.sessionId === series.nextSessionId)!;
    await svc.cancelBooking(sql, regular, next.id);

    assert.ok((await kindsFor(fits)).includes("substitute_offer"));
    for (const id of [tooFast, unproven, noDevice, host, regular]) {
      assert.ok(!(await kindsFor(id)).includes("substitute_offer"), id);
    }
  });
});

describe("delivery", () => {
  it("pushes to the member's devices, honours muted kinds, and never sends twice", async () => {
    const [host, joiner] = [await member("Pia"), await member("Quin")];
    await notify.deliverDue(sql, { fetch: fakeExpo().fetch }); // drain earlier tests
    await svc.updateProfile(sql, host, { notify: { messages: false } });
    const s = await post(host);
    const seat = await svc.bookSeat(sql, joiner, s.id);
    await svc.sendMessage(sql, joiner, seat.id, "hello");

    const expo = fakeExpo();
    const first = await notify.deliverDue(sql, { fetch: expo.fetch });
    assert.equal(first.sent, 1);
    assert.equal(expo.sent[0].to, `ExponentPushToken[${host}]`);
    assert.equal(expo.sent[0].title, "Quin is in");
    assert.equal(expo.sent[0].data.url, `/thread/${seat.id}`);
    // Muted for push, still in the activity list.
    assert.ok((await kindsFor(host)).includes("message"));

    assert.deepEqual(await notify.deliverDue(sql, { fetch: expo.fetch }), { sent: 0, failed: 0 });
    assert.equal(expo.sent.length, 1);
  });

  it("retries when Expo is down, and gives up after three tries", async () => {
    const [host, joiner] = [await member("Rex"), await member("Sol")];
    const s = await post(host);
    await svc.bookSeat(sql, joiner, s.id);
    const down = async () => {
      throw new Error("network");
    };
    const now = Date.now();
    for (const offset of [0, MIN, 3 * MIN]) {
      assert.equal((await notify.deliverDue(sql, { fetch: down, now: now + offset })).failed, 1);
      assert.equal(
        (await notify.deliverDue(sql, { fetch: down, now: now + offset })).failed,
        0,
        "backoff",
      );
    }
    const expo = fakeExpo();
    assert.equal((await notify.deliverDue(sql, { fetch: expo.fetch, now: now + HOUR })).sent, 0);
  });

  it("stops sending to a device the push service says is gone", async () => {
    const [host, joiner] = [await member("Tia"), await member("Uma")];
    const s = await post(host);
    await svc.bookSeat(sql, joiner, s.id);
    const dead = fakeExpo(() => ({ status: "error", details: { error: "DeviceNotRegistered" } }));
    assert.equal((await notify.deliverDue(sql, { fetch: dead.fetch })).failed, 1);

    await svc.sendMessage(
      sql,
      joiner,
      (await svc.listMyBookings(sql, joiner)).bookings[0].id,
      "hi",
    );
    const expo = fakeExpo();
    assert.equal((await notify.deliverDue(sql, { fetch: expo.fetch })).sent, 0);

    // Signing in again on that phone brings it back.
    await notify.registerDevice(sql, host, {
      token: `ExponentPushToken[${host}]`,
      platform: "ios",
    });
    await svc.sendMessage(
      sql,
      joiner,
      (await svc.listMyBookings(sql, joiner)).bookings[0].id,
      "again",
    );
    assert.equal((await notify.deliverDue(sql, { fetch: expo.fetch })).sent, 1);
  });

  it("reads receipts and retires tokens reported dead later", async () => {
    const owner = await member("Vic");
    const token = `ExponentPushToken[${owner}]`;
    await sql`insert into push_tickets (id, token, created_at, next_check_at)
      values ('tkt_old', ${token}, now() - interval '20 minutes', now() - interval '5 minutes')`;
    const fetch = async () =>
      Response.json({
        data: { tkt_old: { status: "error", details: { error: "DeviceNotRegistered" } } },
      });
    assert.equal(await notify.checkReceipts(sql, { fetch }), 1);
    const [d] = await sql<{ disabled_at: Date | null }>`
      select disabled_at from push_devices where token = ${token}`;
    assert.ok(d.disabled_at);
    assert.deepEqual(await sql`select 1 from push_tickets where id = 'tkt_old'`, []);
  });

  it("a phone that changes accounts takes its token with it", async () => {
    const [a, b] = [await member("Wes", false), await member("Xan", false)];
    const token = "ExponentPushToken[shared-phone]";
    await notify.registerDevice(sql, a, { token, platform: "android" });
    await notify.registerDevice(sql, b, { token, platform: "android" });
    const rows = await sql<{
      profile_id: string;
    }>`select profile_id from push_devices where token = ${token}`;
    assert.deepEqual(
      rows.map((r) => r.profile_id),
      [b],
    );
    await notify.removeDevice(sql, a, token);
    assert.equal(
      (await sql`select 1 from push_devices where token = ${token}`).length,
      1,
      "not yours to remove",
    );
  });

  it("only accepts Expo push tokens", () => {
    assert.ok(notify.isExpoToken("ExponentPushToken[abc-123]"));
    assert.ok(notify.isExpoToken("ExpoPushToken[abc]"));
    assert.ok(!notify.isExpoToken("https://evil.example/hook"));
  });
});

describe("durable device delivery", () => {
  let db: Sql;
  let now: number;
  let owner: string;
  let tokens: string[];
  before(async () => {
    db = await makeDb();
  });
  beforeEach(async () => {
    await db.query("truncate push_tickets, push_deliveries, notifications, push_devices");
    now = Date.now();
    owner = `delivery_${crypto.randomUUID()}`;
    await svc.ensureProfile(db, { id: owner, name: "Push Test", email: null });
    tokens = ["ExpoPushToken[first]", "ExpoPushToken[second]"];
    for (const token of tokens)
      await notify.registerDevice(db, owner, { token, platform: "ios" }, now);
  });
  const queue = () =>
    notify.enqueue(
      db,
      {
        profileId: owner,
        kind: "test",
        category: "messages",
        title: "Test",
        body: "Hello",
      },
      now,
    );

  it("chunks 102 expanded device messages into requests of 100 and 2", async () => {
    for (let i = 0; i < 51; i += 1) await queue();
    const lengths: number[] = [];
    const expo = fakeExpo();
    const fetch = async (url: string, init: RequestInit) => {
      lengths.push(JSON.parse(String(init.body)).length);
      return expo.fetch(url, init);
    };
    assert.deepEqual(await notify.deliverDue(db, { fetch, now }), { sent: 102, failed: 0 });
    assert.deepEqual(lengths, [100, 2]);
    assert.equal((await db`select 1 from push_tickets`).length, 102);
    assert.deepEqual(await notify.deliverDue(db, { fetch, now }), { sent: 0, failed: 0 });
  });

  for (const change of ["ownership", "preferences", "dead-device"] as const) {
    it(`rechecks ${change} changes between batches in one sweep`, async () => {
      for (let i = 0; i < 100; i += 1) await queue();
      // Keep device pairs adjacent so both devices deterministically have work
      // in each 100-message batch. Production expansion preserves these pairs.
      await db`
        insert into push_deliveries (id, notification_id, token, next_attempt_at)
        select 'ordered_' || lpad((row_number() over (order by n.id, d.token))::text, 4, '0'),
          n.id, d.token, ${new Date(now).toISOString()}
        from notifications n join push_devices d on d.profile_id = n.profile_id
        where n.profile_id = ${owner}`;
      const nextOwner = `batch_owner_${crypto.randomUUID()}`;
      if (change === "ownership")
        await svc.ensureProfile(db, { id: nextOwner, name: "Next member", email: null });
      let batches = 0;
      const laterTokens: string[] = [];
      const fetch = async (_url: string, init: RequestInit) => {
        const messages = JSON.parse(String(init.body)) as { to: string }[];
        batches += 1;
        if (batches === 1) {
          assert.equal(messages.length, 100);
          if (change === "ownership")
            await notify.registerDevice(db, nextOwner, { token: tokens[0], platform: "ios" });
          if (change === "preferences")
            await svc.updateProfile(db, owner, { notify: { messages: false } });
        } else laterTokens.push(...messages.map((m) => m.to));
        return Response.json({
          data: messages.map((m) =>
            change === "dead-device" && m.to === tokens[0]
              ? { status: "error", details: { error: "DeviceNotRegistered" } }
              : { status: "ok", id: `batch_${crypto.randomUUID()}` },
          ),
        });
      };
      await notify.deliverDue(db, { fetch, now });
      assert.deepEqual(
        laterTokens,
        change === "preferences" ? [] : Array.from({ length: 50 }, () => tokens[1]),
      );
      const [{ n: retired }] = await db<{ n: number }>`
        select count(*) as n from push_deliveries where last_error = 'RecipientUnavailable'`;
      assert.equal(Number(retired), change === "preferences" ? 100 : 50);
    });
  }

  it("retries only the failed device after a partial ticket response", async () => {
    await queue();
    const first = fakeExpo((to) =>
      to === tokens[1]
        ? { status: "error", details: { error: "MessageRateExceeded" } }
        : { status: "ok", id: "accepted-first-device" },
    );
    assert.deepEqual(await notify.deliverDue(db, { fetch: first.fetch, now }), {
      sent: 1,
      failed: 1,
    });
    const retry = fakeExpo();
    assert.deepEqual(await notify.deliverDue(db, { fetch: retry.fetch, now: now + MIN - 1 }), {
      sent: 0,
      failed: 0,
    });
    assert.deepEqual(await notify.deliverDue(db, { fetch: retry.fetch, now: now + MIN }), {
      sent: 1,
      failed: 0,
    });
    assert.deepEqual(
      retry.sent.map((m) => m.to),
      [tokens[1]],
    );
    assert.equal((await db`select 1 from push_tickets`).length, 2);
  });

  it("does not replay a successful chunk when a later chunk fails", async () => {
    for (let i = 0; i < 51; i += 1) await queue();
    const expo = fakeExpo();
    let calls = 0;
    const fetch = async (url: string, init: RequestInit) => {
      calls += 1;
      return calls === 2 ? new Response(null, { status: 503 }) : expo.fetch(url, init);
    };
    assert.deepEqual(await notify.deliverDue(db, { fetch, now }), { sent: 100, failed: 2 });
    const retry = fakeExpo();
    assert.deepEqual(await notify.deliverDue(db, { fetch: retry.fetch, now: now + MIN }), {
      sent: 2,
      failed: 0,
    });
    assert.equal((await db`select 1 from push_tickets`).length, 102);
  });

  it("retains missing receipts and failed lookups, then retires a dead device", async () => {
    await queue();
    await notify.deliverDue(db, { fetch: fakeExpo().fetch, now });
    const [first] = await db<{
      id: string;
    }>`select id from push_tickets where token = ${tokens[0]}`;
    let calls = 0;
    const down = async () => {
      calls += 1;
      throw new Error("temporary outage");
    };
    await notify.checkReceipts(db, { fetch: down, now: now + 15 * MIN });
    assert.equal((await db`select 1 from push_tickets`).length, 2);
    await notify.checkReceipts(db, { fetch: down, now: now + 15 * MIN + 1 });
    assert.equal(calls, 1, "receipt lookup backoff");
    await notify.checkReceipts(db, {
      fetch: async () => Response.json({ data: {} }),
      now: now + 20 * MIN,
    });
    assert.equal((await db`select 1 from push_tickets`).length, 2);
    const receipt = async () =>
      Response.json({
        data: {
          [first.id]: { status: "error", details: { error: "DeviceNotRegistered" } },
        },
      });
    assert.equal(await notify.checkReceipts(db, { fetch: receipt, now: now + 25 * MIN }), 1);
    assert.equal((await db`select 1 from push_tickets`).length, 1);
    const [device] = await db<{
      disabled_at: Date | null;
    }>`select disabled_at from push_devices where token = ${tokens[0]}`;
    assert.ok(device.disabled_at);
    assert.equal(
      (await notify.deliverDue(db, { fetch: fakeExpo().fetch, now: now + HOUR })).sent,
      0,
    );
  });

  it("backs off retryable receipt errors without replaying the successful device", async () => {
    await queue();
    await notify.deliverDue(db, { fetch: fakeExpo().fetch, now });
    const tickets = await db<{ id: string; token: string }>`select id, token from push_tickets`;
    const fetch = async () =>
      Response.json({
        data: Object.fromEntries(
          tickets.map((t) => [
            t.id,
            t.token === tokens[0]
              ? { status: "ok" }
              : { status: "error", details: { error: "MessageRateExceeded" } },
          ]),
        ),
      });
    await notify.checkReceipts(db, { fetch, now: now + 15 * MIN });
    assert.equal((await db`select 1 from push_tickets`).length, 0);
    const retry = fakeExpo();
    assert.equal(
      (await notify.deliverDue(db, { fetch: retry.fetch, now: now + 15 * MIN })).sent,
      0,
    );
    assert.equal(
      (await notify.deliverDue(db, { fetch: retry.fetch, now: now + 16 * MIN })).sent,
      1,
    );
    assert.deepEqual(
      retry.sent.map((m) => m.to),
      [tokens[1]],
    );
  });

  for (const staleResult of ["ok", "MessageRateExceeded", "DeviceNotRegistered"] as const) {
    it(`ignores a stale ${staleResult} receipt after another worker accepted the retry`, async () => {
      await notify.removeDevice(db, owner, tokens[1]);
      await queue();
      const expo = fakeExpo();
      await notify.deliverDue(db, { fetch: expo.fetch, now });
      const [old] = await db<{ id: string }>`select id from push_tickets`;
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const claimed = new Promise<void>((resolve) => {
        started = resolve;
      });
      const stale = notify.checkReceipts(db, {
        now: now + 15 * MIN,
        fetch: async () => {
          started();
          await gate;
          return Response.json({
            data: {
              [old.id]:
                staleResult === "ok"
                  ? { status: "ok" }
                  : { status: "error", details: { error: staleResult } },
            },
          });
        },
      });
      try {
        await claimed;
        // The first worker's lease expires; another worker handles the receipt
        // and the retry obtains its own accepted ticket before the first resumes.
        await notify.checkReceipts(db, {
          now: now + 20 * MIN,
          fetch: async () =>
            Response.json({
              data: { [old.id]: { status: "error", details: { error: "MessageRateExceeded" } } },
            }),
        });
        await notify.deliverDue(db, { fetch: expo.fetch, now: now + 21 * MIN });
        release();
        assert.equal(await stale, 0, "a stale receipt cannot retire the device");
        const [delivery] = await db<{ state: string; attempts: number }>`
          select state, attempts from push_deliveries`;
        assert.deepEqual(delivery, { state: "ticket", attempts: 2 });
        const [remaining] = await db<{ id: string }>`select id from push_tickets`;
        assert.ok(remaining && remaining.id !== old.id, "the new receipt remains unresolved");
        const [device] = await db<{ disabled_at: Date | null }>`
          select disabled_at from push_devices where token = ${tokens[0]}`;
        assert.equal(device.disabled_at, null);
        assert.deepEqual(await notify.deliverDue(db, { fetch: expo.fetch, now: now + 21 * MIN }), {
          sent: 0,
          failed: 0,
        });
        assert.equal(expo.sent.length, 2, "the accepted retry is never replayed");
      } finally {
        release();
        await stale;
      }
    });
  }

  it("never resends an unknown outcome when receipts expire", async () => {
    await queue();
    await notify.deliverDue(db, { fetch: fakeExpo().fetch, now });
    await notify.checkReceipts(db, {
      fetch: async () => assert.fail("expired"),
      now: now + 24 * HOUR,
    });
    assert.equal((await db`select 1 from push_tickets`).length, 0);
    assert.equal(
      (
        await db`select 1 from push_deliveries where state = 'failed' and last_error = 'ReceiptExpired'`
      ).length,
      2,
    );
    assert.equal(
      (await notify.deliverDue(db, { fetch: fakeExpo().fetch, now: now + 24 * HOUR })).sent,
      0,
    );
  });

  it("keeps concurrent workers from sending the same pending device", async () => {
    await queue();
    const expo = fakeExpo();
    const results = await Promise.all([
      notify.deliverDue(db, { fetch: expo.fetch, now }),
      notify.deliverDue(db, { fetch: expo.fetch, now }),
    ]);
    assert.equal(
      results.reduce((sum, result) => sum + result.sent, 0),
      2,
    );
    assert.equal(expo.sent.length, 2);
  });

  it("rechecks device ownership before retrying", async () => {
    await queue();
    await notify.deliverDue(db, { fetch: async () => new Response(null, { status: 503 }), now });
    const nextOwner = `new_${crypto.randomUUID()}`;
    await svc.ensureProfile(db, { id: nextOwner, name: "Other member", email: null });
    await notify.registerDevice(db, nextOwner, { token: tokens[0], platform: "ios" });
    const retry = fakeExpo();
    await notify.deliverDue(db, { fetch: retry.fetch, now: now + MIN });
    assert.deepEqual(
      retry.sent.map((m) => m.to),
      [tokens[1]],
    );
  });
});
