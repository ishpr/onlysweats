import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  abilityFits,
  abilityLabel,
  canBook,
  canGeoCheckIn,
  canPost,
  canUseCode,
  cancelOutcome,
  chatOpen,
  distanceM,
  feeChargeableAt,
  nextOccurrence,
  settle,
  validAbility,
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
