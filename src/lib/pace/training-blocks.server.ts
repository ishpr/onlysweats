/**
 * Training blocks (server-only, PRD v0.3 §6): one to four standing slots tied to a
 * goal and a date. A block adds no session mechanics of its own — its weekly slots
 * are ordinary standing slots, and its progress is read off the check-ins they
 * already record. Nothing here is logged by a member, and no body metric exists.
 */
import type { Sql } from "../db.ts";
import {
  abilityLabel,
  blockFinished,
  blockWeek,
  blockWeeks,
  BLOCK_MAX_SLOTS,
  canPost,
  clusterDate,
  goalLabel,
  NEW_SLOT_LEAD_MS,
  plannedAndKept,
  validAbility,
  validBlock,
  type Occurrence,
} from "./rules.ts";
import {
  at,
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
  type SessionRow,
} from "./service.server.ts";
import type {
  Ability,
  Activity,
  GoalKind,
  JoinMode,
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
  status: TrainingBlockStatus;
};

const BLOCK_COLUMNS = `
  tb.id, tb.created_by, tb.activity, tb.goal_kind, tb.event_name,
  tb.starts_on::text as starts_on, tb.goal_date::text as goal_date,
  tb.capacity, tb.visibility, tb.join_mode, tb.women_only, tb.status`;

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
  status: TrainingBlockStatus;
  memberIds: string[];
  slots: BlockSlotDTO[];
  /** Mine alone — nobody sees another member's count. */
  my: Progress & { finished: boolean | null };
  /** Everyone's sessions added up. */
  group: { planned: number; kept: number };
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
    from sessions s join series se on se.id = s.series_id
    where se.training_block_id = ${blockId}
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
};

const membersOf = (sql: Sql, blockId: string) => sql<MemberRow>`
  select profile_id, joined_at, left_at, planned_count, kept_count, kept_miles, finished
  from training_block_members where block_id = ${blockId} and left_at is null
  order by joined_at, profile_id`;

// ── Reads ────────────────────────────────────────────────────────────────────

async function toDTO(sql: Sql, b: BlockRow, viewer: string, now: number): Promise<TrainingBlockDTO> {
  const members = await membersOf(sql, b.id);
  const rows = await occurrencesOf(sql, b.id);
  let mine: TrainingBlockDTO["my"] = { planned: 0, kept: 0, keptMiles: 0, finished: null };
  const group = { planned: 0, kept: 0 };
  for (const m of members) {
    // Once the block has closed, the snapshot is the record.
    const p: Progress =
      m.planned_count === null
        ? plannedAndKept(
            sideOf(rows, { id: m.profile_id, joinedAt: ms(m.joined_at)!, leftAt: ms(m.left_at) }),
            now,
          )
        : { planned: m.planned_count, kept: m.kept_count ?? 0, keptMiles: Number(m.kept_miles ?? 0) };
    group.planned += p.planned;
    group.kept += p.kept;
    if (m.profile_id === viewer) mine = { ...p, finished: m.finished };
  }

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
    slots.push({
      seriesId: se.id,
      title: last.title,
      abilityLabel: abilityLabel(json<Ability>(last.ability)),
      venueId: last.venue_id,
      streak: se.streak,
      nextSessionId: next?.id ?? null,
      nextStartAt: next ? iso(next.start_at) : null,
    });
  }

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
    status: b.status,
    memberIds: members.map((m) => m.profile_id),
    slots,
    my: mine,
    group,
  };
}

/** A block is its members' business: anyone else gets a 404. */
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

export async function getTrainingBlock(
  sql: Sql,
  userId: string,
  blockId: string,
  now = Date.now(),
): Promise<{ block: TrainingBlockDTO; people: Person[] }> {
  await closeDueBlocks(sql, now);
  const block = await toDTO(sql, await myBlockRow(sql, userId, blockId), userId, now);
  return { block, people: await people(sql, block.memberIds) };
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
        or (tb.status = 'closing' and tb.goal_date >= $2::date - $3::int)
     order by tb.goal_date, tb.id`,
    [userId, clusterDate(now), SHOW_CLOSED_DAYS],
  );
  const out: TrainingBlockDTO[] = [];
  for (const b of rows) out.push(await toDTO(sql, b, userId, now));
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
  const blockId = await sql.transaction(async (tx) => {
    const [series] = await tx<{ status: string; training_block_id: string | null }>`
      select status, training_block_id from series where id = ${seriesId} for update`;
    const members = (
      await tx<{ profile_id: string }>`
        select profile_id from series_members where series_id = ${seriesId} and left_at is null
        order by joined_at, profile_id`
    ).map((m) => m.profile_id);
    if (!series || !members.includes(userId)) throw new PaceError(404, "Not your standing slot.");
    if (series.status !== "active" || members.length < 2) {
      throw new PaceError(409, "That standing slot has ended.");
    }
    if (series.training_block_id) {
      throw new PaceError(409, "This slot is already part of a training block.");
    }
    const [last] = await tx<SessionRow>`
      select * from sessions where series_id = ${seriesId} order by start_at desc limit 1`;
    if (!last) throw new PaceError(409, "That standing slot has ended.");

    const startsOn = clusterDate(now);
    const verdict = validBlock({
      activity: last.activity,
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
        ${id}, ${userId}, ${last.activity}, ${input.goalKind}, ${input.eventName?.trim() || null},
        ${startsOn}::date, ${input.goalDate}::date, ${Math.max(last.capacity, members.length)},
        ${last.visibility}, ${last.join_mode}, ${last.women_only},
        ${last.visibility === "unlisted" ? inviteToken() : null}, 'active'
      )`;
    for (const member of members) {
      await tx`
        insert into training_block_members (block_id, profile_id, joined_at)
        values (${id}, ${member}, ${at(now)})`;
    }
    await tx`update series set training_block_id = ${id} where id = ${seriesId}`;
    return id;
  });
  return toDTO(sql, await myBlockRow(sql, userId, blockId), userId, now);
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
    if (b.created_by !== userId) throw new PaceError(403, "Only whoever started the block adds slots.");
    if (b.status !== "forming" && b.status !== "active") {
      throw new PaceError(409, "This training block has finished.");
    }
    const [{ n }] = await tx<{ n: number }>`
      select count(*) as n from series where training_block_id = ${blockId} and status = 'active'`;
    if (Number(n) >= BLOCK_MAX_SLOTS) throw new PaceError(409, "A block holds up to four slots a week.");

    const ability = validAbility(b.activity, input.ability);
    if (!ability.ok) throw new PaceError(400, ability.error);
    const verdict = canPost(
      {
        title: input.title,
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
      throw new PaceError(400, "Start a new slot at least two days out, so everyone can plan for it.");
    }
    if (clusterDate(startAt) > b.goal_date) {
      throw new PaceError(400, "That’s after the goal date.");
    }

    const seriesId = newId("ser");
    await tx`
      insert into series (id, created_by, training_block_id)
      values (${seriesId}, ${userId}, ${blockId})`;
    for (const member of members) {
      await tx`insert into series_members (series_id, profile_id) values (${seriesId}, ${member})`;
    }
    const sessionId = newId("ses");
    await tx`
      insert into sessions (
        id, host_id, venue_id, activity, title, detail, ability, ability_flex, route_url, start_at,
        duration_min, capacity, visibility, join_mode, women_only, code, invite_code, series_id
      ) values (
        ${sessionId}, ${userId}, ${input.venueId}, ${b.activity}, ${input.title.trim()},
        ${input.detail.trim()}, ${JSON.stringify(input.ability)}::jsonb, ${input.abilityFlex},
        ${input.routeUrl || null}, ${at(startAt)}, ${input.durationMin},
        ${Math.max(b.capacity, members.length)}, ${b.visibility}, ${b.join_mode}, ${b.women_only},
        ${fourDigits()}, ${b.visibility === "unlisted" ? inviteToken() : null}, ${seriesId}
      )`;
    for (const member of members.filter((m) => m !== userId)) {
      const bookingId = newId("bk");
      await tx`
        insert into bookings (id, session_id, participant_id, status)
        values (${bookingId}, ${sessionId}, ${member}, 'confirmed')`;
      await tx`
        insert into messages (id, booking_id, from_id, text)
        values (${newId("m")}, ${bookingId}, ${userId},
          'Added a weekly slot to our training block. Skip any week with 12 hours’ notice.')`;
    }
  });
  return toDTO(sql, await myBlockRow(sql, userId, blockId), userId, now);
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
        join series se on se.id = s.series_id
        where se.training_block_id = tb.id and b.status in ('pending', 'confirmed')
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
  return due.length;
}
