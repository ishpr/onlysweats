import { test } from "node:test";
import assert from "node:assert/strict";
import { formattedPlanningContext } from "./planning-context.ts";

test("running pace is formatted from seconds, never decimal digits or invented values", () => {
  const source = {
    preferences: { ability: { kind: "run", paceMinSec: 540, paceMaxSec: 605, miles: 3 } },
    sessions: [
      {
        startAt: "2026-09-23T17:00:00Z",
        ability: { kind: "run", paceMinSec: 599, paceMaxSec: 600, miles: 2 },
      },
    ],
  };
  assert.deepEqual(formattedPlanningContext(source), {
    preferences: { ability: { kind: "run", pace: "9:00–10:05 min/mile", miles: 3 } },
    sessions: [
      {
        startAt: "2026-09-23T17:00:00Z",
        ability: { kind: "run", pace: "9:59–10:00 min/mile", miles: 2 },
      },
    ],
  });
  assert.equal(source.preferences.ability.paceMinSec, 540);
  for (const missing of [null, undefined, NaN, Infinity, -1, 4.5]) {
    assert.deepEqual(
      formattedPlanningContext({
        preferences: { ability: { kind: "run", paceMinSec: missing, paceMaxSec: 600 } },
      }),
      {
        preferences: { ability: { kind: "run", pace: null } },
      },
    );
  }
});
test("other activity facts and unavailable responses retain their exact meaning", () => {
  for (const value of [
    { available: false, reason: "Permission off" },
    { sessions: [] },
    { preferences: { ability: { kind: "ride", mphMin: 12, mphMax: 15 } } },
    null,
  ]) {
    assert.deepEqual(formattedPlanningContext(value), value);
  }
});
