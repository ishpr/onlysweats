/** Training blocks — goal, slots, kept out of planned, closing — against real SQL. */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { clusterDate } from "./rules.ts";
import * as safety from "./safety.server.ts";
import * as svc from "./service.server.ts";
import { makeDb } from "./test-db.ts";
import { listNotifications } from "./notify.server.ts";
import * as blocks from "./training-blocks.server.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KATY = { lat: 32.8019, lng: -96.8074 };
const RUN = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 } as const;

let sql: Sql;
let n = 0;

async function member(name: string) {
  n += 1;
  const id = `u${n}_${name.toLowerCase()}`;
  await svc.ensureProfile(sql, { id, name, email: null });
  return id;
}

const rejects = (p: Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof svc.PaceError, String(err));
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });

const daysOut = (days: number) => clusterDate(Date.now() + days * DAY);
/** After the founding session: the tests check in to it on a clock moved forward. */
const afterMeeting = () => Date.now() + 2 * HOUR;

/** Two members meet once, then make it a standing slot: what every block starts from. */
async function standingSlot(poster: string, joiner: string) {
  const s = await svc.postSession(sql, poster, {
    venueId: "katy",
    activity: "run",
    title: "Saturday long run",
    detail: "",
    ability: RUN,
    abilityFlex: "strict",
    startAt: new Date(Date.now() + 31 * MIN).toISOString(),
    durationMin: 60,
    capacity: 2,
    visibility: "public",
    joinMode: "instant",
    womenOnly: false,
  });
  const b = await svc.bookSeat(sql, joiner, s.id);
  await svc.checkInGeo(sql, joiner, b.id, KATY, Date.now() + 25 * MIN);
  await svc.checkInGeo(sql, poster, b.id, KATY, Date.now() + 25 * MIN);
  return svc.repeatWeekly(sql, poster, b.id);
}

type Week = "both" | "joiner_skips" | "poster_calls_off";

/** Play the slot's next occurrence. Returns the clock afterwards, or null if there is none. */
async function playWeek(
  seriesId: string,
  poster: string,
  joiner: string,
  clock: number,
  what: Week,
): Promise<number | null> {
  const slot = (await svc.listMySeries(sql, poster, clock)).find((x) => x.id === seriesId);
  if (!slot?.nextSessionId) return null;
  const startAt = new Date(slot.nextStartAt!).getTime();
  if (what === "poster_calls_off") {
    await svc.cancelSession(sql, poster, slot.nextSessionId, startAt - 13 * HOUR);
    return startAt - 12 * HOUR;
  }
  const seat = (await svc.listMyBookings(sql, joiner, clock)).bookings.find(
    (x) => x.sessionId === slot.nextSessionId && x.status === "confirmed",
  )!;
  if (what === "joiner_skips") {
    await svc.cancelBooking(sql, joiner, seat.id, startAt - 13 * HOUR);
    await svc.settleDue(sql, startAt + 26 * MIN);
  } else {
    await svc.checkInGeo(sql, joiner, seat.id, KATY, startAt);
    await svc.checkInGeo(sql, poster, seat.id, KATY, startAt);
  }
  return startAt + HOUR;
}

before(async () => {
  sql = await makeDb();
});

describe("starting a block", () => {
  it("gives a standing slot a goal and a date; its regulars become the members", async () => {
    const [kim, lee, out] = [await member("Kim"), await member("Lee"), await member("Out")];
    const slot = await standingSlot(kim, lee);
    const goal = { goalKind: "race_marathon", eventName: "Dallas Marathon", goalDate: daysOut(84) } as const;

    await rejects(blocks.blockFromSeries(sql, out, slot.id, goal, afterMeeting()), 404);
    await rejects(blocks.blockFromSeries(sql, kim, slot.id, { ...goal, goalDate: daysOut(20) }, afterMeeting()), 400, /4 weeks/);
    await rejects(blocks.blockFromSeries(sql, kim, slot.id, { ...goal, goalDate: daysOut(150) }, afterMeeting()), 400, /20 weeks/);
    await rejects(
      blocks.blockFromSeries(sql, kim, slot.id, { goalKind: "ride_century", goalDate: daysOut(84) }, afterMeeting()),
      400,
      /activity/,
    );

    const block = await blocks.blockFromSeries(sql, lee, slot.id, goal, afterMeeting());
    assert.equal(block.status, "active");
    assert.equal(block.goalLabel, "Dallas Marathon");
    assert.equal(block.weeks, 12);
    assert.equal(block.weekNumber, 1);
    assert.deepEqual(block.memberIds.sort(), [kim, lee].sort());
    assert.equal(block.slots.length, 1);
    assert.equal(block.slots[0].nextSessionId, slot.nextSessionId);
    assert.deepEqual(block.my, { planned: 0, kept: 0, keptMiles: 0, finished: null });

    await rejects(blocks.blockFromSeries(sql, kim, slot.id, goal, afterMeeting()), 409, /already/);
    assert.equal((await svc.listMySeries(sql, kim))[0].trainingBlockId, block.id);
    assert.deepEqual((await blocks.listMyTrainingBlocks(sql, kim)).map((b) => b.id), [block.id]);
    // It came from a public slot, so anyone can look — and sees no one's progress.
    const seen = (await blocks.getTrainingBlock(sql, out, block.id)).block;
    assert.equal(seen.viewer, "visitor");
    assert.deepEqual(seen.group, { planned: 0, kept: 0 });
  });

  it("adds weekly slots, with everyone already in — two days out, and before the goal date", async () => {
    const [ana, ben] = [await member("Ana"), await member("Ben")];
    const slot = await standingSlot(ana, ben);
    const block = await blocks.blockFromSeries(sql, ana, slot.id, {
      goalKind: "consistency",
      goalDate: daysOut(56),
    }, afterMeeting());
    assert.equal(block.goalLabel, "1× a week for 8 weeks");

    const thursday = (days: number): blocks.BlockSlotInput => ({
      venueId: "whiterock",
      title: "Thursday tempo",
      detail: "",
      ability: RUN,
      abilityFlex: "strict",
      startAt: new Date(Date.now() + days * DAY).toISOString(),
      durationMin: 45,
    });
    await rejects(blocks.addBlockSlot(sql, ben, block.id, thursday(4)), 403);
    await rejects(blocks.addBlockSlot(sql, ana, block.id, thursday(1)), 400, /two days/);
    await rejects(blocks.addBlockSlot(sql, ana, block.id, thursday(60)), 400, /goal date/);
    await rejects(
      blocks.addBlockSlot(sql, ana, block.id, { ...thursday(4), ability: { kind: "open" } }),
      400,
      /level/,
    );

    const grown = await blocks.addBlockSlot(sql, ana, block.id, thursday(4));
    assert.equal(grown.slots.length, 2);
    assert.equal(grown.goalLabel, "2× a week for 8 weeks");
    const added = grown.slots.find((s) => s.title === "Thursday tempo")!;
    const bensSeat = (await svc.listMyBookings(sql, ben)).bookings.find(
      (x) => x.sessionId === added.nextSessionId,
    )!;
    assert.equal(bensSeat.status, "confirmed", "members are already in, and can skip it free");
    assert.equal((await svc.listMySeries(sql, ben)).length, 2);
  });
});

describe("progress", () => {
  it("counts check-ins kept out of sessions planned, from each member's own side", async () => {
    const [kim, lee] = [await member("Kim"), await member("Lee")];
    const slot = await standingSlot(kim, lee);
    const block = await blocks.blockFromSeries(sql, kim, slot.id, {
      goalKind: "race_half",
      goalDate: daysOut(84),
    }, afterMeeting());
    const mine = async (who: string, clock: number) =>
      (await blocks.getTrainingBlock(sql, who, block.id, {}, clock)).block.my;

    let clock = (await playWeek(slot.id, kim, lee, Date.now(), "both"))!;
    assert.deepEqual(await mine(kim, clock), { planned: 1, kept: 1, keptMiles: 5, finished: null });
    assert.deepEqual(await mine(lee, clock), { planned: 1, kept: 1, keptMiles: 5, finished: null });

    // Lee skips with notice: free, but planned and not kept. Kim had nobody to
    // show up for, so the week isn't held against her.
    clock = (await playWeek(slot.id, kim, lee, clock, "joiner_skips"))!;
    assert.deepEqual(await mine(lee, clock), { planned: 2, kept: 1, keptMiles: 5, finished: null });
    assert.deepEqual(await mine(kim, clock), { planned: 1, kept: 1, keptMiles: 5, finished: null });

    // Kim calls a week off: it counts against her, not against Lee.
    clock = (await playWeek(slot.id, kim, lee, clock, "poster_calls_off"))!;
    assert.deepEqual(await mine(kim, clock), { planned: 2, kept: 1, keptMiles: 5, finished: null });
    assert.deepEqual(await mine(lee, clock), { planned: 2, kept: 1, keptMiles: 5, finished: null });

    const { block: seen } = await blocks.getTrainingBlock(sql, lee, block.id, {}, clock);
    assert.deepEqual(seen.group, { planned: 4, kept: 2 });
    assert.ok(seen.slots[0].nextSessionId, "a skipped week and a called-off week both roll forward");
  });

  it("stops at the goal date, then closes and writes down who finished", async () => {
    const [kim, lee] = [await member("Kim"), await member("Lee")];
    const slot = await standingSlot(kim, lee);
    const block = await blocks.blockFromSeries(sql, kim, slot.id, {
      goalKind: "race_10k",
      goalDate: daysOut(30),
    }, afterMeeting());

    let clock = Date.now();
    const plan: Week[] = ["both", "joiner_skips", "joiner_skips", "both"];
    for (const what of plan) clock = (await playWeek(slot.id, kim, lee, clock, what))!;
    assert.equal(await playWeek(slot.id, kim, lee, clock, "both"), null, "nothing after the goal date");

    assert.equal(await blocks.closeDueBlocks(sql, clock), 0, "not before the goal date has passed");
    const after = Date.now() + 32 * DAY;
    assert.equal(await blocks.closeDueBlocks(sql, after), 1);
    assert.equal(await blocks.closeDueBlocks(sql, after), 0, "once");

    const kims = (await blocks.getTrainingBlock(sql, kim, block.id, {}, after)).block;
    assert.equal(kims.status, "closing");
    assert.deepEqual(kims.my, { planned: 2, kept: 2, keptMiles: 10, finished: true });
    const lees = (await blocks.getTrainingBlock(sql, lee, block.id, {}, after)).block;
    assert.deepEqual(lees.my, { planned: 4, kept: 2, keptMiles: 10, finished: false });

    const counts = await sql<{ id: string; blocks_finished: number }>`
      select id, blocks_finished from profiles where id in (${kim}, ${lee})`;
    assert.deepEqual(
      Object.fromEntries(counts.map((c) => [c.id, c.blocks_finished])),
      { [kim]: 1, [lee]: 0 },
    );
    assert.equal((await blocks.listMyTrainingBlocks(sql, kim, after)).length, 1, "still shown for two weeks");
    assert.equal((await blocks.listMyTrainingBlocks(sql, kim, after + 20 * DAY)).length, 0);
  });
});

describe("leaving", () => {
  const twoSlotBlock = async (a: string, b: string) => {
    const slot = await standingSlot(a, b);
    const block = await blocks.blockFromSeries(sql, a, slot.id, {
      goalKind: "consistency",
      goalDate: daysOut(56),
    }, afterMeeting());
    return blocks.addBlockSlot(sql, a, block.id, {
      venueId: "katy",
      title: "Midweek easy",
      detail: "",
      ability: RUN,
      abilityFlex: "flexible",
      startAt: new Date(Date.now() + 3 * DAY).toISOString(),
      durationMin: 40,
    });
  };

  it("leaves every slot; with one member left the block and its slots are over", async () => {
    const [ria, omar] = [await member("Ria"), await member("Omar")];
    const block = await twoSlotBlock(ria, omar);
    await blocks.leaveTrainingBlock(sql, omar, block.id);

    assert.deepEqual(await svc.listMySeries(sql, omar), []);
    assert.deepEqual(await svc.listMySeries(sql, ria), [], "one person is not a slot");
    assert.deepEqual(await blocks.listMyTrainingBlocks(sql, ria), []);
    const [row] = await sql<{ status: string; ended_reason: string }>`
      select status, ended_reason from training_blocks where id = ${block.id}`;
    assert.deepEqual(row, { status: "ended", ended_reason: "too_few" });
    for (const s of block.slots) {
      assert.equal((await svc.getSession(sql, ria, s.nextSessionId!)).session.status, "cancelled");
    }
  });

  it("leaving one of a block's slots, or blocking a member of it, leaves the block", async () => {
    const [ivy, jon] = [await member("Ivy"), await member("Jon")];
    const first = await twoSlotBlock(ivy, jon);
    await svc.leaveSeries(sql, jon, first.slots[1].seriesId);
    await rejects(blocks.getTrainingBlock(sql, jon, first.id), 404);
    assert.deepEqual(await svc.listMySeries(sql, jon), []);

    const [una, vic] = [await member("Una"), await member("Vic")];
    const second = await twoSlotBlock(una, vic);
    await safety.blockMember(sql, una, vic);
    await rejects(blocks.getTrainingBlock(sql, una, second.id), 404);
    assert.deepEqual(await blocks.listMyTrainingBlocks(sql, vic), []);
  });
});

describe("public blocks", () => {
  const slot = (patch: Partial<blocks.BlockSlotInput> = {}): blocks.BlockSlotInput => ({
    venueId: "katy",
    title: "Saturday long run",
    detail: "",
    ability: RUN,
    abilityFlex: "strict",
    startAt: new Date(Date.now() + 2 * DAY).toISOString(),
    durationMin: 60,
    ...patch,
  });
  const post = (who: string, patch: Partial<blocks.PostBlockInput> = {}) =>
    blocks.postTrainingBlock(sql, who, {
      activity: "run",
      goalKind: "race_half",
      eventName: "Dallas Half",
      goalDate: daysOut(70),
      capacity: 3,
      visibility: "public",
      joinMode: "instant",
      womenOnly: false,
      slots: [slot(), slot({ title: "Midweek easy", startAt: new Date(Date.now() + 4 * DAY).toISOString() })],
      ...patch,
    });
  const nextSessions = (b: blocks.TrainingBlockDTO) => b.slots.map((x) => x.nextSessionId!);

  it("posts a block that waits for a second member, and shows it without faces", async () => {
    const [ana, bob] = [await member("Ana"), await member("Bob")];
    await rejects(post(ana, { slots: [] }), 400, /one to four/);
    await rejects(post(ana, { slots: [slot({ title: "Looking for a date" })] }), 400, /about the workout/);
    await rejects(post(ana, { eventName: "Cute 10k" }), 400, /about the workout/);
    await rejects(post(ana, { slots: [slot({ startAt: new Date(Date.now() + 20 * DAY).toISOString() })] }), 400, /two weeks/);
    await rejects(post(ana, { goalDate: daysOut(10) }), 400, /4 weeks/);

    const block = await post(ana);
    assert.equal(block.status, "forming");
    assert.equal(block.viewer, "member");
    assert.equal(block.slots.length, 2);
    assert.equal(block.seatsLeft, 2);

    const listed = await blocks.listPublicTrainingBlocks(sql, bob);
    const card = listed.find((b) => b.id === block.id)!;
    assert.deepEqual(card.memberIds, [], "discovery carries no member ids");
    assert.equal(card.memberCount, 1);
    assert.equal(card.fitsMe, null, "bob hasn’t set a level");
    assert.ok(!(await blocks.listPublicTrainingBlocks(sql, ana)).some((b) => b.id === block.id));

    // Its sessions are in discovery too — but a seat on one is a seat on all of them.
    const listing = (await svc.getSession(sql, bob, nextSessions(block)[0])).session;
    assert.equal(listing.block?.id, block.id);
    assert.equal(listing.block?.joinable, true);
    assert.equal(listing.substituteSeat, false);
    await rejects(svc.bookSeat(sql, bob, listing.id), 409, /Join the block/);
  });

  it("joining takes every slot, and the block stops forming at two", async () => {
    const [ana, bob, cat, dan] = [await member("Ana"), await member("Bob"), await member("Cat"), await member("Dan")];
    const block = await post(ana);
    const joined = await blocks.joinTrainingBlock(sql, bob, block.id);
    assert.equal(joined.viewer, "member");
    assert.equal(joined.status, "active");
    await rejects(blocks.joinTrainingBlock(sql, bob, block.id), 409, /already in/);

    const seats = (await svc.listMyBookings(sql, bob)).bookings;
    for (const id of nextSessions(block)) {
      assert.equal(seats.find((x) => x.sessionId === id)?.status, "confirmed");
    }
    assert.equal((await svc.listMySeries(sql, bob)).length, 2);
    const told = (await listNotifications(sql, ana)).notifications;
    assert.ok(told.some((x) => x.kind === "block_joined"));

    await blocks.joinTrainingBlock(sql, cat, block.id);
    await rejects(blocks.joinTrainingBlock(sql, dan, block.id), 409, /full/);
    assert.ok(!(await blocks.listPublicTrainingBlocks(sql, dan)).some((b) => b.id === block.id));
  });

  it("a regular’s skipped week is still a one-off seat for someone else", async () => {
    const [ana, bob, sub] = [await member("Ana"), await member("Bob"), await member("Sub")];
    const block = await post(ana, { slots: [slot()] });
    await blocks.joinTrainingBlock(sql, bob, block.id);
    const [sessionId] = nextSessions(block);
    const bobsSeat = (await svc.listMyBookings(sql, bob)).bookings.find((x) => x.sessionId === sessionId)!;
    await svc.cancelBooking(sql, bob, bobsSeat.id);

    const listing = (await svc.getSession(sql, sub, sessionId)).session;
    assert.equal(listing.block?.regularSeatsLeft, 1);
    assert.equal(listing.substituteSeat, true, "two seats free, one of them bob’s");
    const seat = await svc.bookSeat(sql, sub, sessionId);
    assert.equal(seat.substituteFor, bob);
    assert.deepEqual(await blocks.listMyTrainingBlocks(sql, sub), [], "filling in isn’t joining");
  });

  it("keeps rolling while it waits, and is called off after two weeks alone", async () => {
    const ana = await member("Ana");
    const block = await post(ana, { slots: [slot()] });
    const firstStart = new Date(block.slots[0].nextStartAt!).getTime();
    await svc.settleDue(sql, firstStart + 26 * MIN);
    const rolled = (await blocks.getTrainingBlock(sql, ana, block.id, {}, firstStart + HOUR)).block;
    assert.notEqual(rolled.slots[0].nextSessionId, block.slots[0].nextSessionId, "one person, still a slot");

    // The scheduler's order: settle what's due, then look at blocks.
    const later = Date.now() + 18 * DAY;
    await svc.settleDue(sql, later);
    await blocks.closeDueBlocks(sql, later);
    assert.deepEqual(await blocks.listMyTrainingBlocks(sql, ana, later), []);
    const [row] = await sql<{ status: string; ended_reason: string }>`
      select status, ended_reason from training_blocks where id = ${block.id}`;
    assert.deepEqual(row, { status: "ended", ended_reason: "too_few" });
    const [last] = await sql<{ status: string }>`
      select s.status from sessions s join series se on se.id = s.series_id
      where se.training_block_id = ${block.id} order by s.start_at desc limit 1`;
    assert.equal(last.status, "cancelled", "the week still on the calendar is called off");
  });

  it("members approve each person when the block says so", async () => {
    const [ana, bob, cat, out] = [await member("Ana"), await member("Bob"), await member("Cat"), await member("Out")];
    const block = await post(ana, { joinMode: "approve" });
    const asked = await blocks.joinTrainingBlock(sql, bob, block.id);
    assert.equal(asked.viewer, "pending");
    assert.deepEqual(asked.requests, [], "a request isn’t shown to the person who made it");
    await rejects(blocks.joinTrainingBlock(sql, bob, block.id), 409, /already asked/);
    assert.deepEqual((await blocks.getTrainingBlock(sql, ana, block.id)).block.requests, [bob]);

    await rejects(blocks.resolveBlockRequest(sql, out, block.id, bob, "approve"), 404);
    const approved = await blocks.resolveBlockRequest(sql, ana, block.id, bob, "approve");
    assert.deepEqual(approved.memberIds.sort(), [ana, bob].sort());
    assert.deepEqual(approved.requests, []);
    await rejects(blocks.resolveBlockRequest(sql, ana, block.id, bob, "approve"), 409);

    await blocks.joinTrainingBlock(sql, cat, block.id);
    // Any member answers — bob has been one for a minute.
    await blocks.resolveBlockRequest(sql, bob, block.id, cat, "decline");
    assert.equal((await blocks.getTrainingBlock(sql, cat, block.id)).block.viewer, "declined");
    await rejects(blocks.joinTrainingBlock(sql, cat, block.id), 409, /isn’t open/);
  });

  it("is absent without the link, across a block, and when women-only isn’t open to you", async () => {
    const [ana, bob, cat] = [await member("Ana"), await member("Bob"), await member("Cat")];
    const hidden = await post(ana, { visibility: "unlisted" });
    assert.ok(hidden.inviteCode);
    await rejects(blocks.getTrainingBlock(sql, bob, hidden.id), 404);
    await rejects(blocks.joinTrainingBlock(sql, bob, hidden.id), 404);
    assert.ok(!(await blocks.listPublicTrainingBlocks(sql, bob)).some((b) => b.id === hidden.id));
    assert.deepEqual(await svc.getInvite(sql, bob, hidden.inviteCode!), { trainingBlockId: hidden.id });
    const viaLink = await blocks.getTrainingBlock(sql, bob, hidden.id, { inviteCode: hidden.inviteCode });
    assert.equal(viaLink.block.inviteCode, undefined, "the code isn’t handed on");
    await blocks.joinTrainingBlock(sql, bob, hidden.id, { inviteCode: hidden.inviteCode });

    const open = await post(ana);
    await safety.blockMember(sql, cat, ana);
    await rejects(blocks.getTrainingBlock(sql, cat, open.id), 404);
    await rejects(blocks.joinTrainingBlock(sql, cat, open.id), 404);
    assert.ok(!(await blocks.listPublicTrainingBlocks(sql, cat)).some((b) => b.id === open.id));

    const [eve, guy] = [await member("Eve"), await member("Guy")];
    await rejects(post(guy, { womenOnly: true }), 400, /posted by women/);
    await svc.updateProfile(sql, eve, { gender: "woman" });
    const womenOnly = await post(eve, { womenOnly: true });
    await rejects(blocks.getTrainingBlock(sql, guy, womenOnly.id), 404);
    assert.ok(!(await blocks.listPublicTrainingBlocks(sql, guy)).some((b) => b.id === womenOnly.id));
  });

  it("closes to new regulars under four weeks; a full block can be started again", async () => {
    const [ana, bob, cat, dan] = [await member("Ana"), await member("Bob"), await member("Cat"), await member("Dan")];
    const short = await post(ana, { goalDate: daysOut(32), slots: [slot()] });
    await rejects(blocks.joinTrainingBlock(sql, bob, short.id, {}, Date.now() + 6 * DAY), 409, /four weeks/);

    const full = await post(ana, { capacity: 2, goalDate: daysOut(70) });
    await rejects(blocks.cloneTrainingBlock(sql, cat, full.id), 409, /join it instead/);
    await blocks.joinTrainingBlock(sql, bob, full.id);

    const again = await blocks.cloneTrainingBlock(sql, cat, full.id);
    assert.equal(again.status, "forming");
    assert.equal(again.createdBy, cat);
    assert.equal(again.goalLabel, full.goalLabel);
    assert.equal(again.goalDate, full.goalDate);
    assert.deepEqual(again.slots.map((x) => x.title).sort(), full.slots.map((x) => x.title).sort());
    assert.equal(again.slots[0].title, full.slots[0].title, "slots come in the order the week runs");
    const gap = new Date(again.slots[0].nextStartAt!).getTime() - new Date(full.slots[0].nextStartAt!).getTime();
    assert.ok(Math.abs(gap - 7 * DAY) <= HOUR, "a week on, same wall-clock time");
    const [row] = await sql<{ cloned_from: string }>`
      select cloned_from from training_blocks where id = ${again.id}`;
    assert.equal(row.cloned_from, full.id);
    await blocks.joinTrainingBlock(sql, dan, again.id);
  });
});
