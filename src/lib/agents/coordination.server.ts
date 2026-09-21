/** A bounded first-party two-member planner. No model, health reads, confirmations,
 * or booking mutations. Each committed step is recoverable by the next worker. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { PaceError } from "../pace/service.server.ts";
import { enqueue } from "../pace/notify.server.ts";
import { getPreferences, suggestPlans } from "./assistant.server.ts";
import {
  eligible,
  getNegotiation,
  proposeForCoordinator,
  type Negotiation,
} from "./service.server.ts";
import type { WorkoutPlan } from "./contracts.ts";
import type {
  AssistantCoordination,
  AssistantCoordinationPermission,
  AssistantCoordinationRun,
  AssistantPreferences,
} from "../../../shared/assistant.ts";

const DAY = 86_400_000;
const PERMISSION_LIFETIME = DAY;
const PREFERENCE_FRESHNESS = 7 * DAY;
const RUN_LIFETIME = 10 * 60_000;
const MAX_STEPS = 3;
const iso = (now: number) => new Date(now).toISOString();
const json = <T>(value: T | string): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : value;
const active = (status: string) => status === "queued" || status === "negotiating";
const permissionInput = z.union([
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      preferenceRevision: z.number().int().positive(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);
const startInput = z
  .object({
    requestId: z.string().trim().min(1).max(100),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

type Permission = {
  profile_id: string;
  enabled: boolean;
  revision: number;
  preference_revision: number;
  negotiation_revision: number;
  expires_at: Date;
  updated_at: Date;
};
type Run = {
  id: string;
  negotiation_id: string;
  request_id: string;
  started_by: string;
  status: AssistantCoordinationRun["status"];
  reason: string | null;
  base_revision: number;
  proposal_revision: number;
  host_permission_revision: number;
  participant_permission_revision: number;
  steps_used: number;
  max_steps: number;
  steps: AssistantCoordinationRun["steps"];
  deadline_at: Date;
  created_at: Date;
  updated_at: Date;
};
const runView = (r: Run): AssistantCoordinationRun => ({
  id: r.id,
  status: r.status,
  reason: r.reason,
  baseRevision: r.base_revision,
  proposalRevision: r.proposal_revision,
  stepsUsed: r.steps_used,
  maxSteps: r.max_steps,
  deadlineAt: iso(+new Date(r.deadline_at)),
  createdAt: iso(+new Date(r.created_at)),
  updatedAt: iso(+new Date(r.updated_at)),
  steps: json(r.steps),
});

async function permissions(sql: Sql, room: Negotiation) {
  return sql<Permission>`select * from agent_coordination_permissions
    where negotiation_id = ${room.id} and profile_id in (${room.host_id}, ${room.participant_id})`;
}
function fresh(p: AssistantPreferences, now: number) {
  return (
    p.enabled &&
    p.updatedAt !== null &&
    +new Date(p.updatedAt) <= now &&
    +new Date(p.updatedAt) + PREFERENCE_FRESHNESS > now
  );
}
function permissionValid(
  p: Permission | undefined,
  pref: AssistantPreferences,
  revision: number,
  now: number,
) {
  return (
    !!p &&
    p.enabled &&
    +new Date(p.expires_at) > now &&
    fresh(pref, now) &&
    p.preference_revision === pref.revision &&
    p.negotiation_revision === revision
  );
}
function roomReason(room: Negotiation, now: number, forStart = true): string | null {
  if (+new Date(room.expires_at) <= now) return "This planning conversation has expired.";
  if (room.state !== "open" || room.result_booking_id || room.confirmations.length)
    return "Review the existing proposal. Assistants cannot replace a plan after human approval.";
  if (!room.host_consented || !room.participant_consented)
    return "Both people must opt in to this planning conversation first.";
  if (forStart && room.revision >= 49)
    return "This conversation has reached its automatic planning limit.";
  return null;
}

async function coordinationView(
  sql: Sql,
  room: Negotiation,
  now: number,
): Promise<AssistantCoordination> {
  const grants = await permissions(sql, room);
  const views: AssistantCoordinationPermission[] = [];
  for (const memberId of [room.host_id, room.participant_id]) {
    const p = grants.find((g) => g.profile_id === memberId);
    if (!p) continue;
    const pref = await getPreferences(sql, memberId);
    views.push({
      memberId,
      enabled: p.enabled,
      valid: permissionValid(p, pref, room.revision, now),
      preferenceRevision: p.preference_revision,
      negotiationRevision: p.negotiation_revision,
      expiresAt: iso(+new Date(p.expires_at)),
    });
  }
  const [latest] = await sql<Run>`select * from agent_coordination_runs
    where negotiation_id = ${room.id} order by created_at desc, updated_at desc, id desc limit 1`;
  const reason =
    roomReason(room, now) ??
    (latest && active(latest.status)
      ? "Your assistants are comparing options. You can stop planning at any time."
      : views.filter((p) => p.valid).length === 2
        ? null
        : "Both people must allow automatic proposals using their current entered preferences and this proposal revision.");
  return {
    negotiationId: room.id,
    permissions: views,
    latestRun: latest ? runView(latest) : null,
    ready: reason === null,
    reason,
  };
}

export async function getCoordination(sql: Sql, userId: string, roomId: string, now = Date.now()) {
  return coordinationView(sql, await getNegotiation(sql, userId, roomId), now);
}

/** Signed-in member route only. Revocation remains possible after a block/suspension. */
export async function setCoordinationPermission(
  sql: Sql,
  userId: string,
  roomId: string,
  body: unknown,
  now = Date.now(),
): Promise<AssistantCoordination> {
  const input = permissionInput.parse(body);
  await sql.transaction(async (tx) => {
    if (!input.enabled) {
      const [r] = await tx<Negotiation>`select * from agent_negotiations where id = ${roomId}
        and (host_id = ${userId} or participant_id = ${userId}) for update`;
      if (!r) throw new PaceError(404, "Conversation unavailable.");
      await tx`update agent_coordination_permissions set enabled = false,
        revision = revision + 1, expires_at = ${iso(now)}, updated_at = ${iso(now)}
        where negotiation_id = ${roomId} and profile_id = ${userId} and enabled`;
      await tx`update agent_coordination_runs set status = 'cancelled',
        reason = 'Automatic planning was stopped by a member.', updated_at = ${iso(now)}
        where negotiation_id = ${roomId} and status in ('queued', 'negotiating')`;
      return;
    }
    const room = await getNegotiation(tx, userId, roomId, true, true);
    const reason = roomReason(room, now);
    if (reason) throw new PaceError(409, reason);
    const prefs = await getPreferences(tx, userId);
    if (!fresh(prefs, now))
      throw new PaceError(
        409,
        "Save fresh, enabled planning preferences before allowing automatic proposals.",
      );
    if (prefs.revision !== input.preferenceRevision || room.revision !== input.expectedRevision)
      throw new PaceError(
        409,
        "Preferences or proposal changed. Review them before allowing automatic proposals.",
      );
    const prior = (await permissions(tx, room)).find((p) => p.profile_id === userId);
    if (permissionValid(prior, prefs, room.revision, now)) return;
    const expires = Math.min(
      now + PERMISSION_LIFETIME,
      +new Date(room.expires_at),
      +new Date(prefs.updatedAt!) + PREFERENCE_FRESHNESS,
    );
    await tx`insert into agent_coordination_permissions
      (negotiation_id, profile_id, enabled, preference_revision, negotiation_revision, expires_at, updated_at)
      values (${roomId}, ${userId}, true, ${prefs.revision}, ${room.revision}, ${iso(expires)}, ${iso(now)})
      on conflict (negotiation_id, profile_id) do update set enabled = true,
        revision = agent_coordination_permissions.revision + 1,
        preference_revision = excluded.preference_revision, negotiation_revision = excluded.negotiation_revision,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at`;
  });
  try {
    return await getCoordination(sql, userId, roomId, now);
  } catch (err) {
    if (input.enabled || !(err instanceof PaceError && err.status === 404)) throw err;
    // Do not leak a now-blocked partner's status through the withdrawal route.
    return {
      negotiationId: roomId,
      permissions: [],
      latestRun: null,
      ready: false,
      reason: "Automatic planning has stopped.",
    };
  }
}

/** Durable enqueue is separate so a crashed request is recoverable by the sweep.
 * This does not execute proposals. Only the member HTTP start route calls it. */
export async function enqueueCoordination(
  sql: Sql,
  userId: string,
  roomId: string,
  body: unknown,
  now = Date.now(),
): Promise<string> {
  const input = startInput.parse(body);
  return sql.transaction(async (tx) => {
    const room = await getNegotiation(tx, userId, roomId, true, true);
    const [prior] = await tx<Run>`select * from agent_coordination_runs
      where negotiation_id = ${roomId} and request_id = ${input.requestId}`;
    if (prior) {
      if (prior.started_by !== userId || prior.base_revision !== input.expectedRevision)
        throw new PaceError(409, "That request ID belongs to another planning request.");
      return prior.id;
    }
    const reason = roomReason(room, now);
    if (reason) throw new PaceError(409, reason);
    if (room.revision !== input.expectedRevision)
      throw new PaceError(409, "The proposal changed. Review it before starting.");
    const grants = await permissions(tx, room);
    const [host, partner] = [room.host_id, room.participant_id].map((id) =>
      grants.find((p) => p.profile_id === id),
    );
    if (
      !permissionValid(host, await getPreferences(tx, room.host_id), room.revision, now) ||
      !permissionValid(partner, await getPreferences(tx, room.participant_id), room.revision, now)
    )
      throw new PaceError(
        409,
        "Both people must separately allow automatic proposals for their current preferences.",
      );
    const [pending] = await tx<Run>`select * from agent_coordination_runs
      where negotiation_id = ${roomId} and status in ('queued','negotiating')`;
    if (pending) throw new PaceError(409, "A planning run is already in progress.");
    const [{ n }] = await tx<{ n: number }>`select count(*) n from agent_coordination_runs
      where negotiation_id = ${roomId} and created_at > ${iso(now - DAY)}`;
    if (Number(n) >= 4)
      throw new PaceError(
        409,
        "Automatic planning is limited to four runs per conversation each day. Review a plan together.",
      );
    const id = randomUUID();
    const deadline = Math.min(
      now + RUN_LIFETIME,
      +new Date(host!.expires_at),
      +new Date(partner!.expires_at),
    );
    await tx`insert into agent_coordination_runs
      (id, negotiation_id, request_id, started_by, status, base_revision, proposal_revision,
       host_permission_revision, participant_permission_revision, max_steps, deadline_at, created_at, updated_at)
      values (${id}, ${roomId}, ${input.requestId}, ${userId}, 'queued', ${room.revision}, ${room.revision},
        ${host!.revision}, ${partner!.revision}, ${MAX_STEPS}, ${iso(deadline)}, ${iso(now)}, ${iso(now)})`;
    return id;
  });
}

async function stop(tx: Sql, run: Run, status: Run["status"], reason: string, now: number) {
  const [next] =
    await tx<Run>`update agent_coordination_runs set status = ${status}, reason = ${reason},
    updated_at = ${iso(now)} where id = ${run.id} returning *`;
  return runView(next);
}

// JSONB does not retain insertion order. Compare semantic plan fields instead.
const key = (plan: WorkoutPlan) =>
  JSON.stringify([
    plan.activity,
    Object.entries(plan.ability).sort(([a], [b]) => a.localeCompare(b)),
    plan.title,
    plan.venueId,
    iso(+new Date(plan.startAt)),
    plan.durationMin,
  ]);
function rank(plans: WorkoutPlan[], prefs: AssistantPreferences): WorkoutPlan[] {
  const distance = (p: WorkoutPlan) =>
    "miles" in p.ability && "miles" in prefs.ability
      ? Math.abs(p.ability.miles - prefs.ability.miles)
      : 0;
  // Entered venue order and distance are explicit preferences; earliest time is
  // the deterministic tie-breaker. Free text is never interpreted as authority.
  return [...plans].sort(
    (a, b) =>
      prefs.venueIds.indexOf(a.venueId) - prefs.venueIds.indexOf(b.venueId) ||
      distance(a) - distance(b) ||
      +new Date(a.startAt) - +new Date(b.startAt) ||
      key(a).localeCompare(key(b)),
  );
}
async function choices(tx: Sql, room: Negotiation, now: number) {
  const h = await suggestPlans(tx, room.host_id, room.id, now);
  const p = await suggestPlans(tx, room.participant_id, room.id, now);
  const plans = [
    ...new Map([...h.candidates, ...p.candidates].map((plan) => [key(plan), plan])).values(),
  ];
  return {
    plans,
    reason: h.reason ?? p.reason ?? "No current option fits both people's preferences.",
  };
}

/** One serializable, bounded step. Profile -> room -> run lock order matches the
 * ordinary proposal/booking gates. No lease can expire while its write continues. */
export async function advanceCoordination(
  sql: Sql,
  runId: string,
  now = Date.now(),
): Promise<AssistantCoordinationRun | null> {
  const started = Date.now();
  return sql.transaction(async (tx) => {
    const [ref] = await tx<Run>`select * from agent_coordination_runs where id = ${runId}`;
    if (!ref) return null;
    const [reference] =
      await tx<Negotiation>`select * from agent_negotiations where id = ${ref.negotiation_id}`;
    if (!reference) return null;
    await tx.query("select id from profiles where id = any($1) order by id for share", [
      [reference.host_id, reference.participant_id],
    ]);
    await tx`select id from agent_negotiations where id = ${ref.negotiation_id} for update`;
    const [run] =
      await tx<Run>`select * from agent_coordination_runs where id = ${runId} for update`;
    if (!run) return null;
    if (!active(run.status)) return runView(run);
    now += Date.now() - started;
    if (now >= +new Date(run.deadline_at))
      return stop(
        tx,
        run,
        "expired",
        "The planning deadline passed. Start again after reviewing your preferences.",
        now,
      );
    let room: Negotiation;
    try {
      room = await getNegotiation(tx, reference.host_id, reference.id, true);
    } catch (err) {
      if (!(err instanceof PaceError && err.status === 404)) throw err;
      return stop(
        tx,
        run,
        "cancelled",
        "This conversation or its planning permission is no longer available.",
        now,
      );
    }
    const reason = roomReason(room, now, false);
    if (reason || room.revision !== run.proposal_revision)
      return stop(
        tx,
        run,
        "cancelled",
        reason ?? "A person or another agent changed the proposal. Review their changes.",
        now,
      );
    const grants = await permissions(tx, room);
    const host = grants.find((p) => p.profile_id === room.host_id),
      partner = grants.find((p) => p.profile_id === room.participant_id);
    const hp = await getPreferences(tx, room.host_id),
      pp = await getPreferences(tx, room.participant_id);
    if (
      !permissionValid(host, hp, run.base_revision, now) ||
      !permissionValid(partner, pp, run.base_revision, now) ||
      host!.revision !== run.host_permission_revision ||
      partner!.revision !== run.participant_permission_revision
    )
      return stop(
        tx,
        run,
        "cancelled",
        "Planning preferences or permission changed. Both people must opt in again.",
        now,
      );
    if (run.steps_used >= run.max_steps)
      return stop(
        tx,
        run,
        "no_match",
        "The planning step limit was reached. Review the options together.",
        now,
      );
    await eligible(tx, [room.host_id, room.participant_id]);
    const available = await choices(tx, room, now);
    if (!available.plans.length) return stop(tx, run, "no_match", available.reason, now);
    const hostOrder = rank(available.plans, hp),
      partnerOrder = rank(available.plans, pp);
    let actor = room.host_id;
    let action: AssistantCoordinationRun["steps"][number]["action"] = "proposed";
    let nextRevision = room.revision;
    let nextStatus: Run["status"] = "negotiating";
    if (run.steps_used < 2) {
      let chosen = hostOrder[0];
      if (run.steps_used === 1) {
        actor = room.participant_id;
        const hRank = (p: WorkoutPlan) => hostOrder.findIndex((x) => key(x) === key(p));
        const pRank = (p: WorkoutPlan) => partnerOrder.findIndex((x) => key(x) === key(p));
        // A compromise minimizes the worse rank, then total rank, with the
        // responding member deciding ties. Every choice passed both hard gates.
        chosen = [...available.plans].sort(
          (a, b) =>
            Math.max(hRank(a), pRank(a)) - Math.max(hRank(b), pRank(b)) ||
            hRank(a) + pRank(a) - hRank(b) - pRank(b) ||
            pRank(a) - pRank(b),
        )[0];
        action =
          room.plan && key(room.plan) === key(chosen) ? "checked_preferences" : "counterproposed";
      }
      if (action !== "checked_preferences") {
        const next = await proposeForCoordinator(
          tx,
          actor,
          room.id,
          `${run.id}:${run.steps_used}`,
          room.revision,
          chosen,
          now,
        );
        nextRevision = next.revision;
      }
    } else {
      if (!room.plan || !available.plans.some((p) => key(p) === key(room.plan!)))
        return stop(
          tx,
          run,
          "no_match",
          "The proposed time or workout is no longer available. Review new options together.",
          now,
        );
      action = "ready_for_review";
      nextStatus = "awaiting_review";
      for (const member of [room.host_id, room.participant_id])
        await enqueue(
          tx,
          {
            profileId: member,
            kind: "agent_coordination_ready",
            category: "sessions",
            title: "Your assistants found a workout",
            body: "Both of you need to review the proposal and booking terms. Nothing has been booked.",
            url: `/assistant?negotiationId=${room.id}`,
            dedupeKey: `agent-run:${run.id}:${member}:review`,
          },
          now,
        );
    }
    const steps = [
      ...json(run.steps),
      {
        number: run.steps_used + 1,
        memberId: actor,
        action,
        proposalRevision: nextRevision,
        createdAt: iso(now),
      },
    ];
    const [next] = await tx<Run>`update agent_coordination_runs set status = ${nextStatus},
      steps_used = steps_used + 1, steps = ${JSON.stringify(steps)}::jsonb,
      proposal_revision = ${nextRevision}, updated_at = ${iso(now)} where id = ${run.id} returning *`;
    return runView(next);
  });
}

export async function startCoordination(
  sql: Sql,
  userId: string,
  roomId: string,
  body: unknown,
  now = Date.now(),
) {
  const started = Date.now();
  const id = await enqueueCoordination(sql, userId, roomId, body, now);
  for (let i = 0; i < MAX_STEPS; i++) {
    const result = await advanceCoordination(sql, id, now + Date.now() - started);
    if (!result || !active(result.status)) break;
  }
  return getCoordination(sql, userId, roomId, now + Date.now() - started);
}

/** Cron recovery is bounded to ten runs by default and at most three steps/run. */
export async function sweepCoordination(sql: Sql, now = Date.now(), limit = 10) {
  z.number().int().min(1).max(20).parse(limit);
  const rows = await sql<{ id: string }>`select id from agent_coordination_runs
    where status in ('queued','negotiating') order by updated_at, id limit ${limit}`;
  const started = Date.now();
  const summary = { processed: 0, awaitingReview: 0, stopped: 0, errors: 0 };
  for (const row of rows) {
    try {
      let result: AssistantCoordinationRun | null = null;
      for (let i = 0; i < MAX_STEPS; i++) {
        result = await advanceCoordination(sql, row.id, now + Date.now() - started);
        if (!result || !active(result.status)) break;
      }
      summary.processed++;
      if (result?.status === "awaiting_review") summary.awaitingReview++;
      else if (result && !active(result.status)) summary.stopped++;
    } catch {
      // A transient DB failure leaves the last committed step recoverable.
      // Repeated failures cannot grant more authority or extend the deadline.
      summary.errors++;
    }
  }
  return summary;
}
