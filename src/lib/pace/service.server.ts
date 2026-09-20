/**
 * SamePace service layer (server-only, PRD v0.3). Every state change runs in one
 * transaction: lock the rows, ask `rules.ts` what should happen, write it, append
 * the ledger. Callers pass a verified user id — nothing here trusts
 * client-supplied identity.
 */
import type { Sql } from "../db.ts";
import {
  abilityFits,
  abilityLabel,
  canBook,
  canGeoCheckIn,
  canPost,
  canUseCode,
  cancelOutcome,
  chatOpen,
  checkinWindow,
  feeChargeableAt,
  FREE_SESSIONS,
  FREEZE_MS,
  inCheckinWindow,
  LATE_CANCEL_FEE_CENTS,
  MIN_LEAD_TIME_MS,
  nextOccurrence,
  pct,
  settle,
  STRIKES_TO_FREEZE,
  STRIKE_WINDOW_MS,
} from "./rules.ts";
import type {
  Ability,
  Accent,
  Activity,
  BookingStatus,
  ChatMessage,
  CheckinMethod,
  Gender,
  JoinMode,
  MemberAbilities,
  Person,
  Venue,
  Visibility,
} from "./types.ts";

export class PaceError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.name = "PaceError";
    this.status = status;
  }
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());
const ms = (v: unknown) => (v == null ? null : new Date(v as string | Date).getTime());
const at = (n: number) => new Date(n).toISOString();
/** jsonb comes back parsed from pg and PGLite; tolerate a string just in case. */
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const fourDigits = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
const inviteToken = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

// ── Rows ─────────────────────────────────────────────────────────────────────

type ProfileRow = {
  id: string;
  name: string;
  handle: string;
  initials: string;
  neighborhood: string;
  accent: Accent;
  gender: Gender;
  abilities: unknown;
  identity_verified: boolean;
  credit_cents: number;
  completed_count: number;
  on_time_yes: number;
  on_time_total: number;
  would_join_yes: number;
  would_join_total: number;
  frozen_until: Date | null;
  suspended_at: Date | null;
  suspended_reason: string | null;
  deleted_at: Date | null;
  created_at: Date;
};

type SessionRow = {
  id: string;
  host_id: string;
  venue_id: string;
  activity: Activity;
  title: string;
  detail: string;
  ability: unknown;
  ability_flex: "strict" | "flexible";
  route_url: string | null;
  start_at: Date;
  duration_min: number;
  capacity: number;
  visibility: Visibility;
  join_mode: JoinMode;
  women_only: boolean;
  status: "open" | "cancelled" | "completed";
  code: string;
  code_revealed_at: Date | null;
  invite_code: string | null;
  series_id: string | null;
};

type BookingRow = {
  id: string;
  session_id: string;
  participant_id: string;
  status: BookingStatus;
  substitute_for: string | null;
  host_checked_in_at: Date | null;
  participant_checked_in_at: Date | null;
  checkin_method: CheckinMethod | null;
  created_at: Date;
};

// ── DTOs ─────────────────────────────────────────────────────────────────────

export type MeDTO = Person & {
  gender: Gender;
  /** Membership credit from being stood up. */
  creditCents: number;
  /** Fees assessed and not waived — nothing is charged yet. */
  feesCents: number;
  strikes: number;
  /** Public sessions are paused until this, after two strikes in 60 days. */
  frozenUntil: string | null;
  /** Completed sessions left before membership would start. */
  freeSessionsLeft: number;
  /** Set when the account is paused by SamePace. Only `/me` works until it lifts. */
  suspended: { reason: string } | null;
  /** The account was deleted; its token opens nothing. Never sent to a live client. */
  deleted: boolean;
};

export type SessionDTO = {
  id: string;
  hostId: string;
  venueId: string;
  activity: Activity;
  title: string;
  detail: string;
  ability: Ability;
  abilityLabel: string;
  abilityFlex: "strict" | "flexible";
  /** Inside my range? `null` until I set my level for this activity. */
  fitsMe: boolean | null;
  routeUrl: string | null;
  startAt: string;
  durationMin: number;
  capacity: number;
  visibility: Visibility;
  joinMode: JoinMode;
  womenOnly: boolean;
  status: "open" | "cancelled" | "completed";
  /** Poster only. Joiners type what they're shown. */
  code: string | null;
  codeRevealedAt: string | null;
  /** Poster only. */
  inviteCode?: string;
  seatsLeft: number;
  /** Exact meeting spot — poster and confirmed joiners only. */
  pinHint: string | null;
  /** Set when this is one occurrence of a standing slot. */
  seriesId: string | null;
  /** An open seat on someone else's standing slot: join for this occurrence only. */
  substituteSeat: boolean;
};

export type BookingDTO = {
  id: string;
  sessionId: string;
  participantId: string;
  hostId: string;
  status: BookingStatus;
  substituteFor: string | null;
  createdAt: string;
  hostCheckedInAt: string | null;
  participantCheckedInAt: string | null;
  checkinMethod: CheckinMethod | null;
  ratedByMe: boolean;
  chatOpen: boolean;
  /** A fee assessed to ME on this booking, and still standing. */
  myFeeCents: number;
  seriesId: string | null;
};

export type SeriesDTO = {
  id: string;
  streak: number;
  memberIds: string[];
  title: string;
  activity: Activity;
  abilityLabel: string;
  venueId: string;
  nextSessionId: string | null;
  nextStartAt: string | null;
};

function toPerson(r: ProfileRow): Person {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    initials: r.initials,
    neighborhood: r.neighborhood,
    memberSince: String(new Date(r.created_at).getUTCFullYear()),
    accent: r.accent,
    identityVerified: r.identity_verified,
    completedCount: r.completed_count,
    onTimePct: pct(r.on_time_yes, r.on_time_total),
    wouldJoinPct: pct(r.would_join_yes, r.would_join_total),
    abilities: json<MemberAbilities>(r.abilities) ?? {},
  };
}

// ── Profiles ─────────────────────────────────────────────────────────────────

/** Only a hash of a banned email is ever stored. */
export async function emailHash(email: string) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isBanned(sql: Sql, email: string) {
  const [row] = await sql`
    select 1 from banned_identities where email_hash = ${await emailHash(email)}`;
  return Boolean(row);
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return (letters || "S").toUpperCase();
}

async function profileRow(sql: Sql, id: string): Promise<ProfileRow> {
  const [row] = await sql<ProfileRow>`select * from profiles where id = ${id}`;
  if (!row) throw new PaceError(404, "No profile.");
  return row;
}

async function toMe(sql: Sql, r: ProfileRow, now: number): Promise<MeDTO> {
  const [fees] = await sql<{ n: number }>`
    select coalesce(sum(amount_cents), 0) as n from ledger_events
    where profile_id = ${r.id} and status = 'assessed' and kind <> 'show_up_credit'`;
  const [strikes] = await sql<{ n: number }>`
    select count(*) as n from strikes
    where profile_id = ${r.id} and created_at > ${at(now - STRIKE_WINDOW_MS)}`;
  const frozenUntil = ms(r.frozen_until);
  return {
    ...toPerson(r),
    gender: r.gender,
    creditCents: r.credit_cents,
    feesCents: Number(fees?.n ?? 0),
    strikes: Number(strikes?.n ?? 0),
    frozenUntil: frozenUntil && frozenUntil > now ? at(frozenUntil) : null,
    freeSessionsLeft: Math.max(0, FREE_SESSIONS - r.completed_count),
    suspended: r.suspended_at ? { reason: r.suspended_reason ?? "" } : null,
    deleted: Boolean(r.deleted_at),
  };
}

export async function getMe(sql: Sql, userId: string, now = Date.now()): Promise<MeDTO> {
  return toMe(sql, await profileRow(sql, userId), now);
}

/** Create the caller's profile on first contact, from their auth identity. */
export async function ensureProfile(
  sql: Sql,
  user: { id: string; name: string | null; email: string | null },
  now = Date.now(),
): Promise<MeDTO> {
  const [existing] = await sql<ProfileRow>`select * from profiles where id = ${user.id}`;
  if (existing) return toMe(sql, existing, now);
  if (user.email && (await isBanned(sql, user.email))) {
    throw new PaceError(403, "This account can’t be used on SamePace.");
  }
  // Apple's "Hide My Email" addresses are random — never use one as a name.
  const relay = user.email?.endsWith("@privaterelay.appleid.com");
  const fromEmail = relay ? undefined : user.email?.split("@")[0];
  const name = (user.name?.trim() || fromEmail || "Member").slice(0, 80);
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 16) || "member";
  const handle = `${base}${crypto.randomUUID().slice(0, 4)}`;
  await sql`
    insert into profiles (id, name, handle, initials)
    values (${user.id}, ${name}, ${handle}, ${initialsOf(name)})
    on conflict (id) do nothing`;
  return getMe(sql, user.id, now);
}

export async function updateProfile(
  sql: Sql,
  userId: string,
  patch: { name?: string; neighborhood?: string; gender?: Gender; abilities?: MemberAbilities },
): Promise<MeDTO> {
  const cur = await profileRow(sql, userId);
  const name = patch.name?.trim() || cur.name;
  // Abilities merge per activity, so setting a run pace never wipes a hike level.
  const abilities = { ...json<MemberAbilities>(cur.abilities), ...(patch.abilities ?? {}) };
  await sql`
    update profiles set
      name = ${name},
      initials = ${initialsOf(name)},
      neighborhood = ${patch.neighborhood?.trim() || cur.neighborhood},
      gender = ${patch.gender === undefined ? cur.gender : patch.gender},
      abilities = ${JSON.stringify(abilities)}::jsonb
    where id = ${userId}`;
  return getMe(sql, userId);
}

export async function people(sql: Sql, ids: string[]): Promise<Person[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await sql.query<ProfileRow>("select * from profiles where id = any($1)", [unique]);
  return rows.map(toPerson);
}

// ── Venues / sessions ────────────────────────────────────────────────────────

export async function listVenues(sql: Sql): Promise<Omit<Venue, "hint">[]> {
  const rows = await sql<Venue>`select * from venues order by name`;
  // The hint is the exact meeting spot — it travels on the session, when entitled.
  return rows.map(({ hint: _hint, ...v }) => v);
}

/**
 * A block is mutual in effect and covers everyone on the session: the poster and
 * anyone holding a seat, whichever side did the blocking.
 */
const BLOCKED_WITH_VIEWER = `exists (
  select 1 from blocks k
  where (k.blocker_id = $1 and (k.blocked_id = s.host_id or k.blocked_id in (
      select b.participant_id from bookings b
      where b.session_id = s.id and b.status in ('pending', 'confirmed'))))
    or (k.blocked_id = $1 and (k.blocker_id = s.host_id or k.blocker_id in (
      select b.participant_id from bookings b
      where b.session_id = s.id and b.status in ('pending', 'confirmed')))))`;

export async function blockedBetween(sql: Sql, a: string, others: string[]) {
  const ids = others.filter((id) => id !== a);
  if (ids.length === 0) return false;
  const rows = await sql.query(
    `select 1 from blocks
     where (blocker_id = $1 and blocked_id = any($2)) or (blocked_id = $1 and blocker_id = any($2))
     limit 1`,
    [a, ids],
  );
  return rows.length > 0;
}

const SESSION_SELECT = `
  select s.*, v.hint as venue_hint,
    ${BLOCKED_WITH_VIEWER} as viewer_blocked,
    (select count(*) from bookings b
      where b.session_id = s.id and b.status in ('pending', 'confirmed', 'completed')) as seats_taken,
    exists (select 1 from bookings b
      where b.session_id = s.id and b.participant_id = $1
        and b.status in ('confirmed', 'completed')) as viewer_confirmed,
    (s.series_id is not null and exists (select 1 from series_members m
      where m.series_id = s.series_id and m.profile_id = $1 and m.left_at is null)) as viewer_in_series
  from sessions s join venues v on v.id = s.venue_id`;

type SessionViewRow = SessionRow & {
  venue_hint: string;
  seats_taken: number;
  viewer_confirmed: boolean;
  viewer_in_series: boolean;
  viewer_blocked: boolean;
};

function viewOf(r: SessionViewRow, viewer: string, mine: MemberAbilities): SessionDTO {
  const isHost = r.host_id === viewer;
  const ability = json<Ability>(r.ability);
  const seatsLeft = Math.max(0, r.capacity - 1 - Number(r.seats_taken ?? 0));
  return {
    id: r.id,
    hostId: r.host_id,
    venueId: r.venue_id,
    activity: r.activity,
    title: r.title,
    detail: r.detail,
    ability,
    abilityLabel: abilityLabel(ability),
    abilityFlex: r.ability_flex,
    fitsMe: abilityFits(mine, ability, r.ability_flex),
    routeUrl: r.route_url,
    startAt: iso(r.start_at)!,
    durationMin: r.duration_min,
    capacity: r.capacity,
    visibility: r.visibility,
    joinMode: r.join_mode,
    womenOnly: r.women_only,
    status: r.status,
    code: isHost ? r.code : null,
    codeRevealedAt: iso(r.code_revealed_at),
    inviteCode: isHost ? (r.invite_code ?? undefined) : undefined,
    seatsLeft,
    pinHint: isHost || r.viewer_confirmed ? r.venue_hint : null,
    seriesId: r.series_id,
    substituteSeat: Boolean(r.series_id) && !isHost && !r.viewer_in_series && seatsLeft > 0,
  };
}

async function abilitiesOf(sql: Sql, userId: string): Promise<MemberAbilities> {
  const [row] = await sql<{ abilities: unknown }>`select abilities from profiles where id = ${userId}`;
  return json<MemberAbilities>(row?.abilities) ?? {};
}

/**
 * Discovery is upcoming sessions — never a grid of people. Public, open, inside
 * 14 days; a women-only session is visible only to members it is open to.
 */
export async function listPublicSessions(
  sql: Sql,
  viewer: string,
  opts: { womenOnly?: boolean } = {},
): Promise<{ sessions: SessionDTO[]; people: Person[] }> {
  const me = await profileRow(sql, viewer);
  const rows = await sql.query<SessionViewRow>(
    `${SESSION_SELECT}
     where s.visibility = 'public' and s.status = 'open'
       and s.start_at > now() - interval '25 minutes'
       and s.start_at < now() + interval '14 days'
       and ($2::boolean is not true or s.women_only)
       and (not s.women_only or $3::boolean or s.host_id = $1)
       and not ${BLOCKED_WITH_VIEWER}
     order by s.start_at`,
    [viewer, opts.womenOnly ?? null, me.gender === "woman"],
  );
  const mine = json<MemberAbilities>(me.abilities) ?? {};
  return {
    sessions: rows.map((r) => viewOf(r, viewer, mine)),
    people: await people(
      sql,
      rows.map((r) => r.host_id),
    ),
  };
}

/** Sessions I posted or hold a seat in — any visibility, recent past included. */
export async function listMySessions(sql: Sql, viewer: string): Promise<SessionDTO[]> {
  const rows = await sql.query<SessionViewRow>(
    `${SESSION_SELECT}
     where s.start_at > now() - interval '30 days'
       and (s.host_id = $1 or exists (
         select 1 from bookings b where b.session_id = s.id and b.participant_id = $1))
     order by s.start_at`,
    [viewer],
  );
  const mine = await abilitiesOf(sql, viewer);
  return rows.map((r) => viewOf(r, viewer, mine));
}

async function canSee(sql: Sql, r: SessionViewRow, viewer: string, inviteCode?: string) {
  if (r.host_id === viewer) return true;
  const [seat] = await sql`
    select 1 from bookings where session_id = ${r.id} and participant_id = ${viewer} limit 1`;
  if (seat) return true;
  // Blocked either way round: it looks exactly like a session that isn't there.
  if (r.viewer_blocked) return false;
  if (r.visibility === "public" || r.viewer_in_series) return true;
  // The invite link is the key to an unlisted session, before any seat exists.
  return Boolean(inviteCode && r.invite_code === inviteCode);
}

export async function getSession(
  sql: Sql,
  viewer: string,
  id: string,
  opts: { inviteCode?: string } = {},
): Promise<{ session: SessionDTO; people: Person[] }> {
  const [row] = await sql.query<SessionViewRow>(`${SESSION_SELECT} where s.id = $2`, [viewer, id]);
  // An unlisted session is indistinguishable from a missing one without the link.
  if (!row || !(await canSee(sql, row, viewer, opts.inviteCode))) {
    throw new PaceError(404, "Session not found.");
  }
  return {
    session: viewOf(row, viewer, await abilitiesOf(sql, viewer)),
    people: await people(sql, [row.host_id]),
  };
}

export async function getInvite(
  sql: Sql,
  viewer: string,
  inviteCode: string,
): Promise<{ session: SessionDTO; people: Person[] }> {
  const [row] = await sql.query<SessionViewRow>(
    `${SESSION_SELECT} where s.invite_code = $2 and s.visibility = 'unlisted' and s.status = 'open'`,
    [viewer, inviteCode],
  );
  if (!row || (row.viewer_blocked && row.host_id !== viewer)) {
    throw new PaceError(404, "Invite expired.");
  }
  return {
    session: viewOf(row, viewer, await abilitiesOf(sql, viewer)),
    people: await people(sql, [row.host_id]),
  };
}

export type PostSessionInput = {
  venueId: string;
  activity: Activity;
  title: string;
  detail: string;
  ability: Ability;
  abilityFlex: "strict" | "flexible";
  routeUrl?: string | null;
  startAt: string;
  durationMin: number;
  capacity: number;
  visibility: Visibility;
  joinMode: JoinMode;
  womenOnly: boolean;
};

export async function postSession(
  sql: Sql,
  userId: string,
  input: PostSessionInput,
  now = Date.now(),
): Promise<SessionDTO> {
  const poster = await profileRow(sql, userId);
  const [venue] = await sql<Venue>`select * from venues where id = ${input.venueId}`;
  if (!venue) throw new PaceError(400, "Pick a venue in the cluster.");
  const startAt = new Date(input.startAt).getTime();
  if (!Number.isFinite(startAt)) throw new PaceError(400, "Start time isn’t valid.");
  const verdict = canPost(
    {
      title: input.title,
      activity: input.activity,
      ability: input.ability,
      startAt,
      capacity: input.capacity,
      womenOnly: input.womenOnly,
      visibility: input.visibility,
    },
    { gender: poster.gender, frozenUntil: ms(poster.frozen_until) },
    now,
  );
  if (!verdict.ok) throw new PaceError(400, verdict.error);

  const id = newId("ses");
  await sql`
    insert into sessions (
      id, host_id, venue_id, activity, title, detail, ability, ability_flex, route_url, start_at,
      duration_min, capacity, visibility, join_mode, women_only, code, invite_code
    ) values (
      ${id}, ${userId}, ${input.venueId}, ${input.activity}, ${input.title.trim()},
      ${input.detail.trim()}, ${JSON.stringify(input.ability)}::jsonb, ${input.abilityFlex},
      ${input.routeUrl || null}, ${at(startAt)}, ${input.durationMin}, ${input.capacity},
      ${input.visibility}, ${input.joinMode}, ${input.womenOnly}, ${fourDigits()},
      ${input.visibility === "unlisted" ? inviteToken() : null}
    )`;
  return (await getSession(sql, userId, id)).session;
}

/**
 * The poster calls it off. Every seat is released free. Inside 12 hours, with
 * someone confirmed, the poster pays the same $5 a joiner would.
 */
export async function cancelSession(
  sql: Sql,
  userId: string,
  sessionId: string,
  now = Date.now(),
): Promise<void> {
  await sql.transaction(async (tx) => {
    const [s] = await tx<SessionRow>`select * from sessions where id = ${sessionId} for update`;
    if (!s || s.host_id !== userId) throw new PaceError(404, "Session not found.");
    if (s.status !== "open") throw new PaceError(409, "This session is already closed.");
    const startAt = ms(s.start_at)!;
    if (now >= startAt) throw new PaceError(409, "It already started.");
    const seats = await tx<BookingRow>`
      select * from bookings where session_id = ${sessionId}
        and status in ('pending', 'confirmed') for update`;
    for (const b of seats) {
      await tx`update bookings set status = 'cancelled', settled_at = ${at(now)} where id = ${b.id}`;
    }
    await tx`update sessions set status = 'cancelled' where id = ${sessionId}`;
    const stoodUp = seats.some((b) => b.status === "confirmed");
    if (stoodUp && cancelOutcome("confirmed", startAt, now).late) {
      await ledger(tx, userId, "late_cancel_fee", LATE_CANCEL_FEE_CENTS, {
        sessionId,
        chargeableAt: feeChargeableAt(startAt, s.duration_min),
      });
    }
    // Calling off one week doesn't end a standing slot.
    if (s.series_id) await ensureNextOccurrence(tx, s.series_id, now);
  });
}

// ── Fees, credits, strikes ───────────────────────────────────────────────────

async function ledger(
  tx: Sql,
  profileId: string,
  kind: "late_cancel_fee" | "no_show_fee" | "show_up_credit",
  amountCents: number,
  ref: { bookingId?: string; sessionId?: string; chargeableAt?: number },
) {
  await tx`
    insert into ledger_events (id, profile_id, booking_id, session_id, kind, amount_cents, chargeable_at)
    values (${newId("led")}, ${profileId}, ${ref.bookingId ?? null}, ${ref.sessionId ?? null},
            ${kind}, ${amountCents}, ${ref.chargeableAt ? at(ref.chargeableAt) : null})`;
}

/** Two strikes in 60 days pauses public sessions for 14. */
async function strike(tx: Sql, profileId: string, bookingId: string, now: number) {
  await tx`
    insert into strikes (id, profile_id, booking_id, created_at)
    values (${newId("stk")}, ${profileId}, ${bookingId}, ${at(now)})`;
  const [{ n }] = await tx<{ n: number }>`
    select count(*) as n from strikes
    where profile_id = ${profileId} and created_at > ${at(now - STRIKE_WINDOW_MS)}`;
  if (Number(n) >= STRIKES_TO_FREEZE) {
    await tx`update profiles set frozen_until = ${at(now + FREEZE_MS)} where id = ${profileId}`;
  }
}

// ── Bookings ─────────────────────────────────────────────────────────────────

/** A late cancel costs nothing once someone else takes the seat. */
async function coverLateCancel(tx: Sql, sessionId: string) {
  const [gap] = await tx<{ id: string }>`
    select id from bookings where session_id = ${sessionId} and status = 'late_cancel'
    order by settled_at limit 1 for update`;
  if (!gap) return;
  await tx`update bookings set status = 'covered' where id = ${gap.id}`;
  await tx`
    update ledger_events set status = 'waived'
    where booking_id = ${gap.id} and kind = 'late_cancel_fee' and status = 'assessed'`;
}

export async function bookSeat(
  sql: Sql,
  userId: string,
  sessionId: string,
  opts: { inviteCode?: string } = {},
  now = Date.now(),
): Promise<BookingDTO> {
  const me = await profileRow(sql, userId);
  const bookingId = await sql.transaction(async (tx) => {
    // The row lock serializes concurrent joiners, so the seat count is exact.
    const [s] = await tx<SessionRow>`select * from sessions where id = ${sessionId} for update`;
    if (!s) throw new PaceError(404, "That session is gone.");
    const [mine] = await tx<BookingRow>`
      select * from bookings where session_id = ${sessionId} and participant_id = ${userId}
        and status in ('pending', 'confirmed', 'completed') limit 1`;
    const regulars = s.series_id
      ? await tx<{ profile_id: string }>`
          select profile_id from series_members where series_id = ${s.series_id} and left_at is null`
      : [];
    const inSeries = regulars.some((m) => m.profile_id === userId);
    if (s.visibility === "unlisted" && s.invite_code !== opts.inviteCode && !mine && !inSeries) {
      throw new PaceError(404, "That session is gone.");
    }
    const onIt = await tx<{ participant_id: string }>`
      select participant_id from bookings where session_id = ${sessionId}
        and status in ('pending', 'confirmed')`;
    if (await blockedBetween(tx, userId, [s.host_id, ...onIt.map((b) => b.participant_id)])) {
      throw new PaceError(404, "That session is gone.");
    }
    const [{ n }] = await tx<{ n: number }>`
      select count(*) as n from bookings where session_id = ${sessionId}
        and status in ('pending', 'confirmed', 'completed')`;
    const verdict = canBook(
      {
        hostId: s.host_id,
        startAt: ms(s.start_at)!,
        capacity: s.capacity,
        status: s.status,
        womenOnly: s.women_only,
        visibility: s.visibility,
      },
      { id: userId, gender: me.gender, frozenUntil: ms(me.frozen_until) },
      { taken: Number(n), mineActive: Boolean(mine) },
      now,
    );
    if (!verdict.ok) throw new PaceError(409, verdict.error);

    // Not a regular on this standing slot? Then this is a substitute seat: one
    // occurrence, filling in for whichever regular is out. They keep their place.
    let substituteFor: string | null = null;
    if (s.series_id && !inSeries) {
      const seated = await tx<{ participant_id: string }>`
        select participant_id from bookings where session_id = ${sessionId}
          and status in ('pending', 'confirmed')`;
      const here = new Set([s.host_id, ...seated.map((b) => b.participant_id)]);
      substituteFor = regulars.find((m) => !here.has(m.profile_id))?.profile_id ?? null;
    }

    const id = newId("bk");
    const instant = s.join_mode === "instant" || inSeries;
    await tx`
      insert into bookings (id, session_id, participant_id, status, substitute_for)
      values (${id}, ${sessionId}, ${userId}, ${instant ? "confirmed" : "pending"}, ${substituteFor})`;
    if (instant) await coverLateCancel(tx, sessionId);
    await tx`
      insert into messages (id, booking_id, from_id, text)
      values (${newId("m")}, ${id}, ${s.host_id}, ${
        instant
          ? "You’re in. The exact pin is on the session. See you there."
          : "Request received. I’ll confirm if it still fits."
      })`;
    return id;
  });
  return getBooking(sql, userId, bookingId, now);
}

type BookingJoinRow = BookingRow & {
  host_id: string;
  start_at: Date;
  duration_min: number;
  series_id: string | null;
  rated_by_me: boolean;
  my_fee_cents: number;
};

const BOOKING_SELECT = `
  select b.*, s.host_id, s.start_at, s.duration_min, s.series_id,
    exists (select 1 from ratings r where r.booking_id = b.id and r.from_id = $1) as rated_by_me,
    (select coalesce(sum(l.amount_cents), 0) from ledger_events l
      where l.booking_id = b.id and l.profile_id = $1 and l.status = 'assessed'
        and l.kind <> 'show_up_credit') as my_fee_cents
  from bookings b join sessions s on s.id = b.session_id`;

function toBooking(r: BookingJoinRow, now: number): BookingDTO {
  return {
    id: r.id,
    sessionId: r.session_id,
    participantId: r.participant_id,
    hostId: r.host_id,
    status: r.status,
    substituteFor: r.substitute_for,
    createdAt: iso(r.created_at)!,
    hostCheckedInAt: iso(r.host_checked_in_at),
    participantCheckedInAt: iso(r.participant_checked_in_at),
    checkinMethod: r.checkin_method,
    ratedByMe: r.rated_by_me,
    chatOpen: chatOpen(
      { status: r.status },
      { startAt: ms(r.start_at)!, durationMin: r.duration_min },
      now,
    ),
    myFeeCents: Number(r.my_fee_cents ?? 0),
    seriesId: r.series_id,
  };
}

export async function getBooking(
  sql: Sql,
  userId: string,
  bookingId: string,
  now = Date.now(),
): Promise<BookingDTO> {
  const [r] = await sql.query<BookingJoinRow>(
    `${BOOKING_SELECT} where b.id = $2 and (b.participant_id = $1 or s.host_id = $1)`,
    [userId, bookingId],
  );
  if (!r) throw new PaceError(404, "No booking.");
  return toBooking(r, now);
}

export async function listMyBookings(
  sql: Sql,
  userId: string,
  now = Date.now(),
): Promise<{
  bookings: BookingDTO[];
  sessions: SessionDTO[];
  series: SeriesDTO[];
  people: Person[];
}> {
  await settleDue(sql, now);
  const rows = await sql.query<BookingJoinRow>(
    `${BOOKING_SELECT}
     where (b.participant_id = $1 or s.host_id = $1)
       and s.start_at > now() - interval '30 days'
     order by s.start_at`,
    [userId],
  );
  const series = await listMySeries(sql, userId, now);
  return {
    bookings: rows.map((r) => toBooking(r, now)),
    sessions: await listMySessions(sql, userId),
    series,
    people: await people(sql, [
      ...rows.flatMap((r) => [r.host_id, r.participant_id]),
      ...series.flatMap((x) => x.memberIds),
    ]),
  };
}

/** Lock a booking + its session for a poster/joiner action. */
async function lockBooking(tx: Sql, bookingId: string) {
  const [b] = await tx<BookingRow>`select * from bookings where id = ${bookingId} for update`;
  if (!b) throw new PaceError(404, "No booking.");
  const [s] = await tx<SessionRow>`select * from sessions where id = ${b.session_id} for update`;
  if (!s) throw new PaceError(404, "No session.");
  return { b, s };
}

export async function approveBooking(sql: Sql, userId: string, bookingId: string, now = Date.now()) {
  await sql.transaction(async (tx) => {
    const { b, s } = await lockBooking(tx, bookingId);
    if (s.host_id !== userId) throw new PaceError(403, "Only the poster can approve.");
    if (b.status !== "pending") throw new PaceError(409, "No request to approve.");
    if (now >= ms(s.start_at)!) throw new PaceError(409, "It already started.");
    const [{ n }] = await tx<{ n: number }>`
      select count(*) as n from bookings where session_id = ${s.id}
        and status in ('confirmed', 'completed')`;
    if (Number(n) >= s.capacity - 1) throw new PaceError(409, "It’s full.");
    await tx`update bookings set status = 'confirmed' where id = ${bookingId}`;
    await coverLateCancel(tx, s.id);
  });
  return getBooking(sql, userId, bookingId, now);
}

export async function declineBooking(sql: Sql, userId: string, bookingId: string, now = Date.now()) {
  await sql.transaction(async (tx) => {
    const { b, s } = await lockBooking(tx, bookingId);
    if (s.host_id !== userId) throw new PaceError(403, "Only the poster can decline.");
    if (b.status !== "pending") throw new PaceError(409, "No request to decline.");
    await tx`update bookings set status = 'declined', settled_at = ${at(now)} where id = ${bookingId}`;
  });
  return getBooking(sql, userId, bookingId, now);
}

/** Also how a regular skips one week of a standing slot: the seat reopens. */
export async function cancelBooking(
  sql: Sql,
  userId: string,
  bookingId: string,
  now = Date.now(),
) {
  await sql.transaction(async (tx) => {
    const { b, s } = await lockBooking(tx, bookingId);
    if (b.participant_id !== userId) throw new PaceError(403, "Not your seat.");
    if (b.status !== "pending" && b.status !== "confirmed") {
      throw new PaceError(409, "Nothing to cancel.");
    }
    const startAt = ms(s.start_at)!;
    if (now >= startAt) throw new PaceError(409, "It already started.");
    const { late, feeCents } = cancelOutcome(b.status, startAt, now);
    await tx`
      update bookings set status = ${late ? "late_cancel" : "cancelled"}, settled_at = ${at(now)}
      where id = ${bookingId}`;
    if (late) {
      await ledger(tx, userId, "late_cancel_fee", feeCents, {
        bookingId,
        chargeableAt: feeChargeableAt(startAt, s.duration_min),
      });
    }
  });
  return getBooking(sql, userId, bookingId, now);
}

// ── Check-in + settlement ────────────────────────────────────────────────────

async function applySettlement(tx: Sql, b: BookingRow, s: SessionRow, now: number) {
  const outcome = settle(
    {
      hostCheckedIn: Boolean(b.host_checked_in_at),
      participantCheckedIn: Boolean(b.participant_checked_in_at),
    },
    ms(s.start_at)!,
    now,
  );
  if (!outcome) return;
  await tx`update bookings set status = ${outcome.status}, settled_at = ${at(now)} where id = ${b.id}`;

  if (outcome.status === "completed") {
    await tx.query(
      "update profiles set completed_count = completed_count + 1 where id = any($1)",
      [[s.host_id, b.participant_id]],
    );
  } else if (outcome.status !== "void") {
    // Same rule either way round: the one who didn't come pays and takes the
    // strike; the one who did gets membership credit.
    const [absent, present] =
      outcome.absent === "joiner" ? [b.participant_id, s.host_id] : [s.host_id, b.participant_id];
    await ledger(tx, absent, "no_show_fee", outcome.feeCents, {
      bookingId: b.id,
      chargeableAt: feeChargeableAt(ms(s.start_at)!, s.duration_min),
    });
    await strike(tx, absent, b.id, now);
    await ledger(tx, present, "show_up_credit", outcome.creditCents, { bookingId: b.id });
    await tx`
      update profiles set credit_cents = credit_cents + ${outcome.creditCents} where id = ${present}`;
  }

  // The session is done once no seat is still in play.
  const [closed] = await tx<{ id: string }>`
    update sessions set status = 'completed'
    where id = ${s.id} and status = 'open' and not exists (
      select 1 from bookings where session_id = ${s.id} and status in ('pending', 'confirmed'))
    returning id`;
  if (closed && s.series_id) {
    const [{ missed }] = await tx<{ missed: number }>`
      select count(*) as missed from bookings
      where session_id = ${s.id} and status in ('no_show', 'host_no_show', 'void', 'late_cancel')`;
    // The streak counts consecutive occurrences where everyone checked in.
    await tx.query(
      `update series set streak = case when $2::int = 0 then streak + 1 else 0 end where id = $1`,
      [s.series_id, Number(missed)],
    );
    await ensureNextOccurrence(tx, s.series_id, now);
  }
}

/**
 * Close out everything whose check-in window has shut: no-shows, voids, and
 * requests nobody answered. Idempotent; cheap to call on read, and what the
 * scheduler calls.
 */
export async function settleDue(sql: Sql, now = Date.now()): Promise<number> {
  const cutoff = at(now);
  const due = await sql<{ id: string }>`
    select b.id from bookings b join sessions s on s.id = b.session_id
    where b.status = 'confirmed' and s.start_at + interval '25 minutes' < ${cutoff}`;
  for (const { id } of due) {
    await sql.transaction(async (tx) => {
      const { b, s } = await lockBooking(tx, id);
      if (b.status === "confirmed") await applySettlement(tx, b, s, now);
    });
  }
  await sql`
    update bookings b set status = 'declined', settled_at = ${cutoff}
    from sessions s where s.id = b.session_id and b.status = 'pending' and s.start_at < ${cutoff}`;
  return due.length;
}

async function markCheckedIn(
  tx: Sql,
  b: BookingRow,
  s: SessionRow,
  who: "host" | "participant" | "both",
  method: CheckinMethod,
  now: number,
) {
  const when = at(now);
  if (who === "host" || who === "both") {
    // The poster arrives once, for every seat on the session.
    await tx`
      update bookings set host_checked_in_at = coalesce(host_checked_in_at, ${when})
      where session_id = ${s.id} and status = 'confirmed'`;
  }
  if (who === "participant" || who === "both") {
    await tx`
      update bookings set participant_checked_in_at = coalesce(participant_checked_in_at, ${when}),
        checkin_method = coalesce(checkin_method, ${method})
      where id = ${b.id}`;
  }
  const seats = await tx<BookingRow>`
    select * from bookings where session_id = ${s.id} and status = 'confirmed' for update`;
  for (const seat of seats) await applySettlement(tx, seat, s, now);
}

export async function checkInGeo(
  sql: Sql,
  userId: string,
  bookingId: string,
  fix: { lat: number; lng: number; accuracyM?: number },
  now = Date.now(),
) {
  await sql.transaction(async (tx) => {
    const { b, s } = await lockBooking(tx, bookingId);
    const role = s.host_id === userId ? "host" : b.participant_id === userId ? "participant" : null;
    if (!role) throw new PaceError(404, "No booking.");
    if (b.status !== "confirmed") throw new PaceError(409, "No confirmed seat to check in.");
    const [venue] = await tx<Venue>`select * from venues where id = ${s.venue_id}`;
    const verdict = canGeoCheckIn(ms(s.start_at)!, venue, fix, now);
    if (!verdict.ok) throw new PaceError(409, verdict.error);
    await markCheckedIn(tx, b, s, role, "geo", now);
  });
  return getBooking(sql, userId, bookingId, now);
}

/** The poster shows a fresh 4-digit code on their phone. Logged; valid 10 minutes. */
export async function revealCode(sql: Sql, userId: string, sessionId: string, now = Date.now()) {
  return sql.transaction(async (tx) => {
    const [s] = await tx<SessionRow>`select * from sessions where id = ${sessionId} for update`;
    if (!s || s.host_id !== userId) throw new PaceError(404, "Session not found.");
    if (!inCheckinWindow(ms(s.start_at)!, now)) {
      throw new PaceError(409, "Outside the check-in window.");
    }
    // Rotate on every reveal so an old screenshot can't be replayed.
    const code = fourDigits();
    await tx`update sessions set code = ${code}, code_revealed_at = ${at(now)} where id = ${sessionId}`;
    return { code, revealedAt: at(now), window: checkinWindow(ms(s.start_at)!) };
  });
}

/**
 * The joiner types the code off the poster's screen. Knowing a code that only
 * exists on that phone proves they're together, so it checks in both.
 */
export async function checkInCode(
  sql: Sql,
  userId: string,
  bookingId: string,
  entered: string,
  now = Date.now(),
) {
  await sql.transaction(async (tx) => {
    const { b, s } = await lockBooking(tx, bookingId);
    if (b.participant_id !== userId) throw new PaceError(404, "No booking.");
    if (b.status !== "confirmed") throw new PaceError(409, "No confirmed seat to check in.");
    const verdict = canUseCode(
      { code: s.code, codeRevealedAt: ms(s.code_revealed_at), startAt: ms(s.start_at)! },
      entered,
      now,
    );
    if (!verdict.ok) throw new PaceError(409, verdict.error);
    await markCheckedIn(tx, b, s, "both", "code", now);
  });
  return getBooking(sql, userId, bookingId, now);
}

// ── Standing slots ───────────────────────────────────────────────────────────

/**
 * Make sure an active standing slot has its next occurrence on the calendar:
 * same place, level and wall-clock time, a week after the latest one, with every
 * regular already confirmed. Each occurrence is a normal session — check-in and
 * no-show rules included.
 */
async function ensureNextOccurrence(tx: Sql, seriesId: string, now: number): Promise<string | null> {
  const [series] = await tx<{ status: string }>`
    select status from series where id = ${seriesId} for update`;
  if (!series || series.status !== "active") return null;
  const [upcoming] = await tx<{ id: string }>`
    select id from sessions where series_id = ${seriesId} and status = 'open'
      and start_at > ${at(now)} order by start_at limit 1`;
  if (upcoming) return upcoming.id;

  const members = (
    await tx<{ profile_id: string }>`
      select profile_id from series_members where series_id = ${seriesId} and left_at is null
      order by joined_at, profile_id`
  ).map((m) => m.profile_id);
  if (members.length < 2) {
    await tx`update series set status = 'ended' where id = ${seriesId}`;
    return null;
  }
  const [last] = await tx<SessionRow>`
    select * from sessions where series_id = ${seriesId} order by start_at desc limit 1`;
  if (!last) return null;
  let startAt = nextOccurrence(ms(last.start_at)!);
  while (startAt < now + MIN_LEAD_TIME_MS) startAt = nextOccurrence(startAt);

  const host = members.includes(last.host_id) ? last.host_id : members[0];
  const id = newId("ses");
  await tx`
    insert into sessions (
      id, host_id, venue_id, activity, title, detail, ability, ability_flex, route_url, start_at,
      duration_min, capacity, visibility, join_mode, women_only, code, invite_code, series_id
    ) values (
      ${id}, ${host}, ${last.venue_id}, ${last.activity}, ${last.title}, ${last.detail},
      ${JSON.stringify(json(last.ability))}::jsonb, ${last.ability_flex}, ${last.route_url},
      ${at(startAt)}, ${last.duration_min}, ${Math.max(last.capacity, members.length)},
      ${last.visibility}, ${last.join_mode}, ${last.women_only}, ${fourDigits()},
      ${last.visibility === "unlisted" ? inviteToken() : null}, ${seriesId}
    )`;
  for (const member of members.filter((m) => m !== host)) {
    const bookingId = newId("bk");
    await tx`
      insert into bookings (id, session_id, participant_id, status)
      values (${bookingId}, ${id}, ${member}, 'confirmed')`;
    await tx`
      insert into messages (id, booking_id, from_id, text)
      values (${newId("m")}, ${bookingId}, ${host}, 'Same time next week. See you there.')`;
  }
  return id;
}

/**
 * "Same time next week." One tap on a completed session turns the people who
 * showed up into a standing slot.
 */
export async function repeatWeekly(
  sql: Sql,
  userId: string,
  bookingId: string,
  now = Date.now(),
): Promise<SeriesDTO> {
  const seriesId = await sql.transaction(async (tx) => {
    const { b, s } = await lockBooking(tx, bookingId);
    if (s.host_id !== userId && b.participant_id !== userId) throw new PaceError(404, "No booking.");
    if (b.status !== "completed") {
      throw new PaceError(409, "A standing slot starts from a session you both showed up to.");
    }
    let id = s.series_id;
    if (!id) {
      id = newId("ser");
      await tx`insert into series (id, created_by) values (${id}, ${userId})`;
      await tx`update sessions set series_id = ${id} where id = ${s.id}`;
      const showed = await tx<{ participant_id: string }>`
        select participant_id from bookings where session_id = ${s.id} and status = 'completed'`;
      if (await blockedBetween(tx, userId, [s.host_id, ...showed.map((x) => x.participant_id)])) {
        throw new PaceError(409, "That standing slot can’t be set up.");
      }
      for (const member of new Set([s.host_id, ...showed.map((x) => x.participant_id)])) {
        await tx`
          insert into series_members (series_id, profile_id) values (${id}, ${member})
          on conflict (series_id, profile_id) do update set left_at = null`;
      }
    }
    await ensureNextOccurrence(tx, id, now);
    return id;
  });
  const mine = await listMySeries(sql, userId, now);
  const found = mine.find((x) => x.id === seriesId);
  if (!found) throw new PaceError(409, "That standing slot has ended.");
  return found;
}

export async function listMySeries(sql: Sql, userId: string, now = Date.now()): Promise<SeriesDTO[]> {
  const rows = await sql<{ id: string; streak: number }>`
    select se.id, se.streak from series se
    join series_members m on m.series_id = se.id and m.profile_id = ${userId} and m.left_at is null
    where se.status = 'active' order by se.created_at`;
  const out: SeriesDTO[] = [];
  for (const r of rows) {
    const members = await sql<{ profile_id: string }>`
      select profile_id from series_members where series_id = ${r.id} and left_at is null`;
    const [next] = await sql<SessionRow>`
      select * from sessions where series_id = ${r.id} and status = 'open' and start_at > ${at(now)}
      order by start_at limit 1`;
    const [last] = next
      ? [next]
      : await sql<SessionRow>`
          select * from sessions where series_id = ${r.id} order by start_at desc limit 1`;
    if (!last) continue;
    out.push({
      id: r.id,
      streak: r.streak,
      memberIds: members.map((m) => m.profile_id),
      title: last.title,
      activity: last.activity,
      abilityLabel: abilityLabel(json<Ability>(last.ability)),
      venueId: last.venue_id,
      nextSessionId: next?.id ?? null,
      nextStartAt: next ? iso(next.start_at) : null,
    });
  }
  return out;
}

/** Leave a standing slot. Fewer than two regulars left ends it. */
export async function leaveSeries(sql: Sql, userId: string, seriesId: string, now = Date.now()) {
  await sql.transaction(async (tx) => {
    const [m] = await tx`
      select 1 from series_members where series_id = ${seriesId} and profile_id = ${userId}
        and left_at is null for update`;
    if (!m) throw new PaceError(404, "Not your standing slot.");
    await tx`
      update series_members set left_at = ${at(now)}
      where series_id = ${seriesId} and profile_id = ${userId}`;
    const remaining = (
      await tx<{ profile_id: string }>`
        select profile_id from series_members where series_id = ${seriesId} and left_at is null
        order by joined_at, profile_id`
    ).map((x) => x.profile_id);
    const future = await tx<SessionRow>`
      select * from sessions where series_id = ${seriesId} and status = 'open'
        and start_at > ${at(now)} for update`;
    for (const s of future) {
      if (remaining.length < 2) {
        await tx`
          update bookings set status = 'cancelled', settled_at = ${at(now)}
          where session_id = ${s.id} and status in ('pending', 'confirmed')`;
        await tx`update sessions set status = 'cancelled' where id = ${s.id}`;
      } else if (s.host_id === userId) {
        // Hand the occurrence to the longest-standing regular; their seat becomes the post.
        await tx`
          update bookings set status = 'cancelled', settled_at = ${at(now)}
          where session_id = ${s.id} and participant_id = ${remaining[0]}
            and status in ('pending', 'confirmed')`;
        await tx`update sessions set host_id = ${remaining[0]} where id = ${s.id}`;
      } else {
        await tx`
          update bookings set status = 'cancelled', settled_at = ${at(now)}
          where session_id = ${s.id} and participant_id = ${userId}
            and status in ('pending', 'confirmed')`;
      }
    }
    if (remaining.length < 2) await tx`update series set status = 'ended' where id = ${seriesId}`;
  });
}

/**
 * Take a member off the calendar: leave every standing slot, call off what they
 * posted, release the seats they hold. Nobody is charged for any of it — this
 * runs when an account is deleted or paused, not when someone flakes.
 */
export async function withdrawEverything(sql: Sql, userId: string, now = Date.now()) {
  await sql.transaction(async (tx) => {
    const slots = await tx<{ series_id: string }>`
      select series_id from series_members where profile_id = ${userId} and left_at is null`;
    for (const { series_id } of slots) await leaveSeries(tx, userId, series_id, now);
    const hosted = await tx<{ id: string }>`
      select id from sessions where host_id = ${userId} and status = 'open'
        and start_at > ${at(now)} for update`;
    for (const { id } of hosted) {
      await tx`
        update bookings set status = 'cancelled', settled_at = ${at(now)}
        where session_id = ${id} and status in ('pending', 'confirmed')`;
      await tx`update sessions set status = 'cancelled' where id = ${id}`;
    }
    await tx`
      update bookings b set status = 'cancelled', settled_at = ${at(now)}
      from sessions s
      where s.id = b.session_id and b.participant_id = ${userId}
        and b.status in ('pending', 'confirmed') and s.start_at > ${at(now)}`;
  });
}

/**
 * What a block undoes between two people: upcoming seats with each other are
 * released free, and the blocker steps out of any standing slot they share.
 */
export async function severTies(sql: Sql, blocker: string, blocked: string, now = Date.now()) {
  await sql.transaction(async (tx) => {
    const shared = await tx<{ series_id: string }>`
      select a.series_id from series_members a
      join series_members b on b.series_id = a.series_id
      where a.profile_id = ${blocker} and a.left_at is null
        and b.profile_id = ${blocked} and b.left_at is null`;
    for (const { series_id } of shared) await leaveSeries(tx, blocker, series_id, now);
    await tx`
      update bookings b set status = 'cancelled', settled_at = ${at(now)}
      from sessions s
      where s.id = b.session_id and b.status in ('pending', 'confirmed') and s.start_at > ${at(now)}
        and ((s.host_id = ${blocker} and b.participant_id = ${blocked})
          or (s.host_id = ${blocked} and b.participant_id = ${blocker}))`;
  });
}

// ── Chat ─────────────────────────────────────────────────────────────────────

async function threadAccess(sql: Sql, userId: string, bookingId: string) {
  const [r] = await sql<BookingRow & { host_id: string; start_at: Date; duration_min: number }>`
    select b.*, s.host_id, s.start_at, s.duration_min
    from bookings b join sessions s on s.id = b.session_id where b.id = ${bookingId}`;
  if (!r || (r.participant_id !== userId && r.host_id !== userId)) {
    throw new PaceError(404, "Thread closed.");
  }
  return r;
}

export async function listMessages(
  sql: Sql,
  userId: string,
  bookingId: string,
): Promise<ChatMessage[]> {
  await threadAccess(sql, userId, bookingId);
  const rows = await sql<{ id: string; booking_id: string; from_id: string; text: string; created_at: Date }>`
    select * from messages where booking_id = ${bookingId} order by created_at, id`;
  return rows.map((m) => ({
    id: m.id,
    bookingId: m.booking_id,
    fromId: m.from_id,
    text: m.text,
    createdAt: iso(m.created_at)!,
  }));
}

export async function sendMessage(
  sql: Sql,
  userId: string,
  bookingId: string,
  text: string,
  now = Date.now(),
): Promise<ChatMessage[]> {
  const r = await threadAccess(sql, userId, bookingId);
  const open = chatOpen(
    { status: r.status },
    { startAt: ms(r.start_at)!, durationMin: r.duration_min },
    now,
  );
  if (!open) throw new PaceError(409, "This thread expired.");
  if (await blockedBetween(sql, userId, [r.host_id, r.participant_id])) {
    throw new PaceError(409, "This thread is closed.");
  }
  const body = text.trim().slice(0, 2000);
  if (!body) throw new PaceError(400, "Say something.");
  await sql`
    insert into messages (id, booking_id, from_id, text)
    values (${newId("m")}, ${bookingId}, ${userId}, ${body})`;
  return listMessages(sql, userId, bookingId);
}

// ── Ratings ──────────────────────────────────────────────────────────────────

export type RatingInput = {
  showedUp: boolean;
  onTime: boolean;
  /** Includes "the level was as stated". */
  matchedListing: boolean;
  respectful: boolean;
  wouldJoinAgain: boolean;
};

export async function submitRating(
  sql: Sql,
  userId: string,
  bookingId: string,
  input: RatingInput,
) {
  await sql.transaction(async (tx) => {
    const { b, s } = await lockBooking(tx, bookingId);
    const toId = s.host_id === userId ? b.participant_id : b.participant_id === userId ? s.host_id : null;
    if (!toId) throw new PaceError(404, "No booking.");
    if (b.status !== "completed") throw new PaceError(409, "Rate after both of you check in.");
    const [dupe] = await tx`
      select 1 from ratings where booking_id = ${bookingId} and from_id = ${userId}`;
    if (dupe) throw new PaceError(409, "Already rated.");
    await tx`
      insert into ratings (id, booking_id, from_id, to_id, showed_up, on_time,
        matched_listing, respectful, would_join_again)
      values (${newId("rt")}, ${bookingId}, ${userId}, ${toId}, ${input.showedUp},
        ${input.onTime}, ${input.matchedListing}, ${input.respectful}, ${input.wouldJoinAgain})`;
    await tx`
      update profiles set
        on_time_total = on_time_total + 1,
        on_time_yes = on_time_yes + ${input.onTime ? 1 : 0},
        would_join_total = would_join_total + 1,
        would_join_yes = would_join_yes + ${input.wouldJoinAgain ? 1 : 0}
      where id = ${toId}`;
  });
  return getBooking(sql, userId, bookingId);
}
