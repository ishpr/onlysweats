/** First-time introductions require explicit discovery consent on both sides.
 * No directory, free-text messages, health queries, model calls or automatic bookings.
 * Meeting someone new is a public meeting: the two-strike freeze and identity
 * verification apply (`introductions.server.ts`), and "women only" works the way
 * it does on a session — shown only to women, and only shown women. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { PaceError } from "../pace/service.server.ts";
import { enqueue } from "../pace/notify.server.ts";
import { candidatePlans, getPreferences } from "./assistant.server.ts";
import { eligible, event, type Negotiation } from "./service.server.ts";
import { introductionBar, requireIntroduction } from "./introductions.server.ts";
import type { MemberDiscovery } from "../../../shared/discovery.ts";

const DAY = 86400_000;
const iso = (n: number) => new Date(n).toISOString();
const consentInput = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({
    enabled: z.literal(true),
    preferenceRevision: z.number().int().positive(),
    womenOnly: z.boolean().optional(),
  }),
]);
const inviteInput = z.strictObject({
  memberId: z.string().min(1).max(100),
  preferenceRevision: z.number().int().positive(),
});
type Consent = {
  enabled: boolean;
  preference_revision: number;
  expires_at: Date;
  women_only: boolean;
};

/** Each side's "women only" has to be satisfied by the other. */
const pairOk = (
  a: { womenOnly: boolean; woman: boolean },
  b: { womenOnly: boolean; woman: boolean },
) => (!a.womenOnly || b.woman) && (!b.womenOnly || a.woman);

async function available(sql: Sql, userId: string, now: number) {
  const [member] = await sql<{ name: string; eligible: boolean; woman: boolean }>`select name,
    (deleted_at is null and suspended_at is null) as eligible,
    (gender is not distinct from 'woman') as woman from profiles where id = ${userId}`;
  if (!member) throw new PaceError(404, "Discovery unavailable.");
  const [consent] =
    await sql<Consent>`select * from agent_discovery_consents where profile_id = ${userId}`;
  const preferences = await getPreferences(sql, userId);
  const enabled = Boolean(
    member.eligible &&
    consent?.enabled &&
    +new Date(consent.expires_at) > now &&
    preferences.enabled &&
    consent.preference_revision === preferences.revision &&
    preferences.updatedAt &&
    +new Date(preferences.updatedAt) > now - 7 * DAY,
  );
  return {
    member,
    consent,
    preferences,
    enabled,
    woman: member.woman,
    womenOnly: Boolean(consent?.women_only) && member.woman,
  };
}

export async function getDiscovery(
  sql: Sql,
  userId: string,
  now = Date.now(),
): Promise<MemberDiscovery> {
  const own = await available(sql, userId, now);
  const result: MemberDiscovery = {
    enabled: own.enabled,
    expiresAt: own.consent ? new Date(own.consent.expires_at).toISOString() : null,
    eligible: own.member.eligible,
    womenOnly: own.womenOnly,
    canChooseWomenOnly: own.woman,
    needs: null,
    candidates: [],
    reason: null,
  };
  if (!own.enabled)
    return {
      ...result,
      reason: "Save current planning preferences, then choose to meet new workout partners.",
    };
  // A freeze or a missing verification stops introductions the way it stops public sessions.
  const bar = await introductionBar(sql, userId, now, { womenOnly: own.womenOnly });
  if (bar) return { ...result, reason: bar.message, needs: bar.code ?? null };
  // Bounded candidate pool, no searchable member directory. Rank deterministic
  // compatibility only; exact available times and notes never leave this service.
  const rows = await sql<{ id: string }>`select p.id from agent_discovery_consents d
    join profiles p on p.id = d.profile_id join agent_preferences ap on ap.profile_id = p.id
    where p.id <> ${userId} and d.enabled and d.expires_at > ${iso(now)}
      and p.deleted_at is null and p.suspended_at is null
      and d.preference_revision = ap.revision and ap.updated_at > ${iso(now - 7 * DAY)}
      and ap.preferences->>'enabled' = 'true' and ap.preferences->>'activity' = ${own.preferences.activity}
      and (not d.women_only or ${own.woman}) and (not ${own.womenOnly} or p.gender = 'woman')
      and not exists(select 1 from blocks b where (b.blocker_id = ${userId} and b.blocked_id = p.id)
        or (b.blocked_id = ${userId} and b.blocker_id = p.id))
      and not exists(select 1 from agent_negotiations n where n.booking_id is null
        and ((n.host_id = ${userId} and n.participant_id = p.id) or (n.participant_id = ${userId} and n.host_id = p.id))
        and n.created_at > ${iso(now - 7 * DAY)})
    order by md5(p.id || ${iso(now).slice(0, 13)}), p.id limit 30`;
  for (const { id } of rows) {
    const other = await available(sql, id, now);
    if (!other.enabled || !pairOk(own, other)) continue;
    // Frozen or unverified members aren't offered, and aren't told anyone looked.
    const womenOnly = own.womenOnly || other.womenOnly;
    if (await introductionBar(sql, id, now, { womenOnly })) continue;
    if (womenOnly && !own.womenOnly && (await introductionBar(sql, userId, now, { womenOnly }))) {
      continue;
    }
    const plans = await candidatePlans(sql, own.preferences, other.preferences, [userId, id], now);
    if (!plans.candidates.length) continue;
    result.candidates.push({
      memberId: id,
      name: other.member.name,
      activity: own.preferences.activity,
      sharedVenueCount: own.preferences.venueIds.filter((v) =>
        other.preferences.venueIds.includes(v),
      ).length,
    });
    if (result.candidates.length === 5) break;
  }
  if (!result.candidates.length)
    result.reason =
      "No compatible new partner was found in this search. The selection refreshes each hour; you can also update your preferences.";
  return result;
}

export async function setDiscovery(sql: Sql, userId: string, input: unknown, now = Date.now()) {
  const body = consentInput.parse(input);
  await sql.transaction(async (tx) => {
    if (body.enabled) await eligible(tx, [userId], "update");
    else {
      const owner =
        await tx`select id from profiles where id = ${userId} and deleted_at is null for no key update`;
      if (!owner.length) throw new PaceError(404, "Discovery unavailable.");
    }
    const preferences = await getPreferences(tx, userId);
    const womenOnly = body.enabled && Boolean(body.womenOnly);
    if (body.enabled) {
      const [me] = await tx<{ woman: boolean }>`
        select (gender is not distinct from 'woman') as woman from profiles where id = ${userId}`;
      if (womenOnly && !me?.woman) throw new PaceError(409, "Women-only is chosen by women.");
      await requireIntroduction(tx, userId, [], now, { womenOnly });
    }
    if (
      body.enabled &&
      (!preferences.enabled ||
        preferences.revision !== body.preferenceRevision ||
        !preferences.updatedAt ||
        +new Date(preferences.updatedAt) <= now - 7 * DAY)
    )
      throw new PaceError(409, "Save and review your current planning preferences first.");
    await tx`insert into agent_discovery_consents (profile_id, enabled, preference_revision, expires_at, updated_at, women_only)
      values (${userId}, ${body.enabled}, ${preferences.revision}, ${iso(now + 7 * DAY)}, ${iso(now)}, ${womenOnly})
      on conflict (profile_id) do update set enabled = excluded.enabled, preference_revision = excluded.preference_revision,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at, women_only = excluded.women_only`;
    if (!body.enabled) {
      // Legacy joined conversations retain their separate consent. Product-authorized
      // automatic rooms also end, so this existing privacy control still withdraws them.
      await tx`update agent_negotiations set state = 'cancelled', confirmations = '[]'::jsonb, updated_at = ${iso(now)}
        where booking_id is null and result_booking_id is null and state <> 'cancelled'
        and (host_id = ${userId} or participant_id = ${userId})
        and (not (host_consented and participant_consented) or host_contact_revision is not null)`;
      await tx`update agent_coordination_runs set status = 'cancelled',
        reason = 'Agent matching was paused.', updated_at = ${iso(now)}
        where status in ('queued','negotiating') and negotiation_id in
          (select id from agent_negotiations where host_contact_revision is not null
           and (host_id = ${userId} or participant_id = ${userId}))`;
    }
  });
  return getDiscovery(sql, userId, now);
}

export async function inviteDiscovery(
  sql: Sql,
  userId: string,
  input: unknown,
  now = Date.now(),
): Promise<Negotiation> {
  const body = inviteInput.parse(input);
  if (body.memberId === userId) throw new PaceError(400, "Choose a workout partner.");
  return sql.transaction(async (tx) => {
    await eligible(tx, [userId, body.memberId], "update");
    const own = await available(tx, userId, now),
      other = await available(tx, body.memberId, now);
    if (!own.enabled || !other.enabled || !pairOk(own, other))
      throw new PaceError(404, "This introduction is no longer available.");
    await requireIntroduction(tx, userId, [body.memberId], now, {
      womenOnly: own.womenOnly || other.womenOnly,
    });
    if (own.preferences.revision !== body.preferenceRevision)
      throw new PaceError(409, "Review your current preferences first.");
    const plans = await candidatePlans(
      tx,
      own.preferences,
      other.preferences,
      [userId, body.memberId],
      now,
    );
    if (!plans.candidates.length)
      throw new PaceError(409, "No shared plan fits your current preferences.");
    await tx`update agent_negotiations set state = 'cancelled', updated_at = ${iso(now)}
      where booking_id is null and state = 'open' and expires_at <= ${iso(now)}
        and ((host_id = ${userId} and participant_id = ${body.memberId}) or (host_id = ${body.memberId} and participant_id = ${userId}))`;
    const [existing] =
      await tx<Negotiation>`select * from agent_negotiations where booking_id is null
      and ((host_id = ${userId} and participant_id = ${body.memberId}) or (host_id = ${body.memberId} and participant_id = ${userId}))
      and created_at > ${iso(now - 7 * DAY)} order by created_at desc limit 1`;
    if (existing?.state === "open" && +new Date(existing.expires_at) > now) return existing;
    if (existing) throw new PaceError(409, "Give this person time before another invitation.");
    const [counts] = await tx<{ outgoing: number; incoming: number; crowded: boolean }>`select
      (select count(*)::int from agent_negotiations where booking_id is null and host_id = ${userId} and created_at > ${iso(now - DAY)}) outgoing,
      (select count(*)::int from agent_negotiations where booking_id is null and participant_id = ${body.memberId} and created_at > ${iso(now - DAY)}) incoming,
      exists(select 1 from profiles p where p.id in (${userId}, ${body.memberId}) and
        (select count(*) from agent_negotiations n where (n.host_id = p.id or n.participant_id = p.id)
          and n.state = 'open' and n.expires_at > ${iso(now)}) >= 20) crowded`;
    if (counts.outgoing >= 5 || counts.incoming >= 10 || counts.crowded)
      throw new PaceError(409, "Invitation limit reached. Try again later.");
    const [room] = await tx<Negotiation>`insert into agent_negotiations
      (id, booking_id, host_id, participant_id, host_consented, participant_consented, expires_at, created_at, updated_at)
      values (${randomUUID()}, null, ${userId}, ${body.memberId}, true, false, ${iso(now + DAY)}, ${iso(now)}, ${iso(now)}) returning *`;
    await event(tx, room, userId, randomUUID(), "consent", { allowed: true }, now);
    await enqueue(
      tx,
      {
        profileId: body.memberId,
        kind: "agent_invitation",
        category: "sessions",
        title: "A workout invitation",
        body: "Someone with compatible preferences invited you to plan. You decide whether to join the conversation.",
        url: `/assistant?negotiationId=${room.id}`,
        dedupeKey: `discovery:${room.id}`,
      },
      now,
    );
    return room;
  });
}
