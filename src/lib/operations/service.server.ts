import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";

export type OperationComponent = "health" | "fitness" | "agents";
export async function recordOperation(
  sql: Sql,
  event: {
    component: OperationComponent;
    action: string;
    status: number;
    durationMs: number;
  },
) {
  // Caller supplies the matched route template, never a path containing IDs.
  if (!/^(GET|POST|PUT|DELETE) \/(health|fitness|agents)(\/[a-z:-]+)*$/.test(event.action)) return;
  await sql`insert into operation_events (id, component, action, status, duration_ms)
    values (${randomUUID()}, ${event.component}, ${event.action}, ${event.status},
      ${Math.max(0, Math.round(event.durationMs))})`;
}

export async function pruneOperations(sql: Sql, now = Date.now()) {
  await sql`delete from operation_events where created_at < ${new Date(now - 7 * 86400_000).toISOString()}`;
}

/** Admin-only counts and latency; never returns health records or identities. */
export async function operationalOverview(sql: Sql, now = Date.now()) {
  const since = new Date(now - 86400_000).toISOString();
  const metrics = await sql<{
    component: OperationComponent;
    requests: number;
    server_errors: number;
    conflicts: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  }>`select component, count(*)::int as requests,
    count(*) filter (where status >= 500)::int as server_errors,
    count(*) filter (where status = 409)::int as conflicts,
    percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
    percentile_cont(0.95) within group (order by duration_ms) as p95_ms,
    percentile_cont(0.99) within group (order by duration_ms) as p99_ms
    from operation_events where created_at >= ${since} group by component order by component`;
  const [counts] = await sql<Record<string, number>>`select
    (select count(*)::int from health_connections) as health_connections,
    (select count(*)::int from health_connections where last_synced_at is null) as never_synced,
    (select count(*)::int from health_connections where last_synced_at < ${since}) as not_synced_in_day,
    (select count(*)::int from agent_negotiations where result_booking_id is not null) as assistant_bookings,
    (select count(*)::int from agent_negotiations where state = 'open' and expires_at > now()) as open_negotiations,
    (select count(*)::int from push_deliveries where state = 'failed') as failed_push_deliveries,
    (select count(*)::int from apple_revocation_jobs where state = 'failed') as failed_apple_revocations,
    (select count(*)::int from reports where status = 'open') as open_reports`;
  return { since, metrics, counts, manualSync: true, retentionDays: 7 };
}
