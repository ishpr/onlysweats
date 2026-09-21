import assert from "node:assert/strict";
import test from "node:test";
import { visibleWatchSnapshot } from "./watch.ts";
const now = Date.parse("2026-09-21T12:00:00Z");
const snapshot = {
  sessionId: "session",
  state: "running",
  activity: "run",
  startAt: "2026-09-21T11:00:00Z",
  elapsedSeconds: 1800,
  heartRateBpm: 145,
  heartRateAt: new Date(now).toISOString(),
  distanceMeters: null,
  activeEnergyKilocalories: null,
  zoneIndex: 1,
  zoneSource: "system",
  receivedAt: new Date(now).toISOString(),
};
test("live mirror strips unselected heart readings and preserves missing measurements", () => {
  const shown = visibleWatchSnapshot(snapshot, ["workout"], now);
  assert.equal(shown.heartRateBpm, null);
  assert.equal(shown.zoneIndex, null);
  assert.equal(shown.distanceMeters, null);
  assert.equal(visibleWatchSnapshot(snapshot, [], now), null);
});
test("old heart readings, paused sessions and dead mirror connections never appear current", () => {
  assert.equal(
    visibleWatchSnapshot(snapshot, ["workout", "heart_rate"], now + 16000).heartRateBpm,
    null,
  );
  assert.equal(
    visibleWatchSnapshot({ ...snapshot, state: "paused" }, ["workout", "heart_rate"], now)
      .heartRateBpm,
    null,
  );
  assert.equal(visibleWatchSnapshot(snapshot, ["workout", "heart_rate"], now + 31000), null);
  assert.equal(visibleWatchSnapshot({ ...snapshot, state: "ended" }, ["workout"], now), null);
  assert.equal(
    visibleWatchSnapshot({ ...snapshot, receivedAt: "bad date" }, ["workout"], now),
    null,
  );
});
