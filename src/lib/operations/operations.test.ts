import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "../pace/test-db.ts";
import { operationalOverview, pruneOperations, recordOperation } from "./service.server.ts";

test("operations expose aggregate latency and errors and expire old events", async () => {
  const sql = await makeDb();
  await recordOperation(sql, {
    component: "fitness",
    action: "POST /fitness/draft",
    status: 200,
    durationMs: 100,
  });
  await recordOperation(sql, {
    component: "fitness",
    action: "POST /fitness/draft",
    status: 503,
    durationMs: 500,
  });
  // IDs or arbitrary strings cannot become telemetry action values.
  await recordOperation(sql, {
    component: "health",
    action: "GET /health/workouts/private123",
    status: 200,
    durationMs: 5,
  });
  const result = await operationalOverview(sql);
  assert.equal(result.metrics.length, 1);
  assert.equal(result.metrics[0].requests, 2);
  assert.equal(result.metrics[0].server_errors, 1);
  assert.equal(result.metrics[0].p50_ms, 300);
  assert.equal(result.counts.health_connections, 0);
  await pruneOperations(sql, Date.now() + 8 * 86400_000);
  assert.equal((await operationalOverview(sql)).metrics.length, 0);
});
