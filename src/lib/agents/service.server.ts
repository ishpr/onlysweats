/** Durable, consent-scoped negotiation. Booking needs separate member-only term approvals. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { getBooking, PaceError } from "../pace/service.server.ts";
import { MIN_LEAD_TIME_MS, validAbility } from "../pace/rules.ts";
import { enqueue } from "../pace/notify.server.ts";
import { delegationInput, proposalCommand, type WorkoutPlan } from "./contracts.ts";
import { agentContactRoomReason } from "./contact.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";

const iso = (n: number) => new Date(n).toISOString();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const id = () => randomUUID();
const HOUR = 3_600_000;
const parseJson = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

export type Delegate = { id: string; profileId: string; label: string };
export type Negotiation = {
  id: string;
  booking_id: string | null;
  host_id: string;
  participant_id: string;
  member_names?: Record<string, string>;
  host_consented: boolean;
  participant_consented: boolean;
  host_contact_revision?: number | null;
  participant_contact_revision?: number | null;
  state: "open" | "approved" | "cancelled";
  revision: number;
  plan: WorkoutPlan | null;
  confirmations: string[];
  expires_at: Date;
  updated_at: Date;
  booking_terms?: import("../../../shared/assistant.ts").AssistantBookingTerms | null;
  booking_terms_hash?: string | null;
  booking_approvals?: string[];
  result_session_id?: string | null;
  result_booking_id?: string | null;
};
export type NegotiationEvent = {
  sequence: number;
  profile_id: string;
  message_id: string;
  command_hash: string;
  kind:
    | "consent"
    | "proposal"
    | "confirmation"
    | "cancel"
    | "booking_approval"
    | "booked"
    | "agent_message";
  revision: number;
  data: Record<string, unknown>;
  created_at: Date;
};

export async function eligible(sql: Sql, people: string[], lock: boolean | "update" = false) {
  const rows = await sql.query<{ id: string }>(
    `select id from profiles where id = any($1) and deleted_at is null and suspended_at is null order by id${lock === "update" ? " for no key update" : lock ? " for share" : ""}`,
    [people],
  );
  if (rows.length !== new Set(people).size) throw new PaceError(404, "Conversation unavailable.");
  const blocks = await sql.query(
    "select 1 from blocks where blocker_id = any($1) and blocked_id = any($1) limit 1",
    [people],
  );
  if (blocks.length) throw new PaceError(404, "Conversation unavailable.");
}

export async function createDelegation(sql: Sql, userId: string, body: unknown, now = Date.now()) {
  const input = delegationInput.parse(body);
  await eligible(sql, [userId]);
  const token = `sp_agent_${randomBytes(32).toString("base64url")}`;
  const grantId = id();
  const expiresAt = iso(now + input.expiresInHours * HOUR);
  await sql.transaction(async (tx) => {
    // Serializes issuance for this member and caps outstanding credentials.
    await tx`select id from profiles where id = ${userId} for update`;
    await eligible(tx, [userId]);
    const [{ n }] = await tx<{ n: number }>`select count(*) as n from agent_delegations
      where profile_id = ${userId} and revoked_at is null and expires_at > ${iso(now)}`;
    if (Number(n) >= 10) throw new PaceError(409, "Revoke an existing agent connection first.");
    await tx`insert into agent_delegations (id, profile_id, label, token_hash, expires_at)
      values (${grantId}, ${userId}, ${input.label}, ${hash(token)}, ${expiresAt})`;
  });
  return { id: grantId, label: input.label, token, expiresAt, scope: "workout:negotiate" };
}

export async function listDelegations(sql: Sql, userId: string) {
  return sql`select id, label, expires_at as "expiresAt", revoked_at as "revokedAt"
    from agent_delegations where profile_id = ${userId} order by created_at desc limit 100`;
}

export async function revokeDelegation(
  sql: Sql,
  userId: string,
  grantId: string,
  now = Date.now(),
) {
  await sql`update agent_delegations set revoked_at = coalesce(revoked_at, ${iso(now)})
    where id = ${grantId} and profile_id = ${userId}`;
}

export async function authenticateDelegate(
  sql: Sql,
  token: string,
  now = Date.now(),
): Promise<Delegate | null> {
  if (!/^sp_agent_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await sql<{ id: string; profile_id: string; label: string }>`
    select d.id, d.profile_id, d.label from agent_delegations d
    join profiles p on p.id = d.profile_id
    where d.token_hash = ${hash(token)} and d.revoked_at is null and d.expires_at > ${iso(now)}
      and p.deleted_at is null and p.suspended_at is null`;
  return row ? { id: row.id, profileId: row.profile_id, label: row.label } : null;
}

export async function createNegotiation(
  sql: Sql,
  userId: string,
  bookingId: string,
  now = Date.now(),
) {
  const b = await getBooking(sql, userId, bookingId);
  if (b.status !== "completed")
    throw new PaceError(409, "Start with a workout you completed together.");
  return sql.transaction(async (tx) => {
    // Ordered member locks serialize both room quotas without taking booking/session locks.
    await eligible(tx, [b.hostId, b.participantId], "update");
    await tx`update agent_negotiations set state = 'cancelled', updated_at = ${iso(now)}
      where booking_id = ${bookingId} and state = 'open' and expires_at <= ${iso(now)}`;
    const [existing] = await tx<Negotiation>`select * from agent_negotiations
      where booking_id = ${bookingId} and state = 'open' limit 1`;
    if (existing) return existing;
    const overQuota = await tx`
      select p.id from profiles p
      where p.id in (${b.hostId}, ${b.participantId}) and (
        select count(*) from agent_negotiations n
        where (n.host_id = p.id or n.participant_id = p.id) and n.state = 'open'
          and n.expires_at > ${iso(now)}) >= 20`;
    if (overQuota.length)
      throw new PaceError(409, "One of you has too many open conversations. Finish one first.");
    const [room] = await tx<Negotiation>`insert into agent_negotiations
      (id, booking_id, host_id, participant_id, host_consented, participant_consented, expires_at)
      values (${id()}, ${bookingId}, ${b.hostId}, ${b.participantId}, ${userId === b.hostId},
        ${userId === b.participantId}, ${iso(now + 7 * 24 * HOUR)})
      on conflict (booking_id) where state = 'open' do nothing returning *`;
    if (!room) return getNegotiationByBooking(tx, userId, bookingId);
    await event(tx, room, userId, id(), "consent", { allowed: true }, now);
    await notifyOther(
      tx,
      room,
      userId,
      "invitation",
      "Plan another workout?",
      "Your workout partner invited you to a planning conversation. Opt in to review proposals.",
      now,
    );
    return room;
  });
}

async function getNegotiationByBooking(sql: Sql, userId: string, bookingId: string) {
  const [room] = await sql<Negotiation>`select * from agent_negotiations
    where booking_id = ${bookingId} and state = 'open'`;
  if (!room) throw new PaceError(409, "Conversation changed. Try again.");
  return getNegotiation(sql, userId, room.id);
}

export async function getNegotiation(
  sql: Sql,
  userId: string,
  roomId: string,
  agent = false,
  lock = false,
  now = Date.now(),
) {
  let [r] = await sql.query<Negotiation>(
    "select * from agent_negotiations where id = $1 and (host_id = $2 or participant_id = $2)",
    [roomId, userId],
  );
  if (!r) throw new PaceError(404, "Conversation unavailable.");
  await eligible(sql, [r.host_id, r.participant_id], lock);
  if (lock) {
    [r] = await sql<Negotiation>`select * from agent_negotiations where id = ${roomId} for update`;
    if (!r) throw new PaceError(404, "Conversation unavailable.");
  }
  if (agent && (!r.host_consented || !r.participant_consented)) {
    throw new PaceError(404, "Conversation unavailable.");
  }
  if (agent && (await agentContactRoomReason(sql, r, now, false)))
    throw new PaceError(404, "Conversation unavailable.");
  return {
    ...r,
    // Human invitations need recognizable names before consent. A delegated
    // agent receives no added profile data through this path.
    ...(!agent
      ? {
          member_names: Object.fromEntries(
            (
              await sql<{
                id: string;
                name: string;
              }>`select id, name from profiles where id in (${r.host_id}, ${r.participant_id})`
            ).map((p) => [p.id, p.name]),
          ),
        }
      : {}),
    plan: parseJson(r.plan),
    confirmations: parseJson(r.confirmations),
    booking_terms: parseJson(r.booking_terms ?? null),
    booking_approvals: parseJson(r.booking_approvals ?? []),
  };
}

/** Revocation remains available after suspension or a partner block. Ownership is
 * still required; this path can only remove authority, never restore it. */
async function withdrawalRoom(sql: Sql, userId: string, roomId: string, lock = false) {
  const [r] = await sql.query<Negotiation>(
    `select * from agent_negotiations where id = $1 and (host_id = $2 or participant_id = $2)${lock ? " for update" : ""}`,
    [roomId, userId],
  );
  if (!r) throw new PaceError(404, "Conversation unavailable.");
  return {
    ...r,
    plan: parseJson(r.plan),
    confirmations: parseJson(r.confirmations),
    booking_terms: parseJson(r.booking_terms ?? null),
    booking_approvals: parseJson(r.booking_approvals ?? []),
  };
}

export async function listNegotiations(sql: Sql, userId: string, agent = false) {
  const rows = await sql<{ id: string }>`select id from agent_negotiations
    where host_id = ${userId} or participant_id = ${userId} order by updated_at desc, id limit 100`;
  const visible: Negotiation[] = [];
  for (const row of rows) {
    try {
      visible.push(await getNegotiation(sql, userId, row.id, agent));
    } catch (err) {
      if (!(err instanceof PaceError && err.status === 404)) throw err;
    }
  }
  return visible;
}

/** Expiration is a state transition even when no request has updated the row. */
export function statusTimestamp(room: Negotiation, now = Date.now()): string {
  return new Date(
    room.state === "open" && +new Date(room.expires_at) <= now ? room.expires_at : room.updated_at,
  ).toISOString();
}

/**
 * A2A pagination operates on the full authorized collection. Filter consent,
 * safety, context and effective state before paging; the human activity list's
 * latest-100 limit must not silently hide older matching agent tasks.
 */
export async function listAgentNegotiations(
  sql: Sql,
  userId: string,
  input: {
    pageSize: number;
    offset: number;
    contextId?: string;
    state?: "open" | "approved" | "cancelled" | "unsupported";
    statusTimestampAfter?: string;
  },
  now = Date.now(),
): Promise<{ rooms: Negotiation[]; total: number }> {
  const [result] = await sql.query<{ rooms: Negotiation[] | string; total: number }>(
    `
    with visible as (
      select n.*,
        case when n.state = 'open' and n.expires_at <= $2 then 'cancelled' else n.state end as effective_state,
        case when n.state = 'open' and n.expires_at <= $2 then n.expires_at else n.updated_at end as effective_updated_at
      from agent_negotiations n
      join profiles h on h.id = n.host_id and h.deleted_at is null and h.suspended_at is null
      join profiles p on p.id = n.participant_id and p.deleted_at is null and p.suspended_at is null
      where (n.host_id = $1 or n.participant_id = $1) and n.host_consented and n.participant_consented
        and (n.host_contact_revision is null or (
          select count(*) from agent_contact_authorities a
          join agent_preferences ap on ap.profile_id = a.profile_id
          left join agent_discovery_consents d on d.profile_id = a.profile_id
          where ((a.profile_id = n.host_id and a.revision = n.host_contact_revision)
            or (a.profile_id = n.participant_id and a.revision = n.participant_contact_revision))
            and a.enabled and a.terms_version = $8
            and exists(select 1 from app_terms_acceptances ta where ta.user_id = a.profile_id and ta.version = $8)
            and ap.preferences->>'enabled' = 'true' and ap.updated_at <= $2
            and ap.updated_at > $2::timestamptz - interval '7 days'
            and not (coalesce(d.updated_at > coalesce(a.legacy_discovery_updated_at, '-infinity'::timestamptz), false)
              and d.enabled = false)
            and (not (case when d.updated_at > coalesce(a.legacy_discovery_updated_at, '-infinity'::timestamptz)
              then d.women_only else a.women_only end) or (h.gender = 'woman' and p.gender = 'woman'))
          ) = 2)
        and not exists (select 1 from blocks b
          where (b.blocker_id = n.host_id and b.blocked_id = n.participant_id)
             or (b.blocker_id = n.participant_id and b.blocked_id = n.host_id))
    ), filtered as (
      select * from visible where ($3::text is null or id = $3)
        and ($4::text is null or effective_state = $4)
        and ($5::timestamptz is null or effective_updated_at >= $5)
    ), page as (
      select * from filtered order by effective_updated_at desc, id limit $6 offset $7
    )
    select (select count(*) from filtered) as total,
      coalesce((select jsonb_agg(to_jsonb(page) order by effective_updated_at desc, id) from page), '[]'::jsonb) as rooms`,
    [
      userId,
      iso(now),
      input.contextId ?? null,
      input.state ?? null,
      input.statusTimestampAfter ?? null,
      input.pageSize,
      input.offset,
      APP_TERMS_VERSION,
    ],
  );
  return {
    total: Number(result.total),
    rooms: parseJson<Negotiation[]>(result.rooms).map((room) => ({
      ...room,
      plan: parseJson(room.plan),
      confirmations: parseJson(room.confirmations),
    })),
  };
}

function assertOpen(r: Negotiation, now: number) {
  if (r.state !== "open" || +new Date(r.expires_at) <= now) {
    throw new PaceError(409, "This conversation has ended.");
  }
}

export async function event(
  sql: Sql,
  r: Negotiation,
  userId: string,
  messageId: string,
  kind: NegotiationEvent["kind"],
  data: object,
  now: number,
  commandHash = "",
) {
  await sql`insert into agent_negotiation_events
    (negotiation_id, profile_id, message_id, command_hash, kind, revision, data, created_at)
    values (${r.id}, ${userId}, ${messageId}, ${commandHash}, ${kind}, ${r.revision},
      ${JSON.stringify(data)}::jsonb, ${iso(now)})`;
}

async function notifyOther(
  sql: Sql,
  r: Negotiation,
  userId: string,
  kind: string,
  title: string,
  body: string,
  now: number,
) {
  await enqueue(
    sql,
    {
      profileId: r.host_id === userId ? r.participant_id : r.host_id,
      kind: `assistant_${kind}`,
      category: "sessions",
      title,
      body,
      url: `/agent-chat/${r.id}`,
      dedupeKey: `assistant:${r.id}:${kind}:${r.revision}:${userId}`,
    },
    now,
  );
}

export async function consentToNegotiation(
  sql: Sql,
  userId: string,
  roomId: string,
  allow: boolean,
  now = Date.now(),
) {
  return sql.transaction(async (tx) => {
    const r = allow
      ? await getNegotiation(tx, userId, roomId, false, true)
      : await withdrawalRoom(tx, userId, roomId, true);
    if (allow) assertOpen(r, now);
    await tx`update agent_negotiations set
      host_consented = case when host_id = ${userId} then ${allow} else host_consented end,
      participant_consented = case when participant_id = ${userId} then ${allow} else participant_consented end,
      state = case when ${allow} then state else 'cancelled' end,
      confirmations = case when ${allow} then confirmations else '[]'::jsonb end,
      booking_approvals = case when ${allow} then booking_approvals else '[]'::jsonb end,
      updated_at = ${iso(now)} where id = ${roomId}`;
    await event(tx, r, userId, id(), "consent", { allowed: allow }, now);
    return allow ? getNegotiation(tx, userId, roomId) : withdrawalRoom(tx, userId, roomId);
  });
}

export async function validatePlan(sql: Sql, plan: WorkoutPlan, now: number) {
  const start = +new Date(plan.startAt);
  if (start < now + MIN_LEAD_TIME_MS || start > now + 14 * 24 * HOUR) {
    throw new PaceError(400, "Propose a start between 30 minutes and 14 days from now.");
  }
  const valid = validAbility(plan.activity, plan.ability);
  if (!valid.ok) throw new PaceError(400, valid.error);
  if (!(await sql`select id from venues where id = ${plan.venueId}`).length) {
    throw new PaceError(400, "Choose a known public meeting venue.");
  }
}

export async function propose(
  sql: Sql,
  actor: Delegate,
  roomId: string,
  messageId: string,
  input: unknown,
  now = Date.now(),
) {
  return proposeAs(sql, actor.profileId, roomId, messageId, input, actor, now);
}

/** A signed-in human can propose or counter without issuing a delegation. */
export async function proposeForMember(
  sql: Sql,
  userId: string,
  roomId: string,
  input: unknown,
  now = Date.now(),
) {
  const body = z
    .object({
      messageId: z.string().min(1).max(100),
      expectedRevision: z.number().int().min(0),
      plan: proposalCommand.shape.plan,
    })
    .strict()
    .parse(input);
  return proposeAs(
    sql,
    userId,
    roomId,
    body.messageId,
    {
      schema: "samepace.workout-proposal.v1",
      action: "propose",
      expectedRevision: body.expectedRevision,
      plan: body.plan,
    },
    false,
    now,
  );
}

/** Internal runner only: its caller holds the room and both versioned permissions.
 * Uses the delegated proposal boundary, and cannot reopen human approvals. */
export async function proposeForCoordinator(
  sql: Sql,
  userId: string,
  roomId: string,
  messageId: string,
  expectedRevision: number,
  plan: WorkoutPlan,
  now: number,
) {
  return proposeAs(
    sql,
    userId,
    roomId,
    messageId,
    {
      schema: "samepace.workout-proposal.v1",
      action: "propose",
      expectedRevision,
      plan,
    },
    "coordinator",
    now,
  );
}

async function proposeAs(
  sql: Sql,
  userId: string,
  roomId: string,
  messageId: string,
  input: unknown,
  actor: Delegate | false | "coordinator",
  now: number,
) {
  const command = proposalCommand.parse(input);
  z.string().min(1).max(100).parse(messageId);
  const digest = hash(JSON.stringify(command));
  return sql.transaction(async (tx) => {
    const r = await getNegotiation(tx, userId, roomId, true, true, now);
    const contactReason = await agentContactRoomReason(tx, r, now);
    if (contactReason) throw new PaceError(409, contactReason);
    if (actor && actor !== "coordinator") await assertActiveDelegate(tx, actor, now);
    const [prior] = await tx<{
      command_hash: string;
    }>`select command_hash from agent_negotiation_events
      where negotiation_id = ${roomId} and profile_id = ${userId} and message_id = ${messageId}`;
    if (prior) {
      if (prior.command_hash !== digest)
        throw new PaceError(409, "Message ID was already used for another proposal.");
      return r;
    }
    // Human counteroffers can replace an approved but not executed plan. A delegated
    // assistant retains the original protocol boundary and cannot reopen approvals.
    if (!actor && r.state === "approved" && !r.result_booking_id) {
      if (+new Date(r.expires_at) <= now) throw new PaceError(409, "This conversation has ended.");
    } else assertOpen(r, now);
    if (r.revision !== command.expectedRevision)
      throw new PaceError(409, "Proposal changed. Read the latest revision first.");
    if (r.revision >= 50) throw new PaceError(409, "This conversation reached its proposal limit.");
    await validatePlan(tx, command.plan, now);
    const [next] =
      await tx<Negotiation>`update agent_negotiations set revision = revision + 1, state = 'open',
      plan = ${JSON.stringify(command.plan)}::jsonb, confirmations = '[]'::jsonb,
      booking_approvals = '[]'::jsonb, booking_terms = null, booking_terms_hash = null, updated_at = ${iso(now)}
      where id = ${roomId} returning *`;
    await event(
      tx,
      next,
      userId,
      messageId,
      "proposal",
      {
        plan: command.plan,
        agentLabel: actor === "coordinator" ? "SamePace assistant" : actor ? actor.label : "Member",
        actorKind: actor ? "agent" : "member",
        source:
          actor === "coordinator"
            ? r.host_contact_revision != null
              ? "agent_contact"
              : "first_party_agent"
            : actor
              ? "delegated_agent"
              : "member",
        ...(actor === "coordinator" && r.host_contact_revision != null
          ? {
              authorityRevision:
                userId === r.host_id ? r.host_contact_revision : r.participant_contact_revision,
              preferenceRevision: (
                await tx<{ preference_revision: number }>`select preference_revision
            from agent_coordination_permissions where negotiation_id = ${roomId} and profile_id = ${userId}`
              )[0]?.preference_revision,
              message: {
                messageId,
                taskId: roomId,
                contextId: roomId,
                role: "ROLE_AGENT",
                parts: [{ data: command, mediaType: "application/json" }],
              },
            }
          : {}),
        requiresHumanConfirmation: true,
      },
      now,
      digest,
    );
    await notifyOther(
      tx,
      next,
      userId,
      "proposal",
      "A workout proposal is ready",
      "Review the latest plan. Earlier approvals no longer apply to a changed proposal.",
      now,
    );
    return next;
  });
}

/** Only exposed under the normal member API, never through the A2A transport. */
export async function confirmProposal(
  sql: Sql,
  userId: string,
  roomId: string,
  revision: number,
  now = Date.now(),
) {
  return sql.transaction(async (tx) => {
    const r = await getNegotiation(tx, userId, roomId, false, true);
    if (r.state === "approved" && r.revision === revision) return r;
    assertOpen(r, now);
    if (!r.host_consented || !r.participant_consented || !r.plan || r.revision !== revision) {
      throw new PaceError(409, "Both people must opt in and review the latest proposal.");
    }
    await validatePlan(tx, r.plan, now);
    const approvals = [...new Set([...r.confirmations, userId])];
    const [next] = await tx<Negotiation>`update agent_negotiations set
      confirmations = ${JSON.stringify(approvals)}::jsonb,
      state = ${approvals.length === 2 ? "approved" : "open"}, updated_at = ${iso(now)}
      where id = ${roomId} returning *`;
    if (!r.confirmations.includes(userId)) {
      await event(
        tx,
        r,
        userId,
        id(),
        "confirmation",
        { approvedRevision: revision, booked: false },
        now,
      );
      await notifyOther(
        tx,
        r,
        userId,
        "confirmation",
        "Your partner reviewed the plan",
        "Review the current proposal and its booking terms in your planning conversation.",
        now,
      );
    }
    return next;
  });
}

async function assertActiveDelegate(sql: Sql, actor: Delegate, now: number) {
  const grant = await sql`select id from agent_delegations where id = ${actor.id}
    and profile_id = ${actor.profileId} and revoked_at is null and expires_at > ${iso(now)} for share`;
  if (!grant.length) throw new PaceError(403, "Agent connection expired or was revoked.");
}

export async function cancelNegotiation(
  sql: Sql,
  userId: string,
  roomId: string,
  agent: Delegate | false = false,
  now = Date.now(),
) {
  return sql.transaction(async (tx) => {
    const r = agent
      ? await getNegotiation(tx, userId, roomId, true, true, now)
      : await withdrawalRoom(tx, userId, roomId, true);
    if (agent) {
      if (agent.profileId !== userId) throw new PaceError(404, "Conversation unavailable.");
      await assertActiveDelegate(tx, agent, now);
    }
    if (r.state === "cancelled") return r;
    if (!agent && r.state === "approved" && !r.result_booking_id) {
      // Canceling an unexecuted plan only withdraws authority; no seat exists.
    } else assertOpen(r, now);
    await tx`update agent_negotiations set state = 'cancelled', confirmations = '[]'::jsonb,
      booking_approvals = '[]'::jsonb,
      updated_at = ${iso(now)} where id = ${roomId}`;
    await event(
      tx,
      r,
      userId,
      id(),
      "cancel",
      {
        booked: false,
        actorKind: agent ? "agent" : "member",
        source: agent ? "delegated_agent" : "member",
        agentLabel: agent ? agent.label : "Member",
      },
      now,
    );
    return agent
      ? getNegotiation(tx, userId, roomId, true, false, now)
      : withdrawalRoom(tx, userId, roomId);
  });
}

export async function history(sql: Sql, r: Negotiation, limit = 20) {
  const n = z.number().int().min(0).max(100).parse(limit);
  const rows = await sql<NegotiationEvent>`select * from agent_negotiation_events
    where negotiation_id = ${r.id} order by sequence desc limit ${n}`;
  return rows.reverse();
}

/** Human API DTO: no tokens, precise pin, or raw calendar information. */
export function view(r: Negotiation, now = Date.now()) {
  return {
    id: r.id,
    bookingId: r.booking_id,
    ...(r.member_names ? { memberNames: r.member_names } : {}),
    memberIds: [r.host_id, r.participant_id],
    consentedIds: [
      r.host_consented ? r.host_id : null,
      r.participant_consented ? r.participant_id : null,
    ].filter(Boolean),
    state: r.state === "open" && +new Date(r.expires_at) <= now ? "expired" : r.state,
    revision: r.revision,
    plan: r.plan,
    confirmedIds: r.confirmations,
    expiresAt: new Date(r.expires_at).toISOString(),
    booked: Boolean(r.result_booking_id),
    sessionId: r.result_session_id ?? null,
    resultBookingId: r.result_booking_id ?? null,
  };
}
