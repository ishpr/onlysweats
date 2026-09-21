import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { type DaySnapshot, pickForToday, readToday } from "./today.ts";

const day = (patch: Partial<DaySnapshot> = {}): DaySnapshot => ({
  workouts: [],
  exerciseMin: null,
  steps: null,
  sleepMin: null,
  sleepBaseMin: null,
  restingHr: null,
  restingHrBase: null,
  hrvMs: null,
  hrvBase: null,
  weekWorkouts: 0,
  ...patch,
});

describe("readToday", () => {
  it("says nothing it can't back up when there's no data", () => {
    const r = readToday(day());
    assert.equal(r.effort, "unknown");
    assert.match(r.lines[0], /Wear your watch/);
  });

  it("calls a well-slept, untrained day a good day to go", () => {
    const r = readToday(day({ sleepMin: 7 * 60 + 40, sleepBaseMin: 7 * 60 + 20, weekWorkouts: 3 }));
    assert.equal(r.effort, "ready");
    assert.equal(r.lines[0], "You slept 7 h 40 min.");
  });

  it("eases off after short sleep, measured against the member's own nights", () => {
    assert.equal(readToday(day({ sleepMin: 5 * 60 + 30 })).effort, "easy");
    const r = readToday(day({ sleepMin: 6 * 60 + 20, sleepBaseMin: 7 * 60 + 45 }));
    assert.equal(r.effort, "easy");
    assert.match(r.lines[0], /less than you usually do/);
  });

  it("eases off when resting heart rate is up or variability is down on the week", () => {
    const up = readToday(day({ sleepMin: 450, restingHr: 62, restingHrBase: 56 }));
    assert.equal(up.effort, "easy");
    assert.ok(up.lines.includes("Your resting heart rate is up on your week."));
    assert.equal(readToday(day({ sleepMin: 450, hrvMs: 38, hrvBase: 50 })).effort, "easy");
    assert.equal(
      readToday(day({ sleepMin: 450, restingHr: 57, restingHrBase: 56 })).effort,
      "ready",
    );
  });

  it("recognises the work already done, and states it as a fact", () => {
    const r = readToday(
      day({
        sleepMin: 480,
        workouts: [{ kind: "run", minutes: 52, miles: 5.23 }],
        weekWorkouts: 4,
      }),
    );
    assert.equal(r.effort, "easy");
    assert.equal(r.headline, "You’ve done the work today");
    assert.equal(r.lines[0], "You ran 5.2 mi today — 52 min.");
  });

  it("never shows more than three lines, and never a number it wasn't given", () => {
    const r = readToday(
      day({
        sleepMin: 300,
        restingHr: 70,
        restingHrBase: 58,
        hrvMs: 30,
        hrvBase: 55,
        workouts: [{ kind: "walk", minutes: 25 }],
        steps: 9000,
      }),
    );
    assert.ok(r.lines.length <= 3);
    assert.ok(!r.lines.join(" ").includes("undefined"));
  });
});

describe("pickForToday", () => {
  const at = (h: number) => Date.UTC(2026, 8, 21, h);
  const sessions = [
    {
      id: "tempo",
      activity: "run" as const,
      anyLevelWelcome: false,
      fitsMe: true,
      startAt: at(11),
    },
    {
      id: "walk",
      activity: "walk" as const,
      anyLevelWelcome: false,
      fitsMe: null,
      startAt: at(13),
    },
    {
      id: "fast",
      activity: "run" as const,
      anyLevelWelcome: false,
      fitsMe: false,
      startAt: at(10),
    },
  ];

  it("points an easy day at something gentle, and nothing if there isn't any", () => {
    const easy = readToday(day({ sleepMin: 300 }));
    assert.equal(pickForToday(easy, sessions)?.id, "walk");
    assert.equal(pickForToday(easy, [sessions[0]]), null);
  });

  it("otherwise picks the soonest session at my level, never one that doesn't fit", () => {
    const ready = readToday(day({ sleepMin: 480 }));
    assert.equal(pickForToday(ready, sessions)?.id, "tempo");
    assert.equal(pickForToday(ready, [sessions[2]]), null);
  });
});
