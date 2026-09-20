/** Notifications: what gets queued, who it's pushed to, and what happens when push fails. */
import { before, describe, it } from "node:test";
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
      data: batch.map((m, i) => reply?.(m.to) ?? { status: "ok", id: `tkt_${sent.length}_${i}` }),
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
    await svc.updateProfile(sql, fits, { abilities: { run: { paceMinSec: 560, paceMaxSec: 620 } } });
    await svc.updateProfile(sql, tooFast, { abilities: { run: { paceMinSec: 360, paceMaxSec: 400 } } });
    await svc.updateProfile(sql, unproven, { abilities: { run: { paceMinSec: 560, paceMaxSec: 620 } } });
    await svc.updateProfile(sql, noDevice, { abilities: { run: { paceMinSec: 560, paceMaxSec: 620 } } });
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
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await notify.deliverDue(sql, { fetch: down })).failed, 1);
    }
    const expo = fakeExpo();
    assert.equal((await notify.deliverDue(sql, { fetch: expo.fetch })).sent, 0);
  });

  it("stops sending to a device the push service says is gone", async () => {
    const [host, joiner] = [await member("Tia"), await member("Uma")];
    const s = await post(host);
    await svc.bookSeat(sql, joiner, s.id);
    const dead = fakeExpo(() => ({ status: "error", details: { error: "DeviceNotRegistered" } }));
    assert.equal((await notify.deliverDue(sql, { fetch: dead.fetch })).failed, 1);

    await svc.sendMessage(sql, joiner, (await svc.listMyBookings(sql, joiner)).bookings[0].id, "hi");
    const expo = fakeExpo();
    assert.equal((await notify.deliverDue(sql, { fetch: expo.fetch })).sent, 0);

    // Signing in again on that phone brings it back.
    await notify.registerDevice(sql, host, { token: `ExponentPushToken[${host}]`, platform: "ios" });
    await svc.sendMessage(sql, joiner, (await svc.listMyBookings(sql, joiner)).bookings[0].id, "again");
    assert.equal((await notify.deliverDue(sql, { fetch: expo.fetch })).sent, 1);
  });

  it("reads receipts and retires tokens reported dead later", async () => {
    const owner = await member("Vic");
    const token = `ExponentPushToken[${owner}]`;
    await sql`insert into push_tickets (id, token, created_at) values ('tkt_old', ${token}, now() - interval '20 minutes')`;
    const fetch = async () =>
      Response.json({ data: { tkt_old: { status: "error", details: { error: "DeviceNotRegistered" } } } });
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
    const rows = await sql<{ profile_id: string }>`select profile_id from push_devices where token = ${token}`;
    assert.deepEqual(rows.map((r) => r.profile_id), [b]);
    await notify.removeDevice(sql, a, token);
    assert.equal((await sql`select 1 from push_devices where token = ${token}`).length, 1, "not yours to remove");
  });

  it("only accepts Expo push tokens", () => {
    assert.ok(notify.isExpoToken("ExponentPushToken[abc-123]"));
    assert.ok(notify.isExpoToken("ExpoPushToken[abc]"));
    assert.ok(!notify.isExpoToken("https://evil.example/hook"));
  });
});
