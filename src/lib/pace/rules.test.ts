import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  abilityFits,
  abilityLabel,
  blockFinished,
  blockJoinable,
  blockWeek,
  blockWeeks,
  canBook,
  canGiveCredits,
  canJoinBlock,
  canGeoCheckIn,
  canPost,
  canUseCode,
  cancelOutcome,
  chatOpen,
  cleanText,
  clusterDate,
  creditable,
  distanceM,
  feeChargeableAt,
  goalLabel,
  nextOccurrence,
  plannedAndKept,
  settle,
  slotsUndecided,
  validAbility,
  validBlock,
  type BlockFacts,
  type BlockInput,
  type Occurrence,
  type PostInput,
  type SessionFacts,
} from "./rules.ts";
import type { Ability } from "./types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 22, 11, 0, 0);
const KATY = { lat: 32.8019, lng: -96.8074 };
const RUN: Ability = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 };

describe("ability", () => {
  it("is required and must match the activity", () => {
    assert.equal(validAbility("run", null).ok, false);
    assert.equal(validAbility("ride", RUN).ok, false);
    assert.equal(validAbility("run", RUN).ok, true);
    assert.equal(validAbility("run", { ...RUN, paceMaxSec: 500 }).ok, false);
    assert.equal(validAbility("mobility", { kind: "open" }).ok, true);
  });
  it("labels the workout, never the person", () => {
    assert.equal(abilityLabel(RUN), "9:30–10:00 /mi · 5 mi");
    assert.equal(
      abilityLabel({ kind: "ride", mphMin: 15, mphMax: 17, miles: 25, surface: "road" }),
      "15–17 mph · 25 mi · road",
    );
    assert.equal(abilityLabel({ kind: "gym", experience: "regular", focus: "upper body" }), "Regular · upper body");
    assert.equal(
      abilityLabel({ kind: "hike", miles: 6, gainFt: 1200, difficulty: "moderate" }),
      "6 mi · 1,200 ft · moderate",
    );
    assert.equal(abilityLabel({ kind: "walk", effort: "brisk", miles: 3 }), "Brisk · 3 mi");
  });
  it("fits when ranges overlap, and always when the poster is flexible", () => {
    const mine = { run: { paceMinSec: 585, paceMaxSec: 630 }, hike: { difficulty: "moderate" as const } };
    assert.equal(abilityFits(mine, RUN, "strict"), true);
    assert.equal(abilityFits(mine, { ...RUN, paceMinSec: 420, paceMaxSec: 480 }, "strict"), false);
    assert.equal(abilityFits(mine, { ...RUN, paceMinSec: 420, paceMaxSec: 480 }, "flexible"), true);
    assert.equal(abilityFits(mine, { kind: "hike", miles: 8, gainFt: 3000, difficulty: "hard" }, "strict"), false);
    assert.equal(abilityFits(mine, { kind: "hike", miles: 3, gainFt: 200, difficulty: "easy" }, "strict"), true);
    assert.equal(abilityFits({}, RUN, "strict"), null, "unknown level hides nothing");
    assert.equal(abilityFits({}, { kind: "open" }, "strict"), true);
  });
});

describe("canPost", () => {
  const base: PostInput = {
    title: "Easy miles",
    activity: "run",
    ability: RUN,
    startAt: NOW + 2 * HOUR,
    capacity: 2,
    womenOnly: false,
    visibility: "public",
  };
  const poster = { gender: null, frozenUntil: null };

  it("accepts a normal post and demands ability", () => {
    assert.deepEqual(canPost(base, poster, NOW), { ok: true });
    assert.equal(canPost({ ...base, ability: null }, poster, NOW).ok, false);
  });
  it("caps sessions at 2–4 people and needs 30 minutes of lead time", () => {
    assert.equal(canPost({ ...base, capacity: 5 }, poster, NOW).ok, false);
    assert.equal(canPost({ ...base, startAt: NOW + 10 * MIN }, poster, NOW).ok, false);
  });
  it("a freeze pauses public sessions but not invites to people you know", () => {
    const iced = { gender: null, frozenUntil: NOW + DAY };
    assert.equal(canPost(base, iced, NOW).ok, false);
    assert.equal(canPost({ ...base, visibility: "unlisted" }, iced, NOW).ok, true);
    assert.equal(canPost(base, { gender: null, frozenUntil: NOW - 1 }, NOW).ok, true);
  });
  it("only lets women post women-only", () => {
    assert.equal(canPost({ ...base, womenOnly: true }, poster, NOW).ok, false);
    assert.equal(canPost({ ...base, womenOnly: true }, { ...poster, gender: "woman" }, NOW).ok, true);
  });
});

describe("canBook", () => {
  const session = (patch: Partial<SessionFacts> = {}): SessionFacts => ({
    hostId: "host",
    startAt: NOW + DAY,
    capacity: 2,
    status: "open",
    womenOnly: false,
    visibility: "public",
    ...patch,
  });
  const me = { id: "me", gender: null, frozenUntil: null };
  const free = { taken: 0, mineActive: false };

  it("joins an open session and counts the poster against capacity", () => {
    assert.deepEqual(canBook(session(), me, free, NOW), { ok: true });
    assert.equal(canBook(session(), me, { ...free, taken: 1 }, NOW).ok, false);
    assert.equal(canBook(session({ capacity: 3 }), me, { ...free, taken: 1 }, NOW).ok, true);
  });
  it("blocks the poster, a second seat, closed and started sessions", () => {
    assert.equal(canBook(session({ hostId: "me" }), me, free, NOW).ok, false);
    assert.equal(canBook(session(), me, { ...free, mineActive: true }, NOW).ok, false);
    assert.equal(canBook(session({ status: "cancelled" }), me, free, NOW).ok, false);
    assert.equal(canBook(session({ startAt: NOW - MIN }), me, free, NOW).ok, false);
  });
  it("enforces women-only and the freeze at the door", () => {
    assert.equal(canBook(session({ womenOnly: true }), me, free, NOW).ok, false);
    assert.equal(canBook(session({ womenOnly: true }), { ...me, gender: "woman" }, free, NOW).ok, true);
    const iced = { ...me, frozenUntil: NOW + DAY };
    assert.equal(canBook(session(), iced, free, NOW).ok, false);
    assert.equal(canBook(session({ visibility: "unlisted" }), iced, free, NOW).ok, true);
  });
});

describe("cancelOutcome", () => {
  it("is free 12h+ ahead and $5 inside 12h", () => {
    assert.deepEqual(cancelOutcome("confirmed", NOW + 13 * HOUR, NOW), { late: false, feeCents: 0 });
    assert.deepEqual(cancelOutcome("confirmed", NOW + 11 * HOUR, NOW), { late: true, feeCents: 500 });
  });
  it("never charges a request nobody accepted", () => {
    assert.deepEqual(cancelOutcome("pending", NOW + HOUR, NOW), { late: false, feeCents: 0 });
  });
});

describe("check-in", () => {
  const start = NOW + 10 * MIN;
  it("measures real distance", () => {
    const d = distanceM(KATY, { lat: 32.8041, lng: -96.8079 });
    assert.ok(d > 230 && d < 260, String(d));
  });
  it("accepts a fix inside 150 m during the window, and nothing else", () => {
    assert.equal(canGeoCheckIn(start, KATY, { lat: 32.8025, lng: -96.8074 }, NOW).ok, true);
    assert.equal(canGeoCheckIn(start, KATY, { lat: 32.8041, lng: -96.8079 }, NOW).ok, false);
    assert.equal(canGeoCheckIn(NOW + 21 * MIN, KATY, KATY, NOW).ok, false);
    assert.equal(canGeoCheckIn(NOW - 26 * MIN, KATY, KATY, NOW).ok, false);
    assert.equal(canGeoCheckIn(start, KATY, { ...KATY, accuracyM: 400 }, NOW).ok, false);
  });
  it("only honors a revealed, fresh, matching code", () => {
    const s = { code: "4821", codeRevealedAt: NOW - MIN, startAt: start };
    assert.equal(canUseCode(s, "4821", NOW).ok, true);
    assert.equal(canUseCode(s, "0000", NOW).ok, false);
    assert.equal(canUseCode({ ...s, codeRevealedAt: null }, "4821", NOW).ok, false);
    assert.equal(canUseCode({ ...s, codeRevealedAt: NOW - 11 * MIN }, "4821", NOW).ok, false);
  });
});

describe("settle", () => {
  const closed = NOW - HOUR;
  const b = (host: boolean, participant: boolean) => ({
    hostCheckedIn: host,
    participantCheckedIn: participant,
  });
  it("both check in: nothing is charged, even mid-window", () => {
    assert.deepEqual(settle(b(true, true), NOW, NOW), { status: "completed" });
  });
  it("waits while the window is open", () => {
    assert.equal(settle(b(true, false), NOW, NOW), null);
  });
  it("treats poster and joiner the same: $10 + strike to the absent, $5 credit to the present", () => {
    assert.deepEqual(settle(b(true, false), closed, NOW), {
      status: "no_show",
      absent: "joiner",
      feeCents: 1000,
      creditCents: 500,
    });
    assert.deepEqual(settle(b(false, true), closed, NOW), {
      status: "host_no_show",
      absent: "poster",
      feeCents: 1000,
      creditCents: 500,
    });
  });
  it("voids without a fee when nobody came — no one was stood up", () => {
    assert.deepEqual(settle(b(false, false), closed, NOW), { status: "void" });
  });
  it("holds a fee for 24h after the session so it can be disputed", () => {
    assert.equal(feeChargeableAt(NOW, 40), NOW + 40 * MIN + DAY);
  });
});

describe("standing slots", () => {
  const at = (iso: string) => new Date(iso).getTime();
  it("repeats seven days on", () => {
    assert.equal(nextOccurrence(at("2026-09-22T11:00:00Z")), at("2026-09-29T11:00:00Z"));
  });
  it("keeps 6:00 am at 6:00 am across daylight-saving changes", () => {
    // Central time falls back on Nov 1, 2026 and springs forward on Mar 14, 2027.
    assert.equal(nextOccurrence(at("2026-10-27T11:00:00Z")), at("2026-11-03T12:00:00Z"));
    assert.equal(nextOccurrence(at("2027-03-09T12:00:00Z")), at("2027-03-16T11:00:00Z"));
  });
});

describe("chatOpen", () => {
  const s = { startAt: NOW - 30 * HOUR, durationMin: 60 };
  it("expires 24h after the session, and closes on decline or cancel", () => {
    assert.equal(chatOpen({ status: "completed" }, s, NOW), false);
    assert.equal(chatOpen({ status: "completed" }, { ...s, startAt: NOW - 2 * HOUR }, NOW), true);
    assert.equal(chatOpen({ status: "declined" }, { ...s, startAt: NOW + HOUR }, NOW), false);
  });
});

describe("training blocks", () => {
  const block = (patch: Partial<BlockInput> = {}): BlockInput => ({
    activity: "run",
    goalKind: "race_marathon",
    eventName: "Dallas Marathon",
    startsOn: "2026-09-22",
    goalDate: "2026-12-13",
    ...patch,
  });

  it("runs 4 to 20 weeks, toward a goal that fits the activity", () => {
    assert.deepEqual(validBlock(block()), { ok: true });
    assert.equal(validBlock(block({ goalDate: "2026-10-19" })).ok, false, "27 days");
    assert.equal(validBlock(block({ goalDate: "2026-10-20" })).ok, true, "28 days");
    assert.equal(validBlock(block({ goalDate: "2027-02-09" })).ok, true, "140 days");
    assert.equal(validBlock(block({ goalDate: "2027-02-10" })).ok, false, "141 days");
    assert.equal(validBlock(block({ goalDate: "soon" })).ok, false);
    assert.equal(validBlock(block({ goalDate: "2026-13-45" })).ok, false);
    assert.equal(validBlock(block({ activity: "ride" })).ok, false, "a marathon isn’t a ride");
    assert.equal(validBlock(block({ activity: "ride", goalKind: "ride_century" })).ok, true);
    assert.equal(validBlock(block({ activity: "strength", goalKind: "consistency", eventName: null })).ok, true);
    assert.equal(validBlock(block({ goalKind: "consistency" })).ok, false, "no event to name");
    assert.equal(validBlock(block({ goalKind: "event_other", eventName: " " })).ok, false);
    assert.equal(validBlock(block({ eventName: "x".repeat(61) })).ok, false);
  });

  it("names the week and the goal", () => {
    assert.equal(blockWeeks("2026-09-22", "2026-12-13"), 12);
    assert.equal(blockWeek("2026-09-22", "2026-12-13", "2026-09-22"), 1);
    assert.equal(blockWeek("2026-09-22", "2026-12-13", "2026-09-28"), 1);
    assert.equal(blockWeek("2026-09-22", "2026-12-13", "2026-09-29"), 2);
    assert.equal(blockWeek("2026-09-22", "2026-12-13", "2027-01-20"), 12, "stays on the last week");
    assert.equal(goalLabel("race_marathon", "Dallas Marathon", 1, 12), "Dallas Marathon");
    assert.equal(goalLabel("race_marathon", null, 1, 12), "Marathon");
    assert.equal(goalLabel("consistency", null, 3, 12), "3× a week for 12 weeks");
  });

  it("reads the date in the cluster, not in UTC", () => {
    // 03:30 UTC is still the evening before in Dallas.
    assert.equal(clusterDate(Date.UTC(2026, 8, 23, 3, 30)), "2026-09-22");
    assert.equal(clusterDate(Date.UTC(2026, 8, 23, 5, 30)), "2026-09-23");
  });

  const past = (patch: Partial<Occurrence> = {}): Occurrence => ({
    startAt: NOW - DAY,
    checkedIn: false,
    calledOff: false,
    calledOffByMe: false,
    stoodAlone: false,
    miles: 5,
    ...patch,
  });

  it("counts a check-in as kept, and a skip or my own call-off as planned", () => {
    assert.deepEqual(plannedAndKept([], NOW), { planned: 0, kept: 0, keptMiles: 0 });
    const weeks = [
      past({ checkedIn: true }),
      past({ checkedIn: true, miles: 6.2 }),
      past(), // skipped with notice, or didn’t show
      past({ calledOff: true, calledOffByMe: true }),
    ];
    assert.deepEqual(plannedAndKept(weeks, NOW), { planned: 4, kept: 2, keptMiles: 11.2 });
  });

  it("doesn’t hold a week against someone who had no way to keep it", () => {
    const weeks = [
      past({ calledOff: true }), // someone else called it off
      past({ stoodAlone: true }), // I posted; everyone else skipped
      past({ startAt: NOW - 10 * MIN }), // check-in is still open
      past({ startAt: NOW + DAY }),
    ];
    assert.deepEqual(plannedAndKept(weeks, NOW), { planned: 0, kept: 0, keptMiles: 0 });
    // …but showing up counts even when the buddy didn’t.
    assert.equal(plannedAndKept([past({ checkedIn: true, stoodAlone: true })], NOW).kept, 1);
    // A week I called off counts at once, not after it would have started.
    const mineOff = past({ startAt: NOW + DAY, calledOff: true, calledOffByMe: true });
    assert.equal(plannedAndKept([mineOff], NOW).planned, 1);
  });

  it("finishing takes 75% kept", () => {
    assert.equal(blockFinished({ planned: 0, kept: 0 }), false);
    assert.equal(blockFinished({ planned: 4, kept: 3 }), true);
    assert.equal(blockFinished({ planned: 36, kept: 27 }), true);
    assert.equal(blockFinished({ planned: 36, kept: 26 }), false);
  });
});

describe("words", () => {
  it("keeps member text about the workout, matching whole words only", () => {
    for (const fine of [
      "Easy miles — update me if you’re late",
      "Singletrack loop, candidate for Saturdays",
      "Single-leg RDLs and single arm rows",
      "Sparkling water after",
      "Match my pace — race date is Dec 13",
      "",
    ]) {
      assert.deepEqual(cleanText(fine), { ok: true }, fine);
    }
    for (const [text, word] of [
      ["Looking for a spark", "spark"],
      ["SWIPE right on this run", "swipe"],
      ["any gym  crush welcome", "gym crush"],
      ["Good VIBE only", "vibe"],
      ["single and running", "single"],
    ] as const) {
      const verdict = cleanText("Fine title", null, text);
      assert.equal(verdict.ok, false, text);
      assert.match((verdict as { error: string }).error, new RegExp(`“${word.replace("  ", " ")}”|“gym\\s+crush”`));
    }
  });

  it("applies to a listing’s title and detail", () => {
    const base: PostInput = {
      title: "Easy miles",
      activity: "run",
      ability: { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 },
      startAt: NOW + DAY,
      capacity: 2,
      womenOnly: false,
      visibility: "public",
    };
    const poster = { gender: null, frozenUntil: null };
    assert.equal(canPost(base, poster, NOW).ok, true);
    assert.equal(canPost({ ...base, title: "Cute 5k" }, poster, NOW).ok, false);
    assert.equal(canPost({ ...base, detail: "No chemistry required" }, poster, NOW).ok, false);
  });
});

describe("joining a training block", () => {
  const today = clusterDate(NOW);
  const plus = (days: number) => clusterDate(NOW + days * DAY);
  const block = (patch: Partial<BlockFacts> = {}): BlockFacts => ({
    status: "active",
    visibility: "public",
    womenOnly: false,
    capacity: 3,
    goalDate: plus(60),
    ...patch,
  });
  const me = { gender: null, frozenUntil: null };

  it("takes a running block with a seat and four weeks to go", () => {
    assert.equal(canJoinBlock(block(), me, { members: 2, isMember: false }, NOW).ok, true);
    assert.equal(canJoinBlock(block({ status: "forming" }), me, { members: 1, isMember: false }, NOW).ok, true);
    assert.equal(canJoinBlock(block(), me, { members: 2, isMember: true }, NOW).ok, false);
    assert.equal(canJoinBlock(block(), me, { members: 3, isMember: false }, NOW).ok, false);
    assert.equal(canJoinBlock(block({ status: "closing" }), me, { members: 2, isMember: false }, NOW).ok, false);
    assert.equal(canJoinBlock(block({ goalDate: plus(28) }), me, { members: 2, isMember: false }, NOW).ok, true);
    assert.equal(canJoinBlock(block({ goalDate: plus(27) }), me, { members: 2, isMember: false }, NOW).ok, false);
  });

  it("keeps women-only and the two-strike freeze", () => {
    const facts = { members: 1, isMember: false };
    assert.equal(canJoinBlock(block({ womenOnly: true }), me, facts, NOW).ok, false);
    assert.equal(canJoinBlock(block({ womenOnly: true }), { ...me, gender: "woman" }, facts, NOW).ok, true);
    const frozen = { gender: null, frozenUntil: NOW + DAY };
    assert.equal(canJoinBlock(block(), frozen, facts, NOW).ok, false);
    assert.equal(canJoinBlock(block({ visibility: "unlisted" }), frozen, facts, NOW).ok, true, "people you know");
  });

  it("says when a free seat on a session is a regular’s", () => {
    assert.equal(blockJoinable(block(), 2, today), true);
    assert.equal(blockJoinable(block(), 3, today), false, "full");
    assert.equal(blockJoinable(block({ goalDate: plus(20) }), 2, today), false, "too far along");
    assert.equal(blockJoinable(block({ status: "ended" }), 2, today), false);
  });
});

describe("the end of a block", () => {
  const closing = { status: "closing" as const, goalDate: "2026-12-13" };
  const finisher = { finished: true, answered: false };

  it("opens goal credits to finishers for a week after the goal date", () => {
    assert.equal(canGiveCredits(closing, finisher, "2026-12-14").ok, true);
    assert.equal(canGiveCredits(closing, finisher, "2026-12-20").ok, true, "day 7");
    assert.equal(canGiveCredits(closing, finisher, "2026-12-21").ok, false, "day 8");
    assert.equal(canGiveCredits({ ...closing, status: "active" }, finisher, "2026-12-14").ok, false);
    assert.equal(canGiveCredits({ ...closing, status: "ended" }, finisher, "2026-12-14").ok, false);
    assert.equal(canGiveCredits(closing, { finished: false, answered: false }, "2026-12-14").ok, false);
    assert.equal(canGiveCredits(closing, { finished: null, answered: false }, "2026-12-14").ok, false);
    assert.equal(canGiveCredits(closing, { finished: true, answered: true }, "2026-12-14").ok, false);
  });

  it("makes a buddy creditable after three sessions both checked in to", () => {
    const sessions = [
      { checkedIn: ["me", "ann", "sub"] },
      { checkedIn: ["me", "ann"] },
      { checkedIn: ["ann", "bob"] }, // I wasn’t there
      { checkedIn: ["me", "ann", "bob", "sub"] },
      { checkedIn: ["me", "sub", "sub"] }, // listed twice is still once
      { checkedIn: ["me"] },
    ];
    assert.deepEqual(creditable("me", sessions), ["ann", "sub"], "regulars and substitutes alike");
    assert.deepEqual(creditable("me", sessions, 4), []);
    assert.deepEqual(creditable("nobody", sessions), []);
  });

  it("leaves two weeks to decide about the slots", () => {
    assert.equal(slotsUndecided("2026-12-13", "2026-12-13"), false, "still the goal date");
    assert.equal(slotsUndecided("2026-12-13", "2026-12-14"), true);
    assert.equal(slotsUndecided("2026-12-13", "2026-12-27"), true, "day 14");
    assert.equal(slotsUndecided("2026-12-13", "2026-12-28"), false);
  });
});
