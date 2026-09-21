import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "../pace/test-db.ts";
import { operationalOverview, pruneOperations, recordOperation } from "./service.server.ts";
import { pair } from "../agents/test-helpers.ts";
import * as pace from "../pace/service.server.ts";

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

test("community outcomes deduplicate members and pairs, and require completed attendance", async () => {
  const sql = await makeDb();
  const f = await pair(sql);
  const start = f.now + 86400_000;
  const session = await pace.postSession(sql, f.host, {
    venueId: "katy",
    activity: "run",
    title: "Second shared run",
    detail: "",
    ability: { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 1 },
    abilityFlex: "strict",
    startAt: new Date(start).toISOString(),
    durationMin: 30,
    capacity: 2,
    visibility: "public",
    joinMode: "instant",
    womenOnly: false,
  });
  const booking = await pace.bookSeat(sql, f.member, session.id);
  const before = (await operationalOverview(sql, start + 1)).communityOutcomes;
  assert.equal(before.completed_seats, 1);
  assert.equal(before.repeat_pairs, 0);
  await pace.checkInGeo(sql, f.host, booking.id, { lat: 32.8019, lng: -96.8074 }, start);
  await pace.checkInGeo(sql, f.member, booking.id, { lat: 32.8019, lng: -96.8074 }, start);
  const after = (await operationalOverview(sql, start + 1)).communityOutcomes;
  assert.equal(after.completed_seats, 2);
  assert.equal(after.sessions_with_completed_checkins, 2);
  assert.equal(after.members_with_completed_checkins, 2);
  assert.equal(after.pairs, 1);
  assert.equal(after.repeat_pairs, 1);
  const old = (await operationalOverview(sql, start + 31 * 86400_000)).communityOutcomes;
  assert.equal(old.repeat_pairs, 0);
  assert.equal(old.completed_seats, 0);
  assert.doesNotMatch(JSON.stringify(after), new RegExp(`${f.host}|${f.member}`));
});

test("verification recovery remains visible after deletion without exposing provider identities", async () => {
  const sql = await makeDb();
  const now = new Date();
  await sql`insert into persona_creation_intents
    (id, template_id, provider_environment, binding_version, idempotency_key,
     provider_ref, provider_account_ref, cancel_requested, state, review_reason,
     next_attempt_at, created_at, updated_at)
    values
      ('pci_pending_private', 'itmpl_private', 'sandbox', 1, 'private_pending_key',
       null, null, true, 'pending', null, ${now}, ${now}, ${now}),
      ('pci_review_private', 'itmpl_private', 'sandbox', 1, 'private_review_key',
       'inq_private', 'act_private', true, 'review_required', 'account_detected',
       ${now}, ${now}, ${now})`;
  const result = await operationalOverview(sql);
  assert.equal(result.counts.pending_persona_creations, 1);
  assert.equal(result.counts.persona_creation_review_required, 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /pci_pending_private|pci_review_private|itmpl_private|inq_private|act_private|private_.*_key/,
  );
});
