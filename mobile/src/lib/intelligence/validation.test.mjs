import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalResult } from "./validation.ts";
import { workoutSurface } from "./workout-surface.ts";

const source = "Bench press 3x8 40 kg";
const response = () => ({
  status: "available",
  execution: "on_device",
  modelUsed: true,
  draft: {
    source: "photo",
    sourceText: source,
    note: source,
    title: "Bench press",
    activity: "strength",
    intent: "planned",
    requiresReview: true,
    exercises: [{ name: "Bench press", sets: 3, reps: 8, weight: 40, unit: "kg" }],
  },
});

test("local draft preserves planned status and null dates without permitting an automatic save", () => {
  const result = parseLocalResult(JSON.stringify(response()), "draft");
  assert.equal(result.status, "available");
  assert.equal(result.draft.startedAt, null);
  assert.equal(result.draft.intent, "planned");
  assert.equal(result.draft.requiresReview, true);
  assert.equal(result.draft.durationMin, null);
});

test("native result boundary rejects invented titles, dates, units and execution channels", () => {
  for (const mutate of [
    (r) => {
      r.draft.title = "Deadlift";
    },
    (r) => {
      r.draft.startedAt = "2026-09-21";
    },
    (r) => {
      r.draft.exercises[0].unit = null;
    },
    (r) => {
      r.execution = "cloud";
    },
    (r) => {
      r.draft.requiresReview = false;
    },
    (r) => {
      r.draft.exercises[0].sets = 1.5;
    },
    (r) => {
      r.draft.note = "Rewritten notes";
    },
  ]) {
    const value = response();
    mutate(value);
    assert.equal(parseLocalResult(JSON.stringify(value), "draft").status, "error");
  }
  assert.equal(parseLocalResult("bad-json", "draft").status, "error");
  assert.equal(parseLocalResult("x".repeat(32_001), "draft").status, "error");
});

test("cancelled and model-unavailable results do not masquerade as generated replies", () => {
  assert.equal(
    parseLocalResult(
      JSON.stringify({ status: "cancelled", reason: "cancelled", execution: "on_device" }),
      "text",
    ).status,
    "cancelled",
  );
  assert.equal(
    parseLocalResult(
      JSON.stringify({ status: "available", execution: "on_device", modelUsed: true, text: "" }),
      "text",
    ).status,
    "error",
  );
  const value = response();
  value.modelUsed = false;
  value.draft.exercises = [];
  value.reason = "model_not_ready";
  assert.equal(parseLocalResult(JSON.stringify(value), "draft").modelUsed, false);
});

const now = Date.parse("2026-09-21T12:00:00Z");
const snapshot = () => ({
  sessionId: "synthetic",
  activity: "run",
  state: "running",
  startAt: new Date(now - 600_000).toISOString(),
  elapsedSeconds: 601,
  receivedAt: new Date(now).toISOString(),
  heartRateAt: new Date(now - 5_000).toISOString(),
  heartRateBpm: 140,
  distanceMeters: 1600,
  activeEnergyKilocalories: null,
  zoneIndex: null,
  zoneSource: null,
});

test("workout surface displays only fresh measured fields and ages at earliest measurement expiry", () => {
  const result = workoutSurface(snapshot(), now);
  assert.equal(result.props.elapsedLabel, "10:01");
  assert.equal(result.props.heartRateLabel, "140 bpm");
  assert.equal(result.props.distanceLabel, "1.60 km");
  assert.equal(result.staleAt, now + 55_000);
  const missing = { ...snapshot(), heartRateBpm: null, heartRateAt: null, distanceMeters: null };
  assert.equal(workoutSurface(missing, now).props.heartRateLabel, null);
  assert.equal(workoutSurface(missing, now).props.distanceLabel, null);
});

test("ended, stale and malformed Watch snapshots never create an active surface", () => {
  for (const change of [
    { state: "ended" },
    { state: "stopped" },
    { elapsedSeconds: -1 },
    { receivedAt: new Date(now - 60_001).toISOString() },
    { startAt: "bad" },
    { receivedAt: new Date(now + 5_001).toISOString() },
  ]) {
    assert.equal(workoutSurface({ ...snapshot(), ...change }, now), null);
  }
  const oldHeart = { ...snapshot(), heartRateAt: new Date(now - 61_000).toISOString() };
  assert.equal(workoutSurface(oldHeart, now).props.heartRateLabel, null);
  assert.equal(workoutSurface({ ...snapshot(), state: "paused" }, now).props.state, "paused");
});

const { parsePrivateCloudCapability, parsePrivateCloudResult } = await import("./private-cloud.ts");
test("PCC remains a separate unavailable channel unless its capability and quota are valid", () => {
  const disabled = parsePrivateCloudCapability(
    JSON.stringify({
      available: false,
      reason: "entitlement_not_configured",
      quota: "unknown",
      execution: "apple_private_cloud",
    }),
  );
  assert.equal(disabled.available, false);
  assert.equal(disabled.reason, "entitlement_not_configured");
  assert.equal(
    parsePrivateCloudCapability(
      JSON.stringify({ available: true, quota: "limit_reached", execution: "apple_private_cloud" }),
    ).available,
    false,
  );
  assert.equal(
    parsePrivateCloudCapability(
      JSON.stringify({ available: true, quota: "below_limit", execution: "on_device" }),
    ).available,
    false,
  );
  assert.equal(
    parsePrivateCloudResult(
      JSON.stringify({ status: "available", text: "Reply", execution: "on_device" }),
    ).status,
    "error",
  );
});
test("PCC errors never expose a raw provider response or provisional text", () => {
  const result = parsePrivateCloudResult(
    JSON.stringify({
      status: "unavailable",
      reason: "private provider payload",
      text: "discarded partial",
      execution: "apple_private_cloud",
    }),
  );
  assert.deepEqual(result, {
    status: "unavailable",
    reason: "unavailable",
    execution: "apple_private_cloud",
  });
  assert.deepEqual(
    parsePrivateCloudResult(
      JSON.stringify({
        status: "available",
        text: "Short response",
        execution: "apple_private_cloud",
      }),
    ),
    { status: "available", text: "Short response", execution: "apple_private_cloud" },
  );
});
