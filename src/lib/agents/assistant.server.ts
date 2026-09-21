/** Member-controlled planning and the human-only bridge into ordinary bookings. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import type { Ability, MemberAbilities } from "../pace/types.ts";
import { bookSeat, PaceError, postSession } from "../pace/service.server.ts";
import { requireIntroduction } from "./introductions.server.ts";
import { agentContactRoomReason, agentContactWomenOnly } from "./contact.server.ts";
import { enqueue } from "../pace/notify.server.ts";
import {
  abilityFits,
  LATE_CANCEL_FEE_CENTS,
  LATE_CANCEL_MS,
  MIN_LEAD_TIME_MS,
  NO_SHOW_FEE_CENTS,
  validAbility,
} from "../pace/rules.ts";
import { ability, activity, type WorkoutPlan } from "./contracts.ts";
import {
  eligible,
  event,
  getNegotiation,
  history,
  validatePlan,
  type Negotiation,
} from "./service.server.ts";
import type {
  AssistantBookingReview,
  AssistantBookingTerms,
  AssistantCandidates,
  AssistantHistoryEvent,
  AssistantPreferences,
  AssistantPreferencesInput,
} from "../../../shared/assistant.ts";

const DAY = 86_400_000;
const iso = (n: number) => new Date(n).toISOString();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parse = <T>(value: T | string): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : value;

export const preferencesInput = z
  .object({
    enabled: z.boolean(),
    activity,
    ability,
    durationMin: z.number().int().min(10).max(360),
    venueIds: z.array(z.string().min(1).max(100)).max(10),
    availability: z
      .array(
        z
          .object({
            startAt: z.iso.datetime({ offset: true }),
            endAt: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .max(12),
    approvedIntent: z.string().trim().max(240),
  })
  .strict();

const defaults: AssistantPreferences = {
  enabled: false,
  activity: "walk",
  ability: { kind: "walk", effort: "easy", miles: 1 },
  durationMin: 30,
  venueIds: [],
  availability: [],
  approvedIntent: "",
  revision: 0,
  updatedAt: null,
};

/** Owner-only. Never called by the external A2A handler. */
export async function getPreferences(sql: Sql, userId: string): Promise<AssistantPreferences> {
  const owner = await sql`select id from profiles where id = ${userId} and deleted_at is null`;
  if (!owner.length) throw new PaceError(404, "Planning preferences unavailable.");
  const [row] = await sql<{
    preferences: AssistantPreferencesInput;
    revision: number;
    updated_at: Date;
  }>`
    select preferences, revision, updated_at from agent_preferences where profile_id = ${userId}`;
  return row
    ? {
        ...parse(row.preferences),
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
      }
    : { ...defaults };
}

/** Only member-entered state explicitly shared into a mutually opted-in room.
 * The function has no dependency on health records, fitness inference, or calendars. */
export async function sharedPreferences(
  sql: Sql,
  userId: string,
  roomId: string,
  now = Date.now(),
) {
  const room = await getNegotiation(sql, userId, roomId, true, false, now);
  if (room.state === "cancelled" || room.result_booking_id || +new Date(room.expires_at) <= now)
    return [];
  const preferences: { memberId: string; preferences: AssistantPreferences }[] = [];
  for (const memberId of [room.host_id, room.participant_id]) {
    const p = await getPreferences(sql, memberId);
    if (p.enabled) preferences.push({ memberId, preferences: p });
  }
  return preferences;
}

export async function setPreferences(
  sql: Sql,
  userId: string,
  body: unknown,
  now = Date.now(),
): Promise<AssistantPreferences> {
  const input = preferencesInput.parse(body);
  const valid = validAbility(input.activity, input.ability);
  if (!valid.ok) throw new PaceError(400, valid.error);
  if (new Set(input.venueIds).size !== input.venueIds.length)
    throw new PaceError(400, "Choose each meeting venue only once.");
  if (input.enabled && (!input.venueIds.length || !input.availability.length))
    throw new PaceError(400, "Choose a venue and enter at least one available time.");
  for (const window of input.enabled ? input.availability : []) {
    const start = +new Date(window.startAt),
      end = +new Date(window.endAt);
    if (
      start < now ||
      end > now + 14 * DAY ||
      end - start < input.durationMin * 60_000 ||
      end - start > DAY
    )
      throw new PaceError(
        400,
        "Availability must fit your workout, last at most a day, and be within the next 14 days.",
      );
  }
  return sql.transaction(async (tx) => {
    if (input.enabled) await eligible(tx, [userId], "update");
    else {
      const owner =
        await tx`select id from profiles where id = ${userId} and deleted_at is null for update`;
      if (!owner.length) throw new PaceError(404, "Planning preferences unavailable.");
    }
    const venues = await tx.query<{ id: string }>("select id from venues where id = any($1)", [
      input.venueIds,
    ]);
    if (input.enabled && venues.length !== input.venueIds.length)
      throw new PaceError(400, "Choose known public meeting venues.");
    await tx`insert into agent_preferences (profile_id, preferences, updated_at)
      values (${userId}, ${JSON.stringify(input)}::jsonb, ${iso(now)})
      on conflict (profile_id) do update set preferences = excluded.preferences,
        revision = case when agent_preferences.preferences = excluded.preferences
          then agent_preferences.revision else agent_preferences.revision + 1 end,
        updated_at = excluded.updated_at`;
    return getPreferences(tx, userId);
  });
}

function memberAbilities(a: Ability): MemberAbilities {
  switch (a.kind) {
    case "run":
      return { run: a };
    case "ride":
      return { ride: a };
    case "gym":
      return { strength: a };
    case "hike":
      return { hike: a };
    case "walk":
      return { walk: a };
    case "open":
      return {};
  }
}

function fits(p: AssistantPreferences, plan: WorkoutPlan): boolean {
  if (
    !p.enabled ||
    p.activity !== plan.activity ||
    !p.venueIds.includes(plan.venueId) ||
    plan.durationMin > p.durationMin ||
    abilityFits(memberAbilities(p.ability), plan.ability, "strict") !== true
  )
    return false;
  if ("miles" in plan.ability && "miles" in p.ability && plan.ability.miles > p.ability.miles)
    return false;
  if (
    plan.ability.kind === "ride" &&
    p.ability.kind === "ride" &&
    plan.ability.surface !== p.ability.surface
  )
    return false;
  if (
    plan.ability.kind === "hike" &&
    p.ability.kind === "hike" &&
    plan.ability.gainFt > p.ability.gainFt
  )
    return false;
  const start = +new Date(plan.startAt),
    end = start + plan.durationMin * 60_000;
  return p.availability.some((w) => +new Date(w.startAt) <= start && +new Date(w.endAt) >= end);
}

type BusyWindow = { start_at: Date; duration_min: number };
async function busyWindows(
  sql: Sql,
  people: string[],
  start: string,
  end: string,
): Promise<BusyWindow[]> {
  return sql.query<BusyWindow>(
    `select distinct s.id, s.start_at, s.duration_min from sessions s
    where s.status = 'open' and s.start_at < $3::timestamptz
      and s.start_at + s.duration_min * interval '1 minute' > $2::timestamptz
      and (s.host_id = any($1) or exists (select 1 from bookings b where b.session_id = s.id
        and b.participant_id = any($1) and b.status in ('pending', 'confirmed')))`,
    [people, start, end],
  );
}

/** The caller holds sorted profile locks when this protects a booking mutation. */
export async function assertScheduleAvailable(sql: Sql, people: string[], plan: WorkoutPlan) {
  const busy = await busyWindows(
    sql,
    people,
    plan.startAt,
    iso(+new Date(plan.startAt) + plan.durationMin * 60_000),
  );
  if (busy.length)
    throw new PaceError(
      409,
      "One of you already has a workout at that time. Review a new proposal.",
    );
}

function assertPlanning(r: Negotiation, now: number) {
  if (
    (r.state !== "open" && r.state !== "approved") ||
    +new Date(r.expires_at) <= now ||
    r.result_booking_id
  )
    throw new PaceError(409, "This conversation has ended.");
}

/** Generated plans must leave enough time even at the fastest entered pace.
 * This checks arithmetic consistency, not an individual's fitness or readiness. */
function durationFitsAbility(ability: Ability, durationMin: number): boolean {
  if (ability.kind === "run") return durationMin * 60 >= ability.miles * ability.paceMinSec;
  if (ability.kind === "ride") return durationMin >= (ability.miles / ability.mphMax) * 60;
  return true;
}

/** Enumerate a maximum of five real options. No autonomous retries or hidden model calls. */
export async function suggestPlans(
  sql: Sql,
  userId: string,
  roomId: string,
  now = Date.now(),
): Promise<AssistantCandidates> {
  const r = await getNegotiation(sql, userId, roomId, true, false, now);
  assertPlanning(r, now);
  const own = await getPreferences(sql, userId);
  const other = await getPreferences(sql, r.host_id === userId ? r.participant_id : r.host_id);
  return candidatePlans(sql, own, other, [r.host_id, r.participant_id], now);
}

/** Only used with mutual room consent or separate, current discovery consent.
 * Discovery uses the existence of a fit; exact availability stays private. */
export async function candidatePlans(
  sql: Sql,
  own: AssistantPreferences,
  other: AssistantPreferences,
  people: string[],
  now = Date.now(),
): Promise<AssistantCandidates> {
  const result: AssistantCandidates = {
    candidates: [],
    reason: null,
    preferenceRevision: own.revision,
    partnerPreferenceRevision: other.revision,
  };
  if (!own.enabled || !other.enabled)
    return {
      ...result,
      reason: "Both people must enable sharing of their entered planning preferences.",
    };
  if (own.activity !== other.activity)
    return { ...result, reason: "Choose the same activity or review a plan together." };
  const venues = own.venueIds.filter((v) => other.venueIds.includes(v)).sort();
  if (!venues.length)
    return { ...result, reason: "Choose at least one meeting venue you both accept." };
  const known = await sql.query<{ id: string }>(
    "select id from venues where id = any($1) order by id",
    [venues],
  );
  const duration = Math.min(own.durationMin, other.durationMin);
  const options = [own.ability, other.ability].filter((a) => durationFitsAbility(a, duration));
  if (!options.length)
    return {
      ...result,
      reason:
        "The entered distance needs more time even at your fastest selected pace or speed. Increase the workout length or choose a shorter distance together.",
    };
  const busy = await busyWindows(sql, people, iso(now), iso(now + 14 * DAY));
  const windows = own.availability
    .flatMap((a) =>
      other.availability.map((b) => ({
        start: Math.max(+new Date(a.startAt), +new Date(b.startAt), now + MIN_LEAD_TIME_MS),
        end: Math.min(+new Date(a.endAt), +new Date(b.endAt), now + 14 * DAY),
      })),
    )
    .filter((w) => w.end - w.start >= duration * 60_000)
    .sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  let checked = 0;
  for (const w of windows) {
    for (
      let start = Math.ceil(w.start / (15 * 60_000)) * 15 * 60_000;
      start + duration * 60_000 <= w.end && checked < 192;
      start += 30 * 60_000
    ) {
      checked++;
      if (
        busy.some(
          (b) =>
            +new Date(b.start_at) < start + duration * 60_000 &&
            +new Date(b.start_at) + b.duration_min * 60_000 > start,
        )
      )
        continue;
      for (const venue of known) {
        for (const selected of options) {
          const plan: WorkoutPlan = {
            title: `Our next ${own.activity}`,
            venueId: venue.id,
            activity: own.activity,
            ability: selected,
            startAt: iso(start),
            durationMin: duration,
          };
          const key = digest(plan);
          if (!seen.has(key) && fits(own, plan) && fits(other, plan)) {
            result.candidates.push(plan);
            seen.add(key);
            if (result.candidates.length === 5) return result;
          }
        }
      }
    }
  }
  return result.candidates.length
    ? result
    : {
        ...result,
        reason:
          "No shared option fits the entered times and workout preferences. Adjust them together; nothing was booked.",
      };
}

export async function getHistory(
  sql: Sql,
  userId: string,
  roomId: string,
): Promise<AssistantHistoryEvent[]> {
  const r = await getNegotiation(sql, userId, roomId);
  return (await history(sql, r, 100)).map((e) => ({
    sequence: Number(e.sequence),
    actorId: e.profile_id,
    kind: e.kind,
    revision: e.revision,
    data: parse(e.data),
    createdAt: new Date(e.created_at).toISOString(),
  }));
}

async function termsFor(sql: Sql, r: Negotiation, now: number): Promise<AssistantBookingTerms> {
  assertPlanning(r, now);
  if (!r.host_consented || !r.participant_consented || !r.plan)
    throw new PaceError(409, "Both people must opt in and review a proposal first.");
  await validatePlan(sql, r.plan, now);
  const host = await getPreferences(sql, r.host_id),
    participant = await getPreferences(sql, r.participant_id);
  if (!fits(host, r.plan) || !fits(participant, r.plan))
    throw new PaceError(
      409,
      "The plan must fit both people's current shared availability and preferences.",
    );
  await assertScheduleAvailable(sql, [r.host_id, r.participant_id], r.plan);
  const terms = {
    revision: r.revision,
    hostId: r.host_id,
    participantId: r.participant_id,
    plan: r.plan,
    visibility: "unlisted" as const,
    capacity: 2 as const,
    lateCancelFeeCents: LATE_CANCEL_FEE_CENTS,
    noShowFeeCents: NO_SHOW_FEE_CENTS,
    lateCancelHours: LATE_CANCEL_MS / 3_600_000,
    currency: "USD" as const,
    chargeNowCents: 0 as const,
    paymentCollectionEnabled: false as const,
  };
  // Preference edits invalidate earlier booking consent even if the plan still fits.
  return {
    ...terms,
    termsHash: digest({
      version: "samepace.booking-terms.v1",
      roomId: r.id,
      terms,
      preferenceRevisions: [host.revision, participant.revision],
    }),
  };
}

function review(r: Negotiation, terms: AssistantBookingTerms): AssistantBookingReview {
  return {
    terms,
    approvedIds: r.booking_terms_hash === terms.termsHash ? (r.booking_approvals ?? []) : [],
    booked: Boolean(r.result_booking_id),
    sessionId: r.result_session_id ?? null,
    bookingId: r.result_booking_id ?? null,
  };
}

export async function getBookingTerms(
  sql: Sql,
  userId: string,
  roomId: string,
  now = Date.now(),
): Promise<AssistantBookingReview> {
  const r = await getNegotiation(sql, userId, roomId);
  if (r.result_booking_id && r.booking_terms) return review(r, r.booking_terms);
  return review(r, await termsFor(sql, r, now));
}

export const bookingApprovalInput = z
  .object({ revision: z.number().int().min(1), termsHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

/** Called only by the authenticated member route. A2A delegates have no execution method. */
export async function approveBookingTerms(
  sql: Sql,
  userId: string,
  roomId: string,
  body: unknown,
  now = Date.now(),
): Promise<AssistantBookingReview> {
  const input = bookingApprovalInput.parse(body);
  return sql.transaction(async (tx) => {
    const initial = await getNegotiation(tx, userId, roomId);
    // Same order as block/delete and normal booking paths. Serializes overlapping rooms.
    await eligible(tx, [initial.host_id, initial.participant_id], "update");
    const r = await getNegotiation(tx, userId, roomId, false, true);
    if (r.result_booking_id && r.booking_terms) {
      if (input.revision !== r.revision || input.termsHash !== r.booking_terms_hash)
        throw new PaceError(409, "This conversation already booked another reviewed revision.");
      return review(r, r.booking_terms);
    }
    if (r.state !== "approved" || r.confirmations.length !== 2 || input.revision !== r.revision)
      throw new PaceError(409, "Both people must first confirm this exact proposal revision.");
    const contactReason = await agentContactRoomReason(tx, r, now);
    if (contactReason) throw new PaceError(409, contactReason);
    const terms = await termsFor(tx, r, now);
    if (input.termsHash !== terms.termsHash)
      throw new PaceError(409, "Booking terms changed. Review and approve them again.");
    // No booking behind the conversation means these two met through discovery:
    // strangers, so the freeze and verification apply although the session is invite-only.
    if (r.booking_id === null) {
      const [pair] = await tx<{ women_only: boolean }>`
        select coalesce(bool_or(women_only), false) as women_only from agent_discovery_consents
        where profile_id in (${r.host_id}, ${r.participant_id})`;
      await requireIntroduction(tx, userId, [r.host_id, r.participant_id], now, {
        womenOnly:
          r.host_contact_revision == null
            ? Boolean(pair?.women_only)
            : await agentContactWomenOnly(tx, r, now),
      });
    }
    const old = r.booking_terms_hash === terms.termsHash ? (r.booking_approvals ?? []) : [];
    const approved = [...new Set([...old, userId])];
    await tx`update agent_negotiations set booking_terms = ${JSON.stringify(terms)}::jsonb,
      booking_terms_hash = ${terms.termsHash}, booking_approvals = ${JSON.stringify(approved)}::jsonb,
      updated_at = ${iso(now)} where id = ${roomId}`;
    if (!old.includes(userId))
      await event(
        tx,
        r,
        userId,
        randomUUID(),
        "booking_approval",
        { termsHash: terms.termsHash, approvedRevision: r.revision },
        now,
      );
    if (approved.length === 2) {
      const s = await postSession(
        tx,
        r.host_id,
        {
          ...terms.plan,
          detail: "",
          abilityFlex: "strict",
          visibility: "unlisted",
          capacity: 2,
          joinMode: "instant",
          womenOnly: false,
        },
        now,
      );
      const [invite] = await tx<{
        invite_code: string;
      }>`select invite_code from sessions where id = ${s.id}`;
      const booking = await bookSeat(
        tx,
        r.participant_id,
        s.id,
        { inviteCode: invite.invite_code },
        now,
      );
      await tx`update agent_negotiations set result_session_id = ${s.id}, result_booking_id = ${booking.id},
        updated_at = ${iso(now)} where id = ${roomId}`;
      await event(
        tx,
        r,
        userId,
        randomUUID(),
        "booked",
        { sessionId: s.id, bookingId: booking.id, approvedRevision: r.revision },
        now,
      );
      await enqueue(
        tx,
        {
          profileId: r.participant_id,
          kind: "assistant_booked",
          category: "sessions",
          title: "Your workout is booked",
          body: "Both of you approved this plan and its terms. Your workout is ready.",
          url: `/agent-chat/${roomId}`,
          sessionId: s.id,
          bookingId: booking.id,
          dedupeKey: `assistant:${roomId}:booked`,
        },
        now,
      );
    } else if (!old.includes(userId)) {
      await enqueue(
        tx,
        {
          profileId: r.host_id === userId ? r.participant_id : r.host_id,
          kind: "assistant_booking_review",
          category: "sessions",
          title: "Ready for your booking review",
          body: "Your partner accepted the booking terms. Review and accept them to book your workout.",
          url: `/agent-chat/${roomId}`,
          dedupeKey: `assistant:${roomId}:${terms.termsHash}:${userId}:terms`,
        },
        now,
      );
    }
    return review(await getNegotiation(tx, userId, roomId), terms);
  });
}
