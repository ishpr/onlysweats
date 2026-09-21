/**
 * Training blocks (server-only, PRD v0.3 §6): one to four standing slots tied to a
 * goal and a date. A block adds no session mechanics of its own — its weekly slots
 * are ordinary standing slots, and its progress is read off the check-ins they
 * already record. Nothing here is logged by a member, and no body metric exists.
 */
import type { Sql } from "../db.ts";
import { assertMembershipEntitled } from "../billing/service.server.ts";
import { dayAndTime, enqueue, firstName } from "./notify.server.ts";
import {
  abilityFits,
  abilityLabel,
  blockFinished,
  blockJoinable,
  blockWeek,
  blockWeeks,
  canGiveCredits,
  creditable,
  CREDIT_WINDOW_DAYS,
  KEEP_SLOTS_DAYS,
  slotsUndecided,
  BLOCK_FIRST_WEEK_DAYS,
  BLOCK_JOIN_MIN_DAYS,
  BLOCK_MAX_SLOTS,
  canJoinBlock,
  canPost,
  clusterDate,
  FORMING_GRACE_DAYS,
  goalLabel,
  MIN_LEAD_TIME_MS,
  NEW_SLOT_LEAD_MS,
  nextOccurrence,
  plannedAndKept,
  validAbility,
  validBlock,
  type BlockFacts,
  type Occurrence,
} from "./rules.ts";
import {
  assertNoAssistantOverlap,
  at,
  blockedBetween,
  ensureNextOccurrence as repeatSeries,
  fourDigits,
  inviteToken,
  iso,
  json,
  leaveSeries,
  ms,
  newId,
  PaceError,
  people,
  profileRow,
  requireVerified,
  validRegulars,
  type SessionRow,
} from "./service.server.ts";
import type {
  Ability,
  Activity,
  GoalKind,
  JoinMode,
  MemberAbilities,
  Person,
  TrainingBlockStatus,
  Venue,
  Visibility,
} from "./types.ts";

/** A closed block stays on a member's Today this long after its goal date. */
const SHOW_CLOSED_DAYS = 14;

type BlockRow = {
  id: string;
  created_by: string;
  activity: Activity;
  goal_kind: GoalKind;
  event_name: string | null;
  starts_on: string;
  goal_date: string;
  capacity: number;
  visibility: Visibility;
  join_mode: JoinMode;
  women_only: boolean;
  invite_code: string | null;
  status: TrainingBlockStatus;
  ended_reason: "goal_date" | "too_few" | "removed" | null;
};

const factsOf = (b: BlockRow): BlockFacts => ({
  status: b.status,
  visibility: b.visibility,
  womenOnly: b.women_only,
  capacity: b.capacity,
  goalDate: b.goal_date,
});

const BLOCK_COLUMNS = `
  tb.id, tb.created_by, tb.activity, tb.goal_kind, tb.event_name,
  tb.starts_on::text as starts_on, tb.goal_date::text as goal_date,
  tb.capacity, tb.visibility, tb.join_mode, tb.women_only, tb.invite_code, tb.status,
  tb.ended_reason`;

export type Progress = { planned: number; kept: number; keptMiles: number };

export type BlockSlotDTO = {
  seriesId: string;
  title: string;
  abilityLabel: string;
  venueId: string;
  streak: number;
  nextSessionId: string | null;
  nextStartAt: string | null;
};

export type TrainingBlockDTO = {
  id: string;
  createdBy: string;
  activity: Activity;
  goalKind: GoalKind;
  eventName: string | null;
  /** "Dallas Marathon", or "3× a week for 12 weeks". */
  goalLabel: string;
  startsOn: string;
  goalDate: string;
  weeks: number;
  weekNumber: number;
  capacity: number;
  visibility: Visibility;
  joinMode: JoinMode;
  womenOnly: boolean;
  status: TrainingBlockStatus;
  /** Who is asking: only a member sees progress, requests and the invite code. */
  viewer: "member" | "pending" | "declined" | "visitor";
  memberIds: string[];
  memberCount: number;
  /** Regular seats still open. Joining takes one on every slot. */
  seatsLeft: number;
  /** Running, a seat open, and four weeks or more to go. */
  joinable: boolean;
  /** Every slot inside my level? `null` until I've set one for this activity. */
  fitsMe: boolean | null;
  /** Members only: who has asked to join, when members approve each person. */
  requests: string[];
  /** Whoever started it only: the link that opens an unlisted block. */
  inviteCode?: string;
  slots: BlockSlotDTO[];
  /** Mine alone — nobody sees another member's count. */
  my: Progress & { finished: boolean | null };
  /** Everyone's sessions added up. */
  group: { planned: number; kept: number };
  /**
   * Set for a member once the goal date has passed. `creditsOpen`: I finished, the
   * week for it is still running, and I haven't answered — `creditable` is who I
   * can say "helped me stick to it" about. `slotsUndecided`: the weekly slots have
   * stopped and can still be kept or carried into a next block.
   */
  ending: { creditsOpen: boolean; creditable: string[]; slotsUndecided: boolean } | null;
};

export type BlockGoalInput = {
  goalKind: GoalKind;
  eventName?: string | null;
  goalDate: string;
};

export type BlockSlotInput = {
  venueId: string;
  title: string;
  detail: string;
  ability: Ability;
  abilityFlex: "strict" | "flexible";
  routeUrl?: string | null;
  startAt: string;
  durationMin: number;
};

// ── Progress ─────────────────────────────────────────────────────────────────

type OccurrenceRow = {
  start_at: Date;
  status: "open" | "cancelled" | "completed";
  cancelled_by: string | null;
  host_id: string;
  ability: unknown;
  host_in: boolean;
  joiners_in: string[] | null;
  seated: string[] | null;
};

/** Every occurrence of a block's slots, with who checked in to it. */
async function occurrencesOf(sql: Sql, blockId: string): Promise<OccurrenceRow[]> {
  return sql<OccurrenceRow>`
    select s.start_at, s.status, s.cancelled_by, s.host_id, s.ability,
      exists (select 1 from bookings b
        where b.session_id = s.id and b.host_checked_in_at is not null) as host_in,
      (select array_agg(b.participant_id) from bookings b
        where b.session_id = s.id and b.participant_checked_in_at is not null) as joiners_in,
      (select array_agg(b.participant_id) from bookings b
        where b.session_id = s.id
          and b.status in ('confirmed', 'completed', 'no_show', 'host_no_show', 'void')) as seated
    from sessions s
    where s.training_block_id = ${blockId}
    order by s.start_at`;
}

/** One member's side of those occurrences, for the time they were in the block. */
function sideOf(
  rows: OccurrenceRow[],
  member: { id: string; joinedAt: number; leftAt: number | null },
): Occurrence[] {
  return rows
    .filter((r) => {
      const startAt = ms(r.start_at)!;
      return startAt >= member.joinedAt && (member.leftAt === null || startAt <= member.leftAt);
    })
    .map((r) => {
      const posted = r.host_id === member.id;
      const ability = json<Ability>(r.ability);
      return {
        startAt: ms(r.start_at)!,
        checkedIn: posted ? r.host_in : (r.joiners_in ?? []).includes(member.id),
        calledOff: r.status === "cancelled",
        calledOffByMe: r.cancelled_by === member.id,
        stoodAlone: posted && (r.seated ?? []).length === 0,
        miles: "miles" in ability ? ability.miles : 0,
      };
    });
}

type MemberRow = {
  profile_id: string;
  joined_at: Date;
  left_at: Date | null;
  planned_count: number | null;
  kept_count: number | null;
  kept_miles: string | number | null;
  finished: boolean | null;
  credits_answered_at: Date | null;
};

const membersOf = (sql: Sql, blockId: string) => sql<MemberRow>`
  select profile_id, joined_at, left_at, planned_count, kept_count, kept_miles, finished,
    credits_answered_at
  from training_block_members where block_id = ${blockId} and left_at is null
  order by joined_at, profile_id`;

// ── Reads ────────────────────────────────────────────────────────────────────

async function toDTO(
  sql: Sql,
  b: BlockRow,
  viewer: string,
  now: number,
): Promise<TrainingBlockDTO> {
  const members = await membersOf(sql, b.id);
  const isMember = members.some((m) => m.profile_id === viewer);
  const rows = isMember ? await occurrencesOf(sql, b.id) : [];
  let mine: TrainingBlockDTO["my"] = { planned: 0, kept: 0, keptMiles: 0, finished: null };
  const group = { planned: 0, kept: 0 };
  // Progress is the members' business: a visitor gets zeros.
  for (const m of isMember ? members : []) {
    // Once the block has closed, the snapshot is the record.
    const p: Progress =
      m.planned_count === null
        ? plannedAndKept(
            sideOf(rows, { id: m.profile_id, joinedAt: ms(m.joined_at)!, leftAt: ms(m.left_at) }),
            now,
          )
        : {
            planned: m.planned_count,
            kept: m.kept_count ?? 0,
            keptMiles: Number(m.kept_miles ?? 0),
          };
    group.planned += p.planned;
    group.kept += p.kept;
    if (m.profile_id === viewer) mine = { ...p, finished: m.finished };
  }

  const [me] = await sql<{
    abilities: unknown;
  }>`select abilities from profiles where id = ${viewer}`;
  const myLevels = json<MemberAbilities>(me?.abilities) ?? {};
  const fits: (boolean | null)[] = [];
  const series = await sql<{ id: string; streak: number }>`
    select id, streak from series where training_block_id = ${b.id} and status = 'active'
    order by created_at, id`;
  const slots: BlockSlotDTO[] = [];
  for (const se of series) {
    const [next] = await sql<SessionRow>`
      select * from sessions where series_id = ${se.id} and status = 'open' and start_at > ${at(now)}
      order by start_at limit 1`;
    const [last] = next
      ? [next]
      : await sql<SessionRow>`
          select * from sessions where series_id = ${se.id} order by start_at desc limit 1`;
    if (!last) continue;
    const ability = json<Ability>(last.ability);
    fits.push(abilityFits(myLevels, ability, last.ability_flex));
    slots.push({
      seriesId: se.id,
      title: last.title,
      abilityLabel: abilityLabel(ability),
      venueId: last.venue_id,
      streak: se.streak,
      nextSessionId: next?.id ?? null,
      nextStartAt: next ? iso(next.start_at) : null,
    });
  }

  // In the order the week runs, not the order they were created.
  slots.sort(
    (a, b) =>
      (a.nextStartAt ?? "9").localeCompare(b.nextStartAt ?? "9") || a.title.localeCompare(b.title),
  );

  const ending = isMember ? await endingOf(sql, b, viewer, members, now) : null;

  const requests = await sql<{ profile_id: string; status: string }>`
    select profile_id, status from training_block_requests where block_id = ${b.id}`;
  const asked = requests.find((r) => r.profile_id === viewer)?.status;
  const weeks = blockWeeks(b.starts_on, b.goal_date);
  return {
    id: b.id,
    createdBy: b.created_by,
    activity: b.activity,
    goalKind: b.goal_kind,
    eventName: b.event_name,
    goalLabel: goalLabel(b.goal_kind, b.event_name, Math.max(slots.length, 1), weeks),
    startsOn: b.starts_on,
    goalDate: b.goal_date,
    weeks,
    weekNumber: blockWeek(b.starts_on, b.goal_date, clusterDate(now)),
    capacity: b.capacity,
    visibility: b.visibility,
    joinMode: b.join_mode,
    womenOnly: b.women_only,
    status: b.status,
    viewer: isMember
      ? "member"
      : asked === "pending"
        ? "pending"
        : asked === "declined"
          ? "declined"
          : "visitor",
    memberIds: members.map((m) => m.profile_id),
    memberCount: members.length,
    seatsLeft: Math.max(0, b.capacity - members.length),
    joinable: blockJoinable(factsOf(b), members.length, clusterDate(now)),
    fitsMe: fits.includes(false) ? false : fits.includes(null) ? null : true,
    requests: isMember
      ? requests.filter((r) => r.status === "pending").map((r) => r.profile_id)
      : [],
    inviteCode: b.created_by === viewer ? (b.invite_code ?? undefined) : undefined,
    slots,
    my: mine,
    group,
    ending,
  };
}

const past = (b: BlockRow) =>
  b.status === "closing" || (b.status === "ended" && b.ended_reason === "goal_date");

/** Who a member shared enough check-ins with, minus anyone blocked or gone. */
async function creditableFor(sql: Sql, blockId: string, userId: string): Promise<string[]> {
  const rows = await occurrencesOf(sql, blockId);
  const ids = creditable(
    userId,
    rows.map((r) => ({ checkedIn: [...(r.host_in ? [r.host_id] : []), ...(r.joiners_in ?? [])] })),
  );
  if (ids.length === 0) return [];
  const ok = await sql.query<{ id: string }>(
    `select p.id from profiles p
     where p.id = any($2) and p.deleted_at is null and p.suspended_at is null
       and not exists (select 1 from blocks k
         where (k.blocker_id = $1 and k.blocked_id = p.id)
            or (k.blocked_id = $1 and k.blocker_id = p.id))
     order by p.id`,
    [userId, ids],
  );
  return ok.map((r) => r.id);
}

async function endingOf(
  sql: Sql,
  b: BlockRow,
  viewer: string,
  members: MemberRow[],
  now: number,
): Promise<TrainingBlockDTO["ending"]> {
  if (!past(b)) return null;
  const me = members.find((m) => m.profile_id === viewer);
  const today = clusterDate(now);
  const open = canGiveCredits(
    { status: b.status, goalDate: b.goal_date },
    { finished: me?.finished ?? null, answered: Boolean(me?.credits_answered_at) },
    today,
  ).ok;
  const [attached] = await sql`
    select 1 from series where training_block_id = ${b.id} and status = 'active' limit 1`;
  return {
    creditsOpen: open,
    creditable: open ? await creditableFor(sql, b.id, viewer) : [],
    slotsUndecided: Boolean(attached) && slotsUndecided(b.goal_date, today),
  };
}

/** The block, for one of its members: anyone else gets a 404. */
async function myBlockRow(sql: Sql, userId: string, blockId: string): Promise<BlockRow> {
  const [b] = await sql.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from training_blocks tb
     join training_block_members m on m.block_id = tb.id and m.profile_id = $1 and m.left_at is null
     where tb.id = $2`,
    [userId, blockId],
  );
  if (!b) throw new PaceError(404, "No training block.");
  return b;
}

/**
 * The block, for anyone allowed to look at it. A member always is. A visitor sees
 * a running block that is public — or unlisted, with its invite code or a request
 * already in — unless it is women-only and not open to them, or they and a member
 * have blocked each other. Anything else looks exactly like a block that isn't there.
 */
async function visibleBlockRow(
  sql: Sql,
  userId: string,
  blockId: string,
  inviteCode?: string,
): Promise<BlockRow> {
  const gone = new PaceError(404, "No training block.");
  const [b] = await sql.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from training_blocks tb where tb.id = $1`,
    [blockId],
  );
  if (!b) throw gone;
  const members = (await membersOf(sql, blockId)).map((m) => m.profile_id);
  if (members.includes(userId)) return b;
  if (b.status !== "forming" && b.status !== "active") throw gone;
  if (await blockedBetween(sql, userId, members)) throw gone;
  const me = await profileRow(sql, userId);
  if (b.women_only && me.gender !== "woman") throw gone;
  if (b.visibility === "unlisted" && b.invite_code !== inviteCode) {
    const [asked] = await sql`
      select 1 from training_block_requests where block_id = ${blockId} and profile_id = ${userId}`;
    if (!asked) throw gone;
  }
  return b;
}

export async function getTrainingBlock(
  sql: Sql,
  userId: string,
  blockId: string,
  opts: { inviteCode?: string } = {},
  now = Date.now(),
): Promise<{ block: TrainingBlockDTO; people: Person[] }> {
  await closeDueBlocks(sql, now);
  const row = await visibleBlockRow(sql, userId, blockId, opts.inviteCode);
  const block = await toDTO(sql, row, userId, now);
  // A profile is reachable from a session someone posted or joined — a block's
  // members are on its sessions. No one else is listed.
  return {
    block,
    people: await people(sql, [
      ...block.memberIds,
      ...block.requests,
      ...(block.ending?.creditable ?? []),
    ]),
  };
}

/** The blocks I'm in: running ones, and ones that closed in the last two weeks. */
export async function listMyTrainingBlocks(
  sql: Sql,
  userId: string,
  now = Date.now(),
): Promise<TrainingBlockDTO[]> {
  await closeDueBlocks(sql, now);
  const rows = await sql.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from training_blocks tb
     join training_block_members m on m.block_id = tb.id and m.profile_id = $1 and m.left_at is null
     where tb.status in ('forming', 'active')
        or ((tb.status = 'closing' or (tb.status = 'ended' and tb.ended_reason = 'goal_date'))
            and tb.goal_date >= $2::date - $3::int)
     order by tb.goal_date, tb.id`,
    [userId, clusterDate(now), SHOW_CLOSED_DAYS],
  );
  const out: TrainingBlockDTO[] = [];
  for (const b of rows) out.push(await toDTO(sql, b, userId, now));
  return out;
}

/**
 * Discovery, for blocks: public, running, a regular seat open, four weeks or more
 * to go. Like sessions it shows the workout, the level and the time — no faces,
 * and no member ids.
 */
export async function listPublicTrainingBlocks(
  sql: Sql,
  viewer: string,
  now = Date.now(),
): Promise<TrainingBlockDTO[]> {
  await closeDueBlocks(sql, now);
  const me = await profileRow(sql, viewer);
  const rows = await sql.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from training_blocks tb
     where tb.visibility = 'public' and tb.status in ('forming', 'active')
       and tb.goal_date - $2::date >= $3::int
       and (not tb.women_only or $4::boolean)
       and (select count(*) from training_block_members m
             where m.block_id = tb.id and m.left_at is null) < tb.capacity
       and not exists (select 1 from training_block_members m
             where m.block_id = tb.id and m.profile_id = $1 and m.left_at is null)
       and not exists (
         select 1 from training_block_members m
         join blocks k on (k.blocker_id = $1 and k.blocked_id = m.profile_id)
                       or (k.blocked_id = $1 and k.blocker_id = m.profile_id)
         where m.block_id = tb.id and m.left_at is null)
     order by tb.starts_on, tb.id`,
    [viewer, clusterDate(now), BLOCK_JOIN_MIN_DAYS, me.gender === "woman"],
  );
  const out: TrainingBlockDTO[] = [];
  for (const b of rows) out.push({ ...(await toDTO(sql, b, viewer, now)), memberIds: [] });
  return out;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * "Make this a training block": a standing slot gets a goal and a date, and its
 * regulars become the block's members. One tap from any regular, the same way a
 * standing slot itself starts.
 */
export async function blockFromSeries(
  sql: Sql,
  userId: string,
  seriesId: string,
  input: BlockGoalInput,
  now = Date.now(),
): Promise<TrainingBlockDTO> {
  const blockId = await sql.transaction((tx) => blockFromSlots(tx, userId, [seriesId], input, now));
  return toDTO(sql, await myBlockRow(sql, userId, blockId), userId, now);
}

/** Standing slots that share their regulars become one block. Returns its id. */
async function blockFromSlots(
  tx: Sql,
  userId: string,
  seriesIds: string[],
  input: BlockGoalInput,
  now: number,
): Promise<string> {
  let members: string[] = [];
  let first: SessionRow | undefined;
  for (const seriesId of seriesIds) {
    const [series] = await tx<{ status: string; training_block_id: string | null }>`
      select status, training_block_id from series where id = ${seriesId} for update`;
    const regulars = (
      await tx<{ profile_id: string }>`
        select profile_id from series_members where series_id = ${seriesId} and left_at is null
        order by joined_at, profile_id`
    ).map((m) => m.profile_id);
    if (!series || !regulars.includes(userId)) throw new PaceError(404, "Not your standing slot.");
    if (series.status !== "active" || regulars.length < 2) {
      throw new PaceError(409, "That standing slot has ended.");
    }
    if (series.training_block_id) {
      throw new PaceError(409, "This slot is already part of a training block.");
    }
    const [last] = await tx<SessionRow>`
      select * from sessions where series_id = ${seriesId} order by start_at desc limit 1`;
    if (!last) throw new PaceError(409, "That standing slot has ended.");
    first ??= last;
    members = [...new Set([...members, ...regulars])];
  }
  if (!first) throw new PaceError(409, "That standing slot has ended.");
  for (const member of members) await assertMembershipEntitled(tx, member, now);

  const startsOn = clusterDate(now);
  const verdict = validBlock({
    activity: first.activity,
    goalKind: input.goalKind,
    eventName: input.eventName,
    startsOn,
    goalDate: input.goalDate,
  });
  if (!verdict.ok) throw new PaceError(400, verdict.error);

  const id = newId("tb");
  await tx`
    insert into training_blocks (
      id, created_by, activity, goal_kind, event_name, starts_on, goal_date, capacity,
      visibility, join_mode, women_only, invite_code, status
    ) values (
      ${id}, ${userId}, ${first.activity}, ${input.goalKind}, ${input.eventName?.trim() || null},
      ${startsOn}::date, ${input.goalDate}::date, ${Math.min(4, Math.max(first.capacity, members.length))},
      ${first.visibility}, ${first.join_mode}, ${first.women_only},
      ${first.visibility === "unlisted" ? inviteToken() : null}, 'active'
    )`;
  for (const member of members) {
    await tx`
      insert into training_block_members (block_id, profile_id, joined_at)
      values (${id}, ${member}, ${at(now)})`;
  }
  await tx.query("update series set training_block_id = $1 where id = any($2)", [id, seriesIds]);
  // The weeks already on the calendar are this block's first.
  await tx.query(
    `update sessions set training_block_id = $1
     where series_id = any($2) and status = 'open' and start_at > $3`,
    [id, seriesIds, at(now)],
  );
  return id;
}

/**
 * Add a weekly slot to a block, up to four. It commits the other members to a
 * first occurrence, so that has to be far enough out for them to skip it free.
 */
export async function addBlockSlot(
  sql: Sql,
  userId: string,
  blockId: string,
  input: BlockSlotInput,
  now = Date.now(),
): Promise<TrainingBlockDTO> {
  const poster = await profileRow(sql, userId);
  const [venue] = await sql<Venue>`select * from venues where id = ${input.venueId}`;
  if (!venue) throw new PaceError(400, "Pick a venue in the cluster.");
  const startAt = new Date(input.startAt).getTime();
  if (!Number.isFinite(startAt)) throw new PaceError(400, "Start time isn’t valid.");

  await sql.transaction(async (tx) => {
    const [b] = await tx.query<BlockRow>(
      `select ${BLOCK_COLUMNS} from training_blocks tb where tb.id = $1 for update`,
      [blockId],
    );
    const members = (await membersOf(tx, blockId)).map((m) => m.profile_id);
    if (!b || !members.includes(userId)) throw new PaceError(404, "No training block.");
    if (b.created_by !== userId)
      throw new PaceError(403, "Only whoever started the block adds slots.");
    if (b.status !== "forming" && b.status !== "active") {
      throw new PaceError(409, "This training block has finished.");
    }
    const [{ n }] = await tx<{ n: number }>`
      select count(*) as n from series where training_block_id = ${blockId} and status = 'active'`;
    if (Number(n) >= BLOCK_MAX_SLOTS)
      throw new PaceError(409, "A block holds up to four slots a week.");

    const ability = validAbility(b.activity, input.ability);
    if (!ability.ok) throw new PaceError(400, ability.error);
    const verdict = canPost(
      {
        title: input.title,
        detail: input.detail,
        activity: b.activity,
        ability: input.ability,
        startAt,
        capacity: b.capacity,
        womenOnly: b.women_only,
        visibility: b.visibility,
      },
      { gender: poster.gender, frozenUntil: ms(poster.frozen_until) },
      now,
    );
    if (!verdict.ok) throw new PaceError(400, verdict.error);
    if (members.length > 1 && startAt < now + NEW_SLOT_LEAD_MS) {
      throw new PaceError(
        400,
        "Start a new slot at least two days out, so everyone can plan for it.",
      );
    }
    if (clusterDate(startAt) > b.goal_date) {
      throw new PaceError(400, "That’s after the goal date.");
    }

    await createSlot(tx, b, userId, members, input, startAt, now);
    const who = await firstName(tx, userId);
    for (const member of members.filter((m) => m !== userId)) {
      await enqueue(
        tx,
        {
          profileId: member,
          kind: "block_slot_added",
          category: "sessions",
          title: `${who} added a weekly slot`,
          body: `${input.title.trim()} · ${dayAndTime(startAt)}. You’re in — skip any week with 12 hours’ notice.`,
          url: `/training-block/${blockId}`,
        },
        now,
      );
    }
  });
  return toDTO(sql, await myBlockRow(sql, userId, blockId), userId, now);
}

/**
 * One weekly slot of a block: a standing slot, its first occurrence, and every
 * other member already confirmed on it — the way "same time next week" does it.
 */
async function createSlot(
  tx: Sql,
  b: Pick<BlockRow, "id" | "activity" | "capacity" | "visibility" | "join_mode" | "women_only">,
  hostId: string,
  members: string[],
  input: BlockSlotInput,
  startAt: number,
  now = Date.now(),
) {
  if (!(await validRegulars(tx, members)))
    throw new PaceError(409, "This group cannot book a new slot.");
  for (const member of members) {
    await assertMembershipEntitled(tx, member, now);
    await assertNoAssistantOverlap(tx, member, at(startAt), input.durationMin);
  }
  const seriesId = newId("ser");
  await tx`
    insert into series (id, created_by, training_block_id)
    values (${seriesId}, ${hostId}, ${b.id})`;
  for (const member of members) {
    await tx`insert into series_members (series_id, profile_id) values (${seriesId}, ${member})`;
  }
  const sessionId = newId("ses");
  await tx`
    insert into sessions (
      id, host_id, venue_id, activity, title, detail, ability, ability_flex, route_url, start_at,
      duration_min, capacity, visibility, join_mode, women_only, code, invite_code, series_id,
      training_block_id
    ) values (
      ${sessionId}, ${hostId}, ${input.venueId}, ${b.activity}, ${input.title.trim()},
      ${input.detail.trim()}, ${JSON.stringify(input.ability)}::jsonb, ${input.abilityFlex},
      ${input.routeUrl || null}, ${at(startAt)}, ${input.durationMin},
      ${Math.max(b.capacity, members.length)}, ${b.visibility}, ${b.join_mode}, ${b.women_only},
      ${fourDigits()}, ${b.visibility === "unlisted" ? inviteToken() : null}, ${seriesId}, ${b.id}
    )`;
  for (const member of members.filter((m) => m !== hostId)) {
    const bookingId = newId("bk");
    await tx`
      insert into bookings (id, session_id, participant_id, status)
      values (${bookingId}, ${sessionId}, ${member}, 'confirmed')`;
    await tx`
      insert into messages (id, booking_id, from_id, text)
      values (${newId("m")}, ${bookingId}, ${hostId},
        'Added a weekly slot to our training block. Skip any week with 12 hours’ notice.')`;
  }
}

export type PostBlockInput = BlockGoalInput & {
  activity: Activity;
  capacity: number;
  visibility: Visibility;
  joinMode: JoinMode;
  womenOnly: boolean;
  slots: BlockSlotInput[];
};

/**
 * Post a training block from scratch: a goal, a date and one to four weekly slots,
 * each with its first session on the calendar. It waits (`forming`) for a second
 * member; its sessions show in discovery like any other, and joining takes the block.
 */
export async function postTrainingBlock(
  sql: Sql,
  userId: string,
  input: PostBlockInput,
  now = Date.now(),
  clonedFrom: string | null = null,
): Promise<TrainingBlockDTO> {
  const poster = await profileRow(sql, userId);
  if (input.slots.length < 1 || input.slots.length > BLOCK_MAX_SLOTS) {
    throw new PaceError(400, "A block holds one to four slots a week.");
  }
  const starts: number[] = [];
  for (const slot of input.slots) {
    const [venue] = await sql<Venue>`select * from venues where id = ${slot.venueId}`;
    if (!venue) throw new PaceError(400, "Pick a venue in the cluster.");
    const startAt = new Date(slot.startAt).getTime();
    if (!Number.isFinite(startAt)) throw new PaceError(400, "Start time isn’t valid.");
    const verdict = canPost(
      {
        title: slot.title,
        detail: slot.detail,
        activity: input.activity,
        ability: slot.ability,
        startAt,
        capacity: input.capacity,
        womenOnly: input.womenOnly,
        visibility: input.visibility,
      },
      { gender: poster.gender, frozenUntil: ms(poster.frozen_until) },
      now,
    );
    if (!verdict.ok) throw new PaceError(400, verdict.error);
    if (startAt > now + BLOCK_FIRST_WEEK_DAYS * 24 * 60 * 60_000) {
      throw new PaceError(400, "Start each slot inside the next two weeks.");
    }
    if (clusterDate(startAt) > input.goalDate)
      throw new PaceError(400, "That’s after the goal date.");
    starts.push(startAt);
  }
  const startsOn = clusterDate(Math.min(...starts));
  await requireVerified(sql, userId, { visibility: input.visibility, womenOnly: input.womenOnly });
  const goal = validBlock({
    activity: input.activity,
    goalKind: input.goalKind,
    eventName: input.eventName,
    startsOn,
    goalDate: input.goalDate,
  });
  if (!goal.ok) throw new PaceError(400, goal.error);

  const id = newId("tb");
  await sql.transaction(async (tx) => {
    await tx`select id from profiles where id = ${userId} for no key update`;
    await requireVerified(tx, userId, { visibility: input.visibility, womenOnly: input.womenOnly });
    await tx`
      insert into training_blocks (
        id, created_by, activity, goal_kind, event_name, starts_on, goal_date, capacity,
        visibility, join_mode, women_only, invite_code, cloned_from, status
      ) values (
        ${id}, ${userId}, ${input.activity}, ${input.goalKind}, ${input.eventName?.trim() || null},
        ${startsOn}::date, ${input.goalDate}::date, ${input.capacity}, ${input.visibility},
        ${input.joinMode}, ${input.womenOnly},
        ${input.visibility === "unlisted" ? inviteToken() : null}, ${clonedFrom}, 'forming'
      )`;
    await tx`
      insert into training_block_members (block_id, profile_id, joined_at)
      values (${id}, ${userId}, ${at(now)})`;
    const b = {
      id,
      activity: input.activity,
      capacity: input.capacity,
      visibility: input.visibility,
      join_mode: input.joinMode,
      women_only: input.womenOnly,
    };
    for (const [i, slot] of input.slots.entries()) {
      await createSlot(tx, b, userId, [userId], slot, starts[i], now);
    }
  });
  return toDTO(sql, await myBlockRow(sql, userId, id), userId, now);
}

/**
 * Make someone a regular: a member of the block and of every slot in it, with a
 * seat on each slot's next session where one is free. The block stops `forming`
 * the moment it has two people.
 */
async function admit(tx: Sql, b: BlockRow, profileId: string, now: number) {
  await assertMembershipEntitled(tx, profileId, now);
  const regulars = (await membersOf(tx, b.id)).map((m) => m.profile_id);
  if (!(await validRegulars(tx, [...new Set([...regulars, profileId])])))
    throw new PaceError(409, "This group cannot add that member.");
  await tx`
    insert into training_block_members (block_id, profile_id, joined_at)
    values (${b.id}, ${profileId}, ${at(now)})
    on conflict (block_id, profile_id) do update
      set left_at = null, joined_at = excluded.joined_at, planned_count = null,
        kept_count = null, kept_miles = null, finished = null`;
  const series = await tx<{ id: string }>`
    select id from series where training_block_id = ${b.id} and status = 'active'`;
  for (const se of series) {
    await tx`
      insert into series_members (series_id, profile_id, joined_at)
      values (${se.id}, ${profileId}, ${at(now)})
      on conflict (series_id, profile_id) do update set left_at = null`;
    const [next] = await tx<SessionRow>`
      select * from sessions where series_id = ${se.id} and status = 'open' and start_at > ${at(now)}
      order by start_at limit 1 for update`;
    if (!next || next.host_id === profileId) continue;
    const seated = await tx<{ participant_id: string }>`
      select participant_id from bookings where session_id = ${next.id}
        and status in ('pending', 'confirmed', 'completed')`;
    // Already holding a seat as a substitute, or a substitute has this week's last
    // one: they start the week after.
    if (seated.some((x) => x.participant_id === profileId)) continue;
    if (seated.length >= next.capacity - 1) continue;
    await assertNoAssistantOverlap(
      tx,
      profileId,
      at(ms(next.start_at)!),
      next.duration_min,
      next.id,
    );
    const bookingId = newId("bk");
    await tx`
      insert into bookings (id, session_id, participant_id, status)
      values (${bookingId}, ${next.id}, ${profileId}, 'confirmed')`;
    await tx`
      insert into messages (id, booking_id, from_id, text)
      values (${newId("m")}, ${bookingId}, ${next.host_id},
        'Welcome to the block. The exact pin is on the session. See you there.')`;
  }
  await tx`update training_blocks set status = 'active' where id = ${b.id} and status = 'forming'`;

  const who = await firstName(tx, profileId);
  const label = goalLabel(
    b.goal_kind,
    b.event_name,
    Math.max(series.length, 1),
    blockWeeks(b.starts_on, b.goal_date),
  );
  for (const m of await membersOf(tx, b.id)) {
    if (m.profile_id === profileId) continue;
    await enqueue(
      tx,
      {
        profileId: m.profile_id,
        kind: "block_joined",
        category: "sessions",
        title: `${who} joined your training block`,
        body: `${label}. They’re in every week from here.`,
        url: `/training-block/${b.id}`,
      },
      now,
    );
  }
}

async function lockBlock(tx: Sql, blockId: string): Promise<BlockRow | undefined> {
  const [b] = await tx.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from training_blocks tb where tb.id = $1 for update`,
    [blockId],
  );
  return b;
}

/**
 * Join a block — every slot in it, every week until the goal date. It is asked
 * for here and nowhere else: tapping a single session never commits anyone to
 * sixteen weeks. When members approve each person, this files the request.
 */
export async function joinTrainingBlock(
  sql: Sql,
  userId: string,
  blockId: string,
  opts: { inviteCode?: string } = {},
  now = Date.now(),
): Promise<TrainingBlockDTO> {
  // Same gate as looking at it: unlisted without the link, blocked, or not open
  // to this member all read as "not there".
  await visibleBlockRow(sql, userId, blockId, opts.inviteCode);
  const me = await profileRow(sql, userId);
  await sql.transaction(async (tx) => {
    const b = await lockBlock(tx, blockId);
    if (!b) throw new PaceError(404, "No training block.");
    const members = (await membersOf(tx, blockId)).map((m) => m.profile_id);
    const verdict = canJoinBlock(
      factsOf(b),
      { gender: me.gender, frozenUntil: ms(me.frozen_until) },
      { members: members.length, isMember: members.includes(userId) },
      now,
    );
    if (!verdict.ok) throw new PaceError(409, verdict.error);
    await requireVerified(tx, userId, { visibility: b.visibility, womenOnly: b.women_only });
    await assertMembershipEntitled(tx, userId, now);
    if (b.join_mode === "instant") return admit(tx, b, userId, now);

    const [asked] = await tx<{ status: string }>`
      select status from training_block_requests
      where block_id = ${blockId} and profile_id = ${userId} for update`;
    if (asked?.status === "pending") throw new PaceError(409, "You’ve already asked.");
    if (asked?.status === "declined") throw new PaceError(409, "This one isn’t open to you.");
    await tx`
      insert into training_block_requests (block_id, profile_id, created_at)
      values (${blockId}, ${userId}, ${at(now)})
      on conflict (block_id, profile_id) do update
        set status = 'pending', created_at = excluded.created_at, resolved_by = null,
          resolved_at = null`;
    const who = await firstName(tx, userId);
    for (const member of members) {
      await enqueue(
        tx,
        {
          profileId: member,
          kind: "block_join_request",
          category: "sessions",
          title: `${who} asked to join your training block`,
          body: "Any of you can approve or pass.",
          url: `/training-block/${blockId}`,
        },
        now,
      );
    }
  });
  return toDTO(sql, await visibleBlockRow(sql, userId, blockId, opts.inviteCode), userId, now);
}

/** Any member answers a request to join. Approving re-checks the seat and the date. */
export async function resolveBlockRequest(
  sql: Sql,
  userId: string,
  blockId: string,
  profileId: string,
  action: "approve" | "decline",
  now = Date.now(),
): Promise<TrainingBlockDTO> {
  await sql.transaction(async (tx) => {
    const b = await lockBlock(tx, blockId);
    const members = (await membersOf(tx, blockId)).map((m) => m.profile_id);
    if (!b || !members.includes(userId)) throw new PaceError(404, "No training block.");
    const [asked] = await tx<{ status: string }>`
      select status from training_block_requests
      where block_id = ${blockId} and profile_id = ${profileId} for update`;
    if (asked?.status !== "pending") throw new PaceError(409, "No request to answer.");

    if (action === "approve") {
      const them = await profileRow(tx, profileId);
      const verdict = canJoinBlock(
        factsOf(b),
        { gender: them.gender, frozenUntil: ms(them.frozen_until) },
        { members: members.length, isMember: false },
        now,
      );
      if (!verdict.ok) throw new PaceError(409, verdict.error);
      if (await blockedBetween(tx, profileId, members)) {
        throw new PaceError(409, "That request can’t be approved.");
      }
      await admit(tx, b, profileId, now);
      await enqueue(
        tx,
        {
          profileId,
          kind: "block_request_approved",
          category: "sessions",
          title: "You’re in the training block",
          body: "You have a seat every week until the goal date. Skip any week with 12 hours’ notice.",
          url: `/training-block/${blockId}`,
        },
        now,
      );
    }
    await tx`
      update training_block_requests
      set status = ${action === "approve" ? "approved" : "declined"}, resolved_by = ${userId},
        resolved_at = ${at(now)}
      where block_id = ${blockId} and profile_id = ${profileId}`;
  });
  return toDTO(sql, await myBlockRow(sql, userId, blockId), userId, now);
}

/**
 * "Start one like it": a block that is full (or too far along to join) becomes a
 * new forming block for the next group — same goal, same date, same weekly slots,
 * starting next week. While the original still has a seat, join that instead.
 */
export async function cloneTrainingBlock(
  sql: Sql,
  userId: string,
  blockId: string,
  opts: { inviteCode?: string } = {},
  now = Date.now(),
): Promise<TrainingBlockDTO> {
  const source = await visibleBlockRow(sql, userId, blockId, opts.inviteCode);
  const members = await membersOf(sql, blockId);
  if (
    !members.some((m) => m.profile_id === userId) &&
    blockJoinable(factsOf(source), members.length, clusterDate(now))
  ) {
    throw new PaceError(409, "There’s still a seat in this one — join it instead.");
  }
  const latest = await sql<SessionRow>`
    select distinct on (s.series_id) s.* from sessions s
    join series se on se.id = s.series_id
    where se.training_block_id = ${blockId}
    order by s.series_id, s.start_at desc`;
  if (latest.length === 0) throw new PaceError(409, "There’s nothing to copy.");
  const slots: BlockSlotInput[] = latest.slice(0, BLOCK_MAX_SLOTS).map((row) => {
    let startAt = nextOccurrence(ms(row.start_at)!);
    while (startAt < now + MIN_LEAD_TIME_MS) startAt = nextOccurrence(startAt);
    return {
      venueId: row.venue_id,
      title: row.title,
      detail: row.detail,
      ability: json<Ability>(row.ability),
      abilityFlex: row.ability_flex,
      routeUrl: row.route_url,
      startAt: new Date(startAt).toISOString(),
      durationMin: row.duration_min,
    };
  });
  return postTrainingBlock(
    sql,
    userId,
    {
      activity: source.activity,
      goalKind: source.goal_kind,
      eventName: source.event_name,
      goalDate: source.goal_date,
      capacity: source.capacity,
      visibility: source.visibility,
      joinMode: source.join_mode,
      womenOnly: source.women_only,
      slots,
    },
    now,
    blockId,
  );
}

/** Leave every slot in the block. Upcoming seats go on the usual standing-slot terms. */
export async function leaveTrainingBlock(
  sql: Sql,
  userId: string,
  blockId: string,
  now = Date.now(),
): Promise<void> {
  await sql.transaction(async (tx) => {
    await myBlockRow(tx, userId, blockId);
    const [slot] = await tx<{ id: string }>`
      select se.id from series se
      join series_members sm on sm.series_id = se.id and sm.profile_id = ${userId}
        and sm.left_at is null
      where se.training_block_id = ${blockId} limit 1`;
    // Leaving one of a block's slots leaves them all, and the block with them.
    if (slot) return leaveSeries(tx, userId, slot.id, now);
    await tx`
      update training_block_members set left_at = ${at(now)}
      where block_id = ${blockId} and profile_id = ${userId} and left_at is null`;
  });
}

/**
 * Close every block whose goal date has passed: write each member's numbers down
 * once, and mark who finished. Idempotent; runs on read and from the scheduler.
 * A block waits for its last session to settle, so a late check-in still counts.
 */
export async function closeDueBlocks(sql: Sql, now = Date.now()): Promise<number> {
  const due = await sql<{ id: string }>`
    select tb.id from training_blocks tb
    where tb.status = 'active' and tb.goal_date < ${clusterDate(now)}::date
      and not exists (
        select 1 from bookings b
        join sessions s on s.id = b.session_id
        where s.training_block_id = tb.id and b.status in ('pending', 'confirmed')
          and s.start_at <= ${at(now)})`;
  for (const { id } of due) {
    await sql.transaction(async (tx) => {
      const [b] = await tx<{ status: string }>`
        select status from training_blocks where id = ${id} for update`;
      if (b?.status !== "active") return;
      const rows = await occurrencesOf(tx, id);
      for (const m of await membersOf(tx, id)) {
        const p = plannedAndKept(
          sideOf(rows, { id: m.profile_id, joinedAt: ms(m.joined_at)!, leftAt: null }),
          now,
        );
        const finished = blockFinished(p);
        await tx`
          update training_block_members
          set planned_count = ${p.planned}, kept_count = ${p.kept}, kept_miles = ${p.keptMiles},
            finished = ${finished}
          where block_id = ${id} and profile_id = ${m.profile_id}`;
        if (finished) {
          await tx`
            update profiles set blocks_finished = blocks_finished + 1 where id = ${m.profile_id}`;
        }
      }
      await tx`update training_blocks set status = 'closing' where id = ${id}`;
    });
  }

  // The week for goal credits runs out: the block is over.
  await sql`
    update training_blocks set status = 'ended', ended_reason = 'goal_date'
    where status = 'closing'
      and goal_date + ${CREDIT_WINDOW_DAYS}::int < ${clusterDate(now)}::date`;
  // Slots nobody chose to keep end with it. They stopped at the goal date, so
  // there is nothing on the calendar to call off.
  await sql`
    update series se set status = 'ended'
    from training_blocks tb
    where tb.id = se.training_block_id and se.status = 'active'
      and tb.status in ('closing', 'ended')
      and tb.goal_date + ${KEEP_SLOTS_DAYS}::int < ${clusterDate(now)}::date`;

  // A posted block nobody joined within two weeks is called off, with its sessions.
  const stale = await sql<{ id: string; created_by: string }>`
    select tb.id, tb.created_by from training_blocks tb
    where tb.status = 'forming'
      and tb.starts_on + ${FORMING_GRACE_DAYS}::int < ${clusterDate(now)}::date`;
  for (const { id, created_by } of stale) {
    await sql.transaction(async (tx) => {
      const b = await lockBlock(tx, id);
      if (b?.status !== "forming") return;
      const [slot] = await tx<{ id: string }>`
        select id from series where training_block_id = ${id} and status = 'active' limit 1`;
      // Leaving a block's slot ends a block with fewer than two members.
      if (slot) await leaveSeries(tx, created_by, slot.id, now);
      await tx`
        update training_blocks set status = 'ended', ended_reason = 'too_few'
        where id = ${id} and status = 'forming'`;
      await enqueue(
        tx,
        {
          profileId: created_by,
          kind: "block_ended",
          category: "sessions",
          title: "Your training block didn’t fill",
          body: "Nobody joined in the first two weeks, so it’s been called off. Post it again any time.",
          url: "/sessions",
        },
        now,
      );
    });
  }
  return due.length;
}

// ── The end of a block ───────────────────────────────────────────────────────

/**
 * "Helped me stick to it?" A finisher answers once, in the week after the goal
 * date, with the buddies it's true of — possibly none. The receiver's profile
 * counts distinct people, so a pair repeating blocks adds one, not one per block.
 * Nobody is told who said it.
 */
export async function giveCredits(
  sql: Sql,
  userId: string,
  blockId: string,
  toIds: string[],
  now = Date.now(),
): Promise<TrainingBlockDTO> {
  await closeDueBlocks(sql, now);
  await sql.transaction(async (tx) => {
    const b = await lockBlock(tx, blockId);
    const me = (await membersOf(tx, blockId)).find((m) => m.profile_id === userId);
    if (!b || !me) throw new PaceError(404, "No training block.");
    const verdict = canGiveCredits(
      { status: b.status, goalDate: b.goal_date },
      { finished: me.finished, answered: Boolean(me.credits_answered_at) },
      clusterDate(now),
    );
    if (!verdict.ok) throw new PaceError(409, verdict.error);
    const eligible = new Set(await creditableFor(tx, blockId, userId));
    const wanted = [...new Set(toIds)];
    if (wanted.some((id) => !eligible.has(id))) {
      throw new PaceError(409, "That’s someone you didn’t share enough sessions with.");
    }

    const label = goalLabel(b.goal_kind, b.event_name, 1, blockWeeks(b.starts_on, b.goal_date));
    for (const toId of wanted) {
      const [before] = await tx`
        select 1 from goal_credits where from_id = ${userId} and to_id = ${toId} limit 1`;
      await tx`
        insert into goal_credits (id, block_id, from_id, to_id, created_at)
        values (${newId("gc")}, ${blockId}, ${userId}, ${toId}, ${at(now)})
        on conflict (block_id, from_id, to_id) do nothing`;
      if (before) continue;
      await tx`update profiles set helped_count = helped_count + 1 where id = ${toId}`;
      await enqueue(
        tx,
        {
          profileId: toId,
          kind: "goal_credit",
          category: "sessions",
          title: "You helped someone finish",
          body:
            b.goal_kind === "consistency"
              ? "Someone you trained with says you helped them stick to their block."
              : `Someone you trained with for ${label} says you helped them stick to it.`,
          url: "/you",
        },
        now,
      );
    }
    await tx`
      update training_block_members set credits_answered_at = ${at(now)}
      where block_id = ${blockId} and profile_id = ${userId}`;
  });
  return toDTO(sql, await myBlockRow(sql, userId, blockId), userId, now);
}

/**
 * Take back what one member said about another — when the giver blocks them, or a
 * report the giver made about them is acted on. The count drops; nobody is told.
 */
export async function withdrawCredits(tx: Sql, fromId: string, toId: string) {
  const gone = await tx`
    delete from goal_credits where from_id = ${fromId} and to_id = ${toId} returning id`;
  if (gone.length === 0) return;
  await tx`
    update profiles set helped_count = (
      select count(distinct from_id) from goal_credits where to_id = ${toId})
    where id = ${toId}`;
}

/** The slots of a finished block that nobody has decided about yet. */
async function undecidedSlots(
  tx: Sql,
  b: BlockRow,
  userId: string,
  now: number,
): Promise<string[]> {
  const mine = (await membersOf(tx, b.id)).some((m) => m.profile_id === userId);
  if (!mine) throw new PaceError(404, "No training block.");
  if (!past(b)) throw new PaceError(409, "This block is still running.");
  const slots = await tx<{ id: string }>`
    select id from series where training_block_id = ${b.id} and status = 'active'
    order by created_at, id for update`;
  if (slots.length === 0 || !slotsUndecided(b.goal_date, clusterDate(now))) {
    throw new PaceError(409, "Those slots have already wound up.");
  }
  return slots.map((x) => x.id);
}

/**
 * "Keep the slots running": the block is over, the habit isn't. Its slots go back
 * to being plain standing slots — same people, same time, next week on the
 * calendar — until someone leaves them. Any member's call, for two weeks.
 */
export async function keepBlockSlots(
  sql: Sql,
  userId: string,
  blockId: string,
  now = Date.now(),
): Promise<void> {
  await closeDueBlocks(sql, now);
  await sql.transaction(async (tx) => {
    const b = await lockBlock(tx, blockId);
    if (!b) throw new PaceError(404, "No training block.");
    const slots = await undecidedSlots(tx, b, userId, now);
    await tx.query("update series set training_block_id = null where id = any($1)", [slots]);
    for (const id of slots) await repeatSeries(tx, id, now);
    await tellTheOthers(tx, b, userId, now, {
      kind: "block_slots_kept",
      title: "Your weekly slots are staying",
      body: "The block is done; the sessions carry on, same time next week. Leave any slot you’re finished with.",
      url: "/",
    });
  });
}

/**
 * "Start the next block": the same people and the same weekly slots, aimed at a
 * new goal and date. The streaks carry over with the slots.
 */
export async function nextTrainingBlock(
  sql: Sql,
  userId: string,
  blockId: string,
  input: BlockGoalInput,
  now = Date.now(),
): Promise<TrainingBlockDTO> {
  await closeDueBlocks(sql, now);
  const nextId = await sql.transaction(async (tx) => {
    const b = await lockBlock(tx, blockId);
    if (!b) throw new PaceError(404, "No training block.");
    const slots = await undecidedSlots(tx, b, userId, now);
    await tx.query("update series set training_block_id = null where id = any($1)", [slots]);
    const id = await blockFromSlots(tx, userId, slots, input, now);
    for (const seriesId of slots) await repeatSeries(tx, seriesId, now);
    await tellTheOthers(tx, b, userId, now, {
      kind: "block_next",
      title: "Your next training block is on",
      body: "Same people, same weekly slots, a new date. You’re in — leave it if this one isn’t for you.",
      url: `/training-block/${id}`,
    });
    return id;
  });
  return toDTO(sql, await myBlockRow(sql, userId, nextId), userId, now);
}

async function tellTheOthers(
  tx: Sql,
  b: BlockRow,
  userId: string,
  now: number,
  n: { kind: string; title: string; body: string; url: string },
) {
  for (const m of await membersOf(tx, b.id)) {
    if (m.profile_id === userId) continue;
    await enqueue(tx, { profileId: m.profile_id, category: "sessions", ...n }, now);
  }
}
