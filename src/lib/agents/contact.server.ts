/** Durable first-party outreach. Only current Terms and entered preferences grant
 * authority; model output, old discovery grants and health data never do. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { PaceError } from "../pace/service.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import type { AgentMatching } from "../../../shared/agent-matching.ts";
import { candidatePlans, getPreferences } from "./assistant.server.ts";
import { advanceCoordination, enqueueCoordination } from "./coordination.server.ts";
import { introductionBar, requireIntroduction } from "./introductions.server.ts";
import { eligible, event, type Negotiation } from "./service.server.ts";
import { abilityLabel } from "../pace/rules.ts";

const DAY = 86_400_000;
const SCAN_INTERVAL = 60 * 60_000;
const iso = (n: number) => new Date(n).toISOString();
const input = z.strictObject({ enabled: z.boolean(), womenOnly: z.boolean().optional() });
type Authority = {
  profile_id: string;
  enabled: boolean;
  revision: number;
  terms_version: string;
  accepted_at: Date;
  women_only: boolean;
  legacy_discovery_updated_at: Date | null;
  next_scan_at: Date;
  last_scan_at: Date | null;
  last_reason: string | null;
};
type Legacy = { enabled: boolean; women_only: boolean; updated_at: Date };

async function stopAutomaticRooms(tx: Sql, userId: string, now: number) {
  // Profile locks serialize this with every coordinator step and human booking.
  await tx`update agent_negotiations set state = 'cancelled', confirmations = '[]'::jsonb,
    booking_approvals = '[]'::jsonb, updated_at = ${iso(now)}
    where host_contact_revision is not null and result_booking_id is null and state <> 'cancelled'
      and (host_id = ${userId} or participant_id = ${userId})`;
  await tx`update agent_coordination_runs set status = 'cancelled',
    reason = 'Agent matching permission changed.', updated_at = ${iso(now)}
    where status in ('queued', 'negotiating') and negotiation_id in
      (select id from agent_negotiations where host_contact_revision is not null
       and (host_id = ${userId} or participant_id = ${userId}))`;
}

/** Called inside acceptance, after its current-version receipt has been inserted.
 * Reacceptance does not restore either matching or legacy discovery opt-outs. */
export async function initializeAgentContactsFromTerms(tx: Sql, userId: string, now = Date.now()) {
  const [member] = await tx<{ suspended_at: Date | null }>`select suspended_at from profiles
    where id = ${userId} and deleted_at is null for no key update`;
  if (!member) return;
  const [receipt] = await tx<{ accepted_at: Date }>`select accepted_at from app_terms_acceptances
    where user_id = ${userId} and version = ${APP_TERMS_VERSION}`;
  if (!receipt) throw new PaceError(409, "Review the current SamePace Terms first.");
  const [legacy] =
    await tx<Legacy>`select enabled, women_only, updated_at from agent_discovery_consents
    where profile_id = ${userId}`;
  const [prior] =
    await tx<Authority>`select * from agent_contact_authorities where profile_id = ${userId}`;
  if (prior?.terms_version === APP_TERMS_VERSION) return;
  if (prior) await stopAutomaticRooms(tx, userId, now);
  await tx`insert into agent_contact_authorities
    (profile_id, enabled, terms_version, accepted_at, women_only, legacy_discovery_updated_at, updated_at, next_scan_at)
    values (${userId}, ${member.suspended_at === null && legacy?.enabled !== false}, ${APP_TERMS_VERSION},
      ${receipt.accepted_at}, ${legacy?.women_only ?? false}, ${legacy?.updated_at ?? null}, ${iso(now)}, ${iso(now)})
    on conflict (profile_id) do update set terms_version = excluded.terms_version,
      accepted_at = excluded.accepted_at, revision = agent_contact_authorities.revision + 1,
      updated_at = excluded.updated_at, next_scan_at = excluded.next_scan_at`;
}

async function state(sql: Sql, userId: string, now: number, checkIntroduction = true) {
  const [member] = await sql<{ eligible: boolean; woman: boolean }>`select
    (deleted_at is null and suspended_at is null) as eligible,
    (gender is not distinct from 'woman') as woman from profiles where id = ${userId} and deleted_at is null`;
  if (!member) throw new PaceError(404, "Matching unavailable.");
  const [authority] =
    await sql<Authority>`select * from agent_contact_authorities where profile_id = ${userId}`;
  const [receipt] = await sql`select 1 from app_terms_acceptances
    where user_id = ${userId} and version = ${APP_TERMS_VERSION}`;
  const [legacy] =
    await sql<Legacy>`select enabled, women_only, updated_at from agent_discovery_consents
    where profile_id = ${userId}`;
  const laterLegacy = Boolean(
    legacy &&
    (!authority?.legacy_discovery_updated_at ||
      +new Date(legacy.updated_at) > +new Date(authority.legacy_discovery_updated_at)),
  );
  const optedOut = laterLegacy && legacy?.enabled === false;
  const preferences = await getPreferences(sql, userId);
  const womenOnly = Boolean(laterLegacy ? legacy?.women_only : authority?.women_only);
  const enabled = Boolean(authority?.enabled && !optedOut);
  let reason: string | null = null;
  let needs: string | null = null;
  if (!receipt || authority?.terms_version !== APP_TERMS_VERSION) {
    reason = "Review the current SamePace Terms to continue.";
    needs = "terms";
  } else if (!enabled) reason = "Agent matching is paused in your privacy controls.";
  else if (!member.eligible) reason = "Agent matching is unavailable for this account.";
  else if (womenOnly && !member.woman) reason = "Review your partner preferences.";
  else if (
    !preferences.enabled ||
    !preferences.updatedAt ||
    +new Date(preferences.updatedAt) > now ||
    +new Date(preferences.updatedAt) <= now - 7 * DAY
  ) {
    reason =
      "Save current workout preferences and available times so your agent can find a partner.";
    needs = "preferences";
  } else if (checkIntroduction) {
    const bar = await introductionBar(sql, userId, now, { womenOnly });
    if (bar) {
      reason = bar.message;
      needs = bar.code ?? null;
    }
  }
  return { authority, preferences, womenOnly, woman: member.woman, enabled, reason, needs };
}

export async function getAgentMatching(
  sql: Sql,
  userId: string,
  now = Date.now(),
): Promise<AgentMatching> {
  const current = await state(sql, userId, now);
  return {
    enabled: current.enabled,
    ready: current.reason === null,
    reason: current.reason ?? current.authority?.last_reason ?? null,
    needs: current.needs,
    lastCheckedAt: current.authority?.last_scan_at
      ? iso(+new Date(current.authority.last_scan_at))
      : null,
    womenOnly: current.womenOnly,
    canChooseWomenOnly: current.woman,
  };
}

/** Bounded read only: public record plus mutually compatible entered preferences. */
export async function agentContactCandidates(sql: Sql, userId: string, now = Date.now()) {
  const own = await state(sql, userId, now);
  if (own.reason) return { candidates: [], reason: own.reason };
  const rows = await sql<{ id: string; name: string; completed_count: number }>`
    select p.id,p.name,p.completed_count from agent_contact_authorities a
    join profiles p on p.id=a.profile_id join agent_preferences ap on ap.profile_id=p.id
    where p.id<>${userId} and a.enabled and a.terms_version=${APP_TERMS_VERSION}
      and p.deleted_at is null and p.suspended_at is null
      and ap.updated_at>${iso(now - 7 * DAY)} and ap.updated_at<=${iso(now)}
      and ap.preferences->>'enabled'='true' and ap.preferences->>'activity'=${own.preferences.activity}
      and not exists(select 1 from blocks b where (b.blocker_id=${userId} and b.blocked_id=p.id)
        or (b.blocked_id=${userId} and b.blocker_id=p.id))
      and not exists(select 1 from agent_negotiations n where n.booking_id is null
        and ((n.host_id=${userId} and n.participant_id=p.id) or (n.participant_id=${userId} and n.host_id=p.id))
        and (n.created_at>${iso(now - 7 * DAY)} or (n.state='open' and n.expires_at>${iso(now)})))
    order by md5(p.id||${iso(now).slice(0, 13)}),p.id limit 30`;
  const candidates = [];
  for (const row of rows) {
    const other = await state(sql, row.id, now);
    if (other.reason || (own.womenOnly && !other.woman) || (other.womenOnly && !own.woman))
      continue;
    if (await introductionBar(sql, userId, now, { womenOnly: own.womenOnly || other.womenOnly }))
      continue;
    const plans = await candidatePlans(
      sql,
      own.preferences,
      other.preferences,
      [userId, row.id],
      now,
    );
    if (!plans.candidates.length) continue;
    candidates.push({
      memberId: row.id,
      firstName: row.name.trim().split(/\s+/)[0],
      activity: other.preferences.activity,
      level: abilityLabel(other.preferences.ability),
      completedCount: row.completed_count,
      sharedTimes: plans.candidates
        .slice(0, 3)
        .map((p) => ({ startAt: p.startAt, durationMin: p.durationMin, venueId: p.venueId })),
      preferenceRevision: own.preferences.revision,
      partnerPreferenceRevision: other.preferences.revision,
      authorityRevision: own.authority!.revision,
      partnerAuthorityRevision: other.authority!.revision,
    });
    if (candidates.length === 3) break;
  }
  return {
    candidates,
    reason: candidates.length ? null : "No compatible partner is available in this search.",
  };
}

export const requestedContactInput = z.strictObject({
  memberId: z.string().min(1).max(100),
  preferenceRevision: z.number().int().positive(),
  partnerPreferenceRevision: z.number().int().positive(),
  authorityRevision: z.number().int().positive(),
  partnerAuthorityRevision: z.number().int().positive(),
});

/** A member tap asks their agent to make this contact; it never sends a direct message. */
export async function requestAgentContact(
  sql: Sql,
  userId: string,
  body: unknown,
  now = Date.now(),
) {
  const args = requestedContactInput.parse(body);
  if (args.memberId === userId) throw new PaceError(400, "Choose a workout partner.");
  return sql.transaction(async (tx) => {
    await eligible(tx, [userId, args.memberId], "update");
    const own = await state(tx, userId, now),
      other = await state(tx, args.memberId, now);
    if (
      own.preferences.revision !== args.preferenceRevision ||
      other.preferences.revision !== args.partnerPreferenceRevision ||
      own.authority?.revision !== args.authorityRevision ||
      other.authority?.revision !== args.partnerAuthorityRevision
    )
      throw new PaceError(409, "Partner preferences changed. Ask your agent to check again.");
    const runId = await contact(tx, userId, args.memberId, now);
    if (!runId) throw new PaceError(409, "This introduction is no longer available.");
    const [run] = await tx<{
      negotiation_id: string;
    }>`select negotiation_id from agent_coordination_runs where id=${runId}`;
    return { negotiationId: run.negotiation_id };
  });
}

export async function setAgentMatching(sql: Sql, userId: string, body: unknown, now = Date.now()) {
  const parsed = input.parse(body);
  await sql.transaction(async (tx) => {
    if (parsed.enabled) await eligible(tx, [userId], "update");
    else {
      const rows =
        await tx`select id from profiles where id = ${userId} and deleted_at is null for no key update`;
      if (!rows.length) throw new PaceError(404, "Matching unavailable.");
    }
    const current = await state(tx, userId, now);
    if (parsed.enabled && current.needs === "terms") throw new PaceError(409, current.reason!);
    if (!current.authority) {
      if (parsed.enabled) throw new PaceError(409, "Review the current SamePace Terms first.");
      // A privacy withdrawal before initial Terms acceptance must still survive
      // acceptance later. Record the explicit choice using the existing opt-out.
      await tx`insert into agent_discovery_consents
        (profile_id, enabled, preference_revision, expires_at, updated_at, women_only)
        values (${userId}, false, ${current.preferences.revision}, ${iso(now)}, ${iso(now)}, ${current.womenOnly})
        on conflict (profile_id) do update set enabled = false, updated_at = excluded.updated_at`;
      return;
    }
    const womenOnly = parsed.womenOnly ?? current.womenOnly;
    if (parsed.enabled && womenOnly && !current.woman)
      throw new PaceError(409, "Women-only is chosen by women.");
    if (
      current.authority.enabled === parsed.enabled &&
      current.enabled === parsed.enabled &&
      current.womenOnly === womenOnly
    )
      return;
    const [legacy] =
      await tx<Legacy>`select updated_at from agent_discovery_consents where profile_id = ${userId}`;
    await tx`update agent_contact_authorities set enabled = ${parsed.enabled}, women_only = ${womenOnly},
      revision = revision + 1, legacy_discovery_updated_at = ${legacy?.updated_at ?? null},
      updated_at = ${iso(now)}, next_scan_at = ${iso(now)}, last_reason = null where profile_id = ${userId}`;
    // Changing the audience also invalidates existing automatic rooms.
    await stopAutomaticRooms(tx, userId, now);
  });
  return getAgentMatching(sql, userId, now);
}

/** Coordinator caller already holds both profile locks. Legacy rooms retain their
 * separate grants; automatic rooms must still match both product-authority revisions. */
export async function agentContactRoomReason(
  sql: Sql,
  room: Negotiation,
  now: number,
  checkIntroduction = true,
) {
  if (room.host_contact_revision == null) return null;
  const states = [];
  for (const [memberId, revision] of [
    [room.host_id, room.host_contact_revision],
    [room.participant_id, room.participant_contact_revision],
  ] as const) {
    const current = await state(sql, memberId, now, checkIntroduction);
    states.push(current);
    if (current.reason || current.authority?.revision !== revision)
      return "Agent matching permission or current preferences changed. Review the conversation.";
  }
  const [own, other] = states;
  if ((own.womenOnly && !other.woman) || (other.womenOnly && !own.woman))
    return "Partner preferences changed.";
  if (!checkIntroduction) return null;
  try {
    await requireIntroduction(sql, room.host_id, [room.participant_id], now, {
      womenOnly: own.womenOnly || other.womenOnly,
    });
  } catch (err) {
    if (!(err instanceof PaceError)) throw err;
    return "This introduction is no longer available.";
  }
  return null;
}

export async function agentContactWomenOnly(sql: Sql, room: Negotiation, now: number) {
  const own = await state(sql, room.host_id, now, false),
    other = await state(sql, room.participant_id, now, false);
  return own.womenOnly || other.womenOnly;
}

/** A real service-produced structured exchange, kept separately from human events.
 * It asserts only the deterministic check/action that committed in this transaction. */
export async function agentContactMessage(
  tx: Sql,
  room: Negotiation,
  memberId: string,
  messageId: string,
  action: string,
  preferenceRevision: number,
  now: number,
) {
  const authorityRevision =
    memberId === room.host_id ? room.host_contact_revision : room.participant_contact_revision;
  const data = {
    schema: "samepace.agent-exchange.v1",
    action,
    actorId: memberId,
    proposalRevision: room.revision,
    preferenceRevision,
    authorityRevision,
    requiresHumanConfirmation: true,
  };
  await event(
    tx,
    room,
    memberId,
    messageId,
    "agent_message",
    {
      source: "agent_contact",
      actorKind: "agent",
      agentLabel: "SamePace assistant",
      action,
      authorityRevision,
      preferenceRevision,
      requiresHumanConfirmation: true,
      message: {
        messageId,
        taskId: room.id,
        contextId: room.id,
        role: "ROLE_AGENT",
        parts: [{ data, mediaType: "application/json" }],
      },
    },
    now,
  );
}

async function contact(
  sql: Sql,
  userId: string,
  partnerId: string,
  now: number,
): Promise<string | null> {
  return sql.transaction(async (tx) => {
    await eligible(tx, [userId, partnerId], "update");
    const own = await state(tx, userId, now),
      other = await state(tx, partnerId, now);
    if (
      own.reason ||
      other.reason ||
      (own.womenOnly && !other.woman) ||
      (other.womenOnly && !own.woman)
    )
      return null;
    // A candidate's stricter audience can require a verification tier the caller
    // does not have. Skip that candidate without aborting ordinary matching.
    if (await introductionBar(tx, userId, now, { womenOnly: own.womenOnly || other.womenOnly }))
      return null;
    await requireIntroduction(tx, userId, [partnerId], now, {
      womenOnly: own.womenOnly || other.womenOnly,
    });
    const plans = await candidatePlans(
      tx,
      own.preferences,
      other.preferences,
      [userId, partnerId],
      now,
    );
    if (!plans.candidates.length) return null;
    await tx`update agent_negotiations set state = 'cancelled', updated_at = ${iso(now)}
      where booking_id is null and state = 'open' and expires_at <= ${iso(now)}
        and ((host_id = ${userId} and participant_id = ${partnerId}) or (host_id = ${partnerId} and participant_id = ${userId}))`;
    const existing = await tx`select id from agent_negotiations where booking_id is null
      and ((host_id = ${userId} and participant_id = ${partnerId}) or (host_id = ${partnerId} and participant_id = ${userId}))
      and (created_at > ${iso(now - 7 * DAY)} or (state = 'open' and expires_at > ${iso(now)})) limit 1`;
    // A retry never accepts an old manual invitation or regrants stopped planning.
    if (existing.length) return null;
    const [counts] = await tx<{ outgoing: number; incoming: number; crowded: boolean }>`select
      (select count(*)::int from agent_negotiations where booking_id is null and host_id = ${userId} and created_at > ${iso(now - DAY)}) outgoing,
      (select count(*)::int from agent_negotiations where booking_id is null and participant_id = ${partnerId} and created_at > ${iso(now - DAY)}) incoming,
      exists(select 1 from profiles p where p.id in (${userId}, ${partnerId}) and
        (select count(*) from agent_negotiations n where (n.host_id = p.id or n.participant_id = p.id)
          and n.state = 'open' and n.expires_at > ${iso(now)}) >= 20) crowded`;
    if (counts.outgoing >= 5 || counts.incoming >= 10 || counts.crowded) return null;
    const [room] = await tx<Negotiation>`insert into agent_negotiations
      (id, booking_id, host_id, participant_id, host_consented, participant_consented,
       host_contact_revision, participant_contact_revision, expires_at, created_at, updated_at)
      values (${randomUUID()}, null, ${userId}, ${partnerId}, true, true,
        ${own.authority!.revision}, ${other.authority!.revision}, ${iso(now + DAY)}, ${iso(now)}, ${iso(now)}) returning *`;
    for (const [memberId, current, action] of [
      [userId, own, "contact"],
      [partnerId, other, "matched_preferences"],
    ] as const) {
      const expires = Math.min(now + DAY, +new Date(current.preferences.updatedAt!) + 7 * DAY);
      await tx`insert into agent_coordination_permissions
        (negotiation_id, profile_id, enabled, preference_revision, negotiation_revision, expires_at, updated_at)
        values (${room.id}, ${memberId}, true, ${current.preferences.revision}, 0, ${iso(expires)}, ${iso(now)})`;
      await agentContactMessage(
        tx,
        room,
        memberId,
        randomUUID(),
        action,
        current.preferences.revision,
        now,
      );
    }
    return enqueueCoordination(
      tx,
      userId,
      room.id,
      { requestId: `contact:${room.id}`, expectedRevision: 0 },
      now,
    );
  });
}

async function refreshRoom(sql: Sql, userId: string, roomId: string, now: number) {
  return sql.transaction(async (tx) => {
    const [reference] = await tx<Negotiation>`select * from agent_negotiations where id = ${roomId}
      and (host_id = ${userId} or participant_id = ${userId})`;
    if (!reference) return null;
    await eligible(tx, [reference.host_id, reference.participant_id], "update");
    const [room] =
      await tx<Negotiation>`select * from agent_negotiations where id = ${roomId} for update`;
    if (
      !room ||
      room.host_contact_revision == null ||
      room.result_booking_id ||
      room.state === "cancelled" ||
      !room.host_consented ||
      !room.participant_consented ||
      +new Date(room.expires_at) <= now ||
      (await agentContactRoomReason(tx, room, now))
    )
      return null;
    const grants = await tx<{
      profile_id: string;
      enabled: boolean;
      preference_revision: number;
    }>`select *
      from agent_coordination_permissions where negotiation_id = ${roomId}`;
    const hostGrant = grants.find((p) => p.profile_id === room.host_id),
      partnerGrant = grants.find((p) => p.profile_id === room.participant_id);
    // A derived grant may follow a preference revision, but a member's explicit
    // stop/withdrawal is never restored by an ordinary preference save.
    if (!hostGrant?.enabled || !partnerGrant?.enabled) return null;
    const host = await getPreferences(tx, room.host_id),
      partner = await getPreferences(tx, room.participant_id);
    if (
      hostGrant.preference_revision === host.revision &&
      partnerGrant.preference_revision === partner.revision
    ) {
      const [active] = await tx<{ id: string }>`select id from agent_coordination_runs
        where negotiation_id = ${roomId} and status in ('queued', 'negotiating')`;
      return active?.id ?? null;
    }
    const requestId = `preferences:${host.revision}:${partner.revision}`;
    const [recorded] = await tx`select 1 from agent_negotiation_events
      where negotiation_id = ${roomId} and message_id = ${requestId}`;
    let current = room;
    if (!recorded) {
      [current] = await tx<Negotiation>`update agent_negotiations set plan = null,
        revision = least(revision + 1, 50), state = 'open', confirmations = '[]'::jsonb,
        booking_approvals = '[]'::jsonb, booking_terms = null, booking_terms_hash = null, updated_at = ${iso(now)}
        where id = ${roomId} returning *`;
      await agentContactMessage(
        tx,
        current,
        userId,
        requestId,
        "preferences_changed",
        userId === room.host_id ? host.revision : partner.revision,
        now,
      );
    }
    await tx`update agent_coordination_runs set status = 'cancelled',
      reason = 'Saved preferences changed. A fresh plan needs review.', updated_at = ${iso(now)}
      where negotiation_id = ${roomId} and status in ('queued', 'negotiating')`;
    const [{ n }] = await tx<{ n: number }>`select count(*)::int n from agent_coordination_runs
      where negotiation_id = ${roomId} and created_at > ${iso(now - DAY)}`;
    if (n >= 4 || current.revision >= 49) {
      const messageId = `${requestId}:limit`;
      const [prior] = await tx`select 1 from agent_negotiation_events
        where negotiation_id = ${roomId} and message_id = ${messageId}`;
      if (!prior)
        await agentContactMessage(
          tx,
          current,
          userId,
          messageId,
          "planning_limited",
          userId === room.host_id ? host.revision : partner.revision,
          now,
        );
      return null;
    }
    for (const [memberId, pref] of [
      [room.host_id, host],
      [room.participant_id, partner],
    ] as const) {
      const expires = Math.min(
        now + DAY,
        +new Date(room.expires_at),
        +new Date(pref.updatedAt!) + 7 * DAY,
      );
      await tx`update agent_coordination_permissions set revision = revision + 1,
        preference_revision = ${pref.revision}, negotiation_revision = ${current.revision},
        expires_at = ${iso(expires)}, updated_at = ${iso(now)}
        where negotiation_id = ${roomId} and profile_id = ${memberId} and enabled`;
    }
    return enqueueCoordination(
      tx,
      room.host_id,
      roomId,
      { requestId, expectedRevision: current.revision },
      now,
    );
  });
}

async function refreshAutomaticRooms(sql: Sql, userId: string, now: number) {
  const rows = await sql<{ id: string }>`select n.id from agent_negotiations n
    join agent_coordination_permissions h on h.negotiation_id = n.id and h.profile_id = n.host_id and h.enabled
    join agent_coordination_permissions p on p.negotiation_id = n.id and p.profile_id = n.participant_id and p.enabled
    join agent_preferences hp on hp.profile_id = n.host_id
    join agent_preferences pp on pp.profile_id = n.participant_id
    where n.host_contact_revision is not null and n.result_booking_id is null and n.state <> 'cancelled'
      and n.host_consented and n.participant_consented and n.expires_at > ${iso(now)}
      and (n.host_id = ${userId} or n.participant_id = ${userId})
      and not exists(select 1 from blocks b where (b.blocker_id = n.host_id and b.blocked_id = n.participant_id)
        or (b.blocker_id = n.participant_id and b.blocked_id = n.host_id))
      and (h.preference_revision <> hp.revision or p.preference_revision <> pp.revision or
        exists(select 1 from agent_coordination_runs r where r.negotiation_id = n.id and r.status in ('queued','negotiating')))
      and (n.plan is not null or (n.revision < 49 and
        (select count(*) from agent_coordination_runs r where r.negotiation_id = n.id and r.created_at > ${iso(now - DAY)}) < 4)
        or exists(select 1 from agent_coordination_runs r where r.negotiation_id = n.id and r.status in ('queued','negotiating')))
    order by n.updated_at, n.id limit 3`;
  const runs: string[] = [];
  for (const { id } of rows) {
    try {
      const run = await refreshRoom(sql, userId, id, now);
      if (run) runs.push(run);
    } catch (err) {
      if (!(err instanceof PaceError && [403, 404, 409].includes(err.status))) throw err;
    }
  }
  return { runs, attempted: rows.length };
}

async function advanceContactRuns(sql: Sql, runs: string[], now: number) {
  const started = Date.now();
  for (const runId of runs) {
    try {
      for (let i = 0; i < 3; i++) {
        const result = await advanceCoordination(sql, runId, now + Date.now() - started);
        if (!result || (result.status !== "queued" && result.status !== "negotiating")) break;
      }
    } catch {
      // Committed preferences and queued work survive a failed request worker.
    }
  }
}

async function check(sql: Sql, userId: string, now: number) {
  const refreshed = await refreshAutomaticRooms(sql, userId, now);
  await advanceContactRuns(sql, refreshed.runs, now);
  // Durable bounded claim. No queue lock is held while taking sorted profile locks.
  // A crash before room creation retries after one hour; a crash afterwards leaves
  // an atomic queued run recoverable by the coordinator sweep.
  const [claimed] = await sql<Authority>`update agent_contact_authorities a set
    next_scan_at = ${iso(now + SCAN_INTERVAL)}, last_scan_at = ${iso(now)},
    last_preference_revision = (select revision from agent_preferences where profile_id = a.profile_id)
    where a.profile_id = ${userId} and a.enabled and (a.next_scan_at <= ${iso(now)} or
      a.last_preference_revision is distinct from (select revision from agent_preferences where profile_id = a.profile_id))
    returning a.*`;
  if (!claimed) {
    if (refreshed.attempted)
      await sql`update agent_contact_authorities
      set last_scan_at = ${iso(now)}, next_scan_at = greatest(next_scan_at, ${iso(now + SCAN_INTERVAL)})
      where profile_id = ${userId}`;
    return { checked: refreshed.attempted > 0, contacted: false };
  }
  const own = await state(sql, userId, now);
  let contacted = false;
  let runId: string | null = null;
  if (!own.reason) {
    const rows = await sql<{ id: string }>`select p.id from agent_contact_authorities a
      join profiles p on p.id = a.profile_id join agent_preferences ap on ap.profile_id = p.id
      where p.id <> ${userId} and a.enabled and a.terms_version = ${APP_TERMS_VERSION}
        and p.deleted_at is null and p.suspended_at is null
        and ap.updated_at > ${iso(now - 7 * DAY)} and ap.updated_at <= ${iso(now)}
        and ap.preferences->>'enabled' = 'true' and ap.preferences->>'activity' = ${own.preferences.activity}
        and (not a.women_only or ${own.woman}) and (not ${own.womenOnly} or p.gender = 'woman')
        and not exists(select 1 from blocks b where (b.blocker_id = ${userId} and b.blocked_id = p.id)
          or (b.blocked_id = ${userId} and b.blocker_id = p.id))
        and not exists(select 1 from agent_negotiations n where n.booking_id is null
          and ((n.host_id = ${userId} and n.participant_id = p.id) or (n.participant_id = ${userId} and n.host_id = p.id))
          and (n.created_at > ${iso(now - 7 * DAY)} or (n.state = 'open' and n.expires_at > ${iso(now)})))
      order by md5(p.id || ${iso(now).slice(0, 13)}), p.id limit 30`;
    for (const { id } of rows) {
      try {
        runId = await contact(sql, userId, id, now);
        contacted = runId !== null;
        if (contacted) break;
      } catch (err) {
        // Concurrent suspension/block/deletion simply removes that candidate.
        if (!(err instanceof PaceError && [403, 404, 409].includes(err.status))) throw err;
      }
    }
  }
  // The request promptly runs at most three DB-only steps. Each step commits on
  // its own; an interrupted request remains recoverable by the durable sweep.
  if (runId) await advanceContactRuns(sql, [runId], now);
  const reason =
    own.reason ??
    (contacted
      ? "Your agents are comparing workout options. You will review anything they propose."
      : "Your agent is looking for a partner who fits your workout preferences.");
  await sql`update agent_contact_authorities set last_reason = ${reason}
    where profile_id = ${userId} and revision = ${claimed.revision} and last_scan_at = ${iso(now)}`;
  return { checked: true, contacted };
}

/** Call only after a member mutation (preferences/check), never from a GET. */
export async function checkAgentMatching(sql: Sql, userId: string, now = Date.now()) {
  await check(sql, userId, now);
  return getAgentMatching(sql, userId, now);
}

export async function sweepAgentContacts(sql: Sql, now = Date.now(), limit = 10) {
  limit = Math.max(1, Math.min(20, Math.floor(limit)));
  const rows = await sql<{
    profile_id: string;
  }>`select a.profile_id from agent_contact_authorities a
    join profiles p on p.id = a.profile_id left join agent_preferences ap on ap.profile_id = a.profile_id
    where a.enabled and a.terms_version = ${APP_TERMS_VERSION} and p.deleted_at is null and p.suspended_at is null
      and (a.next_scan_at <= ${iso(now)} or a.last_preference_revision is distinct from ap.revision
        or exists(select 1 from agent_negotiations n
          join agent_coordination_permissions h on h.negotiation_id = n.id and h.profile_id = n.host_id and h.enabled
          join agent_coordination_permissions p on p.negotiation_id = n.id and p.profile_id = n.participant_id and p.enabled
          join agent_preferences hp on hp.profile_id = n.host_id join agent_preferences pp on pp.profile_id = n.participant_id
          join agent_contact_authorities ha on ha.profile_id = n.host_id and ha.enabled and ha.revision = n.host_contact_revision
          join agent_contact_authorities pa on pa.profile_id = n.participant_id and pa.enabled and pa.revision = n.participant_contact_revision
          where (n.host_id = a.profile_id or n.participant_id = a.profile_id) and n.host_contact_revision is not null
            and n.result_booking_id is null and n.state <> 'cancelled' and n.expires_at > ${iso(now)}
            and (a.last_scan_at is null or a.last_scan_at <= ${iso(now - 60_000)})
            and ha.terms_version = ${APP_TERMS_VERSION} and pa.terms_version = ${APP_TERMS_VERSION}
            and hp.preferences->>'enabled' = 'true' and pp.preferences->>'enabled' = 'true'
            and hp.updated_at > ${iso(now - 7 * DAY)} and pp.updated_at > ${iso(now - 7 * DAY)}
            and not exists(select 1 from blocks b where (b.blocker_id = n.host_id and b.blocked_id = n.participant_id)
              or (b.blocker_id = n.participant_id and b.blocked_id = n.host_id))
            and (h.preference_revision <> hp.revision or p.preference_revision <> pp.revision)
            and (n.plan is not null or (n.revision < 49 and
              (select count(*) from agent_coordination_runs r where r.negotiation_id = n.id and r.created_at > ${iso(now - DAY)}) < 4))))
    order by a.next_scan_at, a.profile_id limit ${limit}`;
  const summary = { checked: 0, contacted: 0, errors: 0 };
  for (const { profile_id } of rows) {
    try {
      const result = await check(sql, profile_id, now);
      if (result.checked) summary.checked++;
      if (result.contacted) summary.contacted++;
    } catch {
      summary.errors++;
    }
  }
  return summary;
}
