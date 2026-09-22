import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { fitnessPilotOverview, pruneFitnessOutcomes } from "../fitness/outcomes.server.ts";

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
  await pruneFitnessOutcomes(sql, now);
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
    (select count(*)::int from persona_redaction_jobs where state = 'failed') as failed_persona_redactions,
    (select count(*)::int from persona_redaction_jobs where state in ('queued', 'processing')) as pending_persona_redactions,
    (select count(*)::int from persona_creation_intents where state = 'pending') as pending_persona_creations,
    (select count(*)::int from persona_creation_intents where state = 'review_required') as persona_creation_review_required,
    (select count(*)::int from persona_case_cleanup_jobs where state in ('queued','processing','failed')) as pending_persona_case_cleanup,
    (select count(*)::int from persona_case_cleanup_jobs where state = 'review_required' or provider_environment is null) as persona_case_cleanup_review_required,
    (select count(*)::int from persona_case_cleanup_jobs where state = 'monitoring' and next_attempt_at < ${since}) as overdue_persona_case_rescans,
    (select count(*)::int from billing_disputes where status = 'open') as open_fee_disputes,
    (select count(*)::int from billing_checkouts where status = 'refund_pending') as pending_fee_refunds,
    (select count(*)::int from billing_checkouts where status = 'review_required') as billing_review_required,
    (select count(*)::int from billing_deletion_queue where status = 'pending') as pending_billing_deletions,
    (select count(*)::int from reports where status = 'open') as open_reports`;
  const [communityOutcomes] = await sql<Record<string, number>>`with attended as (
      select b.id, s.id as session_id, s.host_id, b.participant_id,
        least(s.host_id, b.participant_id) as member_a,
        greatest(s.host_id, b.participant_id) as member_b
      from bookings b join sessions s on s.id = b.session_id
      where b.status = 'completed' and s.start_at >= ${new Date(now - 30 * 86400_000)} and s.start_at <= ${new Date(now)}
    ), pair_counts as (select member_a, member_b, count(*) as n from attended group by member_a, member_b)
    select (select count(*)::int from attended) as completed_seats,
      (select count(distinct session_id)::int from attended) as sessions_with_completed_checkins,
      (select count(*)::int from (select host_id as id from attended union select participant_id from attended) members) as members_with_completed_checkins,
      (select count(*)::int from pair_counts) as pairs,
      (select count(*)::int from pair_counts where n >= 2) as repeat_pairs,
      (select count(*)::int from agent_negotiations where booking_id is null and created_at >= ${new Date(now - 30 * 86400_000)}) as introductions,
      (select count(*)::int from agent_negotiations where booking_id is null and host_consented and participant_consented and created_at >= ${new Date(now - 30 * 86400_000)}) as joined_introductions,
      (select count(*)::int from agent_negotiations n join bookings b on b.id = n.result_booking_id
        where n.booking_id is null and b.status = 'completed' and n.created_at >= ${new Date(now - 30 * 86400_000)}) as introductions_with_completed_checkins`;
  return {
    since,
    metrics,
    counts,
    manualSync: true,
    retentionDays: 7,
    fitnessPilot: await fitnessPilotOverview(sql, now),
    communityOutcomes,
  };
}
