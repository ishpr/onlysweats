/**
 * Safety and account lifecycle (server-only): block, report, delete my account,
 * and the admin queue that acts on reports. Same contract as the service layer —
 * callers pass a verified user id, every state change is one transaction.
 */
import type { Sql } from "../db.ts";
import {
  emailHash,
  newId,
  PaceError,
  people,
  severTies,
  withdrawEverything,
} from "./service.server.ts";
import { withdrawCredits } from "./training-blocks.server.ts";
import { enqueue } from "./notify.server.ts";
import { blockWeeks, goalLabel } from "./rules.ts";
import type { GoalKind, Person } from "./types.ts";

export const REPORT_REASONS = [
  "date_framing",
  "harassment",
  "unsafe",
  "misrepresented",
  "fake_or_spam",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const REPORTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (n: number) => new Date(n).toISOString();
const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());

async function mustExist(sql: Sql, id: string) {
  const [row] = await sql<{ id: string }>`
    select id from profiles where id = ${id} and deleted_at is null`;
  if (!row) throw new PaceError(404, "No such member.");
}

// ── Block ────────────────────────────────────────────────────────────────────

export async function blockMember(sql: Sql, userId: string, targetId: string, now = Date.now()) {
  if (targetId === userId) throw new PaceError(400, "That’s you.");
  await mustExist(sql, targetId);
  await sql.transaction(async (tx) => {
    await tx`
      insert into blocks (blocker_id, blocked_id, created_at)
      values (${userId}, ${targetId}, ${at(now)})
      on conflict (blocker_id, blocked_id) do nothing`;
    await severTies(tx, userId, targetId, now);
    // "Helped me stick to it" doesn't survive blocking them. Nobody is told.
    await withdrawCredits(tx, userId, targetId);
  });
}

export async function unblockMember(sql: Sql, userId: string, targetId: string) {
  await sql`delete from blocks where blocker_id = ${userId} and blocked_id = ${targetId}`;
}

export async function listBlocks(sql: Sql, userId: string): Promise<Person[]> {
  const rows = await sql<{ blocked_id: string }>`
    select blocked_id from blocks where blocker_id = ${userId} order by created_at desc`;
  const found = await people(
    sql,
    rows.map((r) => r.blocked_id),
  );
  const byId = new Map(found.map((p) => [p.id, p]));
  return rows.map((r) => byId.get(r.blocked_id)).filter((p): p is Person => Boolean(p));
}

// ── Report ───────────────────────────────────────────────────────────────────

export type ReportInput = {
  reportedId: string;
  reason: ReportReason;
  detail?: string;
  /** Where it happened. One of the two is required — members only meet through sessions. */
  sessionId?: string;
  bookingId?: string;
  alsoBlock?: boolean;
};

/** Who is on a session: the poster plus anyone who ever held a seat. */
async function onSession(sql: Sql, sessionId: string): Promise<Set<string> | null> {
  const [s] = await sql<{ host_id: string }>`select host_id from sessions where id = ${sessionId}`;
  if (!s) return null;
  const seats = await sql<{ participant_id: string }>`
    select participant_id from bookings where session_id = ${sessionId}`;
  return new Set([s.host_id, ...seats.map((b) => b.participant_id)]);
}

export async function reportMember(
  sql: Sql,
  userId: string,
  input: ReportInput,
  now = Date.now(),
): Promise<{ id: string; blocked: boolean }> {
  if (input.reportedId === userId) throw new PaceError(400, "That’s you.");
  await mustExist(sql, input.reportedId);

  let sessionId = input.sessionId ?? null;
  if (input.bookingId) {
    const [b] = await sql<{ session_id: string }>`
      select session_id from bookings where id = ${input.bookingId}`;
    if (!b) throw new PaceError(404, "No booking.");
    sessionId = b.session_id;
  }
  if (!sessionId) throw new PaceError(400, "Say which session this is about.");
  const members = await onSession(sql, sessionId);
  if (!members) throw new PaceError(404, "Session not found.");
  const [host] = await sql<{ host_id: string; visibility: string }>`
    select host_id, visibility from sessions where id = ${sessionId}`;
  // Anyone can report the poster of a listing they can see; reporting someone
  // else on a session takes being on it too.
  const aboutPublicPoster = input.reportedId === host.host_id && host.visibility === "public";
  if (!members.has(input.reportedId) || (!aboutPublicPoster && !members.has(userId))) {
    throw new PaceError(404, "Session not found.");
  }

  const id = await sql.transaction(async (tx) => {
    const [dupe] = await tx<{ id: string }>`
      select id from reports where reporter_id = ${userId} and reported_id = ${input.reportedId}
        and session_id = ${sessionId} and status = 'open' limit 1`;
    if (dupe) return dupe.id;
    const [{ n }] = await tx<{ n: number }>`
      select count(*) as n from reports
      where reporter_id = ${userId} and created_at > ${at(now - DAY_MS)}`;
    if (Number(n) >= REPORTS_PER_DAY) {
      throw new PaceError(409, "That’s the limit for one day. Email support@samepace.app and we’ll pick it up.");
    }
    const reportId = newId("rep");
    await tx`
      insert into reports (id, reporter_id, reported_id, session_id, booking_id, reason, detail, created_at)
      values (${reportId}, ${userId}, ${input.reportedId}, ${sessionId}, ${input.bookingId ?? null},
        ${input.reason}, ${(input.detail ?? "").trim().slice(0, 2000)}, ${at(now)})`;
    // Reports are read by a person within a day — tell the people who read them.
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (admins.length > 0) {
      const rows = await tx.query<{ id: string }>(
        `select p.id from profiles p join "user" u on u.id = p.id
         where lower(u.email) = any($1) and u."emailVerified" and p.deleted_at is null`,
        [admins],
      );
      for (const a of rows) {
        await enqueue(
          tx,
          {
            profileId: a.id,
            kind: "admin_report",
            category: "account",
            title: "New report in the safety queue",
            body: `Reason: ${input.reason.replace(/_/g, " ")}. Open the admin page to review it.`,
            dedupeKey: `report:${reportId}:${a.id}`,
          },
          now,
        );
      }
    }
    return reportId;
  });
  if (input.alsoBlock) await blockMember(sql, userId, input.reportedId, now);
  return { id, blocked: Boolean(input.alsoBlock) };
}

// ── Delete my account ────────────────────────────────────────────────────────

/**
 * Deletes the sign-in identity and scrubs the profile. The profile row stays as
 * "Deleted member" so the other person's history, ratings, fees and any safety
 * report still make sense; everything that described the person is gone.
 */
export async function deleteAccount(sql: Sql, userId: string, now = Date.now()) {
  await sql.transaction(async (tx) => {
    const [me] = await tx<{ suspended_at: Date | null; suspended_reason: string | null }>`
      select suspended_at, suspended_reason from profiles where id = ${userId} for update`;
    if (!me) throw new PaceError(404, "No profile.");
    await withdrawEverything(tx, userId, now);

    // Deleting doesn't undo a suspension.
    if (me.suspended_at) {
      const [u] = await tx<{ email: string }>`select email from "user" where id = ${userId}`;
      if (u?.email) {
        await tx`
          insert into banned_identities (email_hash, reason)
          values (${await emailHash(u.email)}, ${me.suspended_reason ?? ""})
          on conflict (email_hash) do nothing`;
      }
    }

    // Messages go, except in threads a report points at — those stay for review.
    await tx`
      delete from messages where from_id = ${userId} and booking_id not in (
        select booking_id from reports where booking_id is not null)`;
    await tx`delete from blocks where blocker_id = ${userId}`;
    await tx`delete from push_devices where profile_id = ${userId}`;
    await tx`delete from notifications where profile_id = ${userId}`;
    await tx`
      update profiles set
        name = 'Deleted member', handle = ${`deleted${newId("x").slice(2, 14)}`}, initials = '–',
        neighborhood = '', gender = null, abilities = '{}'::jsonb, credit_cents = 0,
        deleted_at = ${at(now)}
      where id = ${userId}`;
    // Cascades to the auth sessions and linked Apple / Google identities.
    await tx`delete from "user" where id = ${userId}`;
  });
}

// ── Admin ────────────────────────────────────────────────────────────────────

export type AdminUser = { email: string | null; emailVerified?: boolean | null };

/**
 * Admins are the emails in `ADMIN_EMAILS`. In production the email must be one
 * the identity provider verified — an unverified password sign-up never counts.
 */
export function isAdmin(user: AdminUser, env: Record<string, string | undefined> = process.env) {
  const allowed = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = user.email?.trim().toLowerCase();
  if (!email || !allowed.includes(email)) return false;
  const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  return production ? user.emailVerified === true : true;
}

async function audit(
  tx: Sql,
  adminEmail: string,
  action: string,
  ref: {
    profileId?: string;
    sessionId?: string;
    reportId?: string;
    trainingBlockId?: string;
    note?: string;
  },
) {
  await tx`
    insert into admin_actions (
      id, admin_email, action, profile_id, session_id, report_id, training_block_id, note
    ) values (${newId("adm")}, ${adminEmail}, ${action}, ${ref.profileId ?? null},
      ${ref.sessionId ?? null}, ${ref.reportId ?? null}, ${ref.trainingBlockId ?? null},
      ${ref.note ?? ""})`;
}

export async function adminOverview(sql: Sql) {
  const [row] = await sql<Record<string, number>>`
    select
      (select count(*) from profiles where deleted_at is null) as members,
      (select count(*) from profiles where suspended_at is not null and deleted_at is null) as suspended,
      (select count(*) from sessions where status = 'open' and start_at > now()) as upcoming_sessions,
      (select count(*) from training_blocks where status in ('forming', 'active')) as training_blocks,
      (select count(*) from bookings where status = 'completed') as completed_seats,
      (select count(*) from bookings where status in ('no_show', 'host_no_show')) as no_shows,
      (select count(*) from reports where status = 'open') as open_reports,
      (select coalesce(sum(amount_cents), 0) from ledger_events
        where status = 'assessed' and kind <> 'show_up_credit') as fees_assessed_cents`;
  return {
    members: Number(row.members),
    suspended: Number(row.suspended),
    upcomingSessions: Number(row.upcoming_sessions),
    trainingBlocks: Number(row.training_blocks),
    completedSeats: Number(row.completed_seats),
    noShows: Number(row.no_shows),
    openReports: Number(row.open_reports),
    feesAssessedCents: Number(row.fees_assessed_cents),
  };
}

type ReportRow = {
  id: string;
  reporter_id: string;
  reported_id: string;
  session_id: string | null;
  booking_id: string | null;
  reason: ReportReason;
  detail: string;
  status: "open" | "actioned" | "dismissed";
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
};

export type AdminReportDTO = {
  id: string;
  reason: ReportReason;
  detail: string;
  status: ReportRow["status"];
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  reporterId: string;
  reportedId: string;
  /** Reports against the same member, this one included. */
  reportsAgainst: number;
  reportedSuspended: boolean;
  session: {
    id: string;
    title: string;
    activity: string;
    startAt: string;
    status: string;
    /** One week of a block: the listing repeats, so removing it removes the block. */
    trainingBlockId: string | null;
  } | null;
  /** The booking's chat, only when the report points at a booking. */
  messages: { fromId: string; text: string; createdAt: string }[];
};

export async function adminListReports(
  sql: Sql,
  status: ReportRow["status"] = "open",
): Promise<{ reports: AdminReportDTO[]; people: Person[] }> {
  const rows = await sql<ReportRow>`
    select * from reports where status = ${status} order by created_at desc limit 200`;
  const reports: AdminReportDTO[] = [];
  for (const r of rows) {
    const [{ n }] = await sql<{ n: number }>`
      select count(*) as n from reports where reported_id = ${r.reported_id}`;
    const [target] = await sql<{ suspended_at: Date | null }>`
      select suspended_at from profiles where id = ${r.reported_id}`;
    const [s] = r.session_id
      ? await sql<{
          id: string;
          title: string;
          activity: string;
          start_at: Date;
          status: string;
          training_block_id: string | null;
        }>`
          select id, title, activity, start_at, status, training_block_id
          from sessions where id = ${r.session_id}`
      : [];
    const messages = r.booking_id
      ? await sql<{ from_id: string; text: string; created_at: Date }>`
          select from_id, text, created_at from messages where booking_id = ${r.booking_id}
          order by created_at, id`
      : [];
    reports.push({
      id: r.id,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      resolution: r.resolution,
      resolvedBy: r.resolved_by,
      resolvedAt: iso(r.resolved_at),
      createdAt: iso(r.created_at)!,
      reporterId: r.reporter_id,
      reportedId: r.reported_id,
      reportsAgainst: Number(n),
      reportedSuspended: Boolean(target?.suspended_at),
      session: s
        ? {
            id: s.id,
            title: s.title,
            activity: s.activity,
            startAt: iso(s.start_at)!,
            status: s.status,
            trainingBlockId: s.training_block_id,
          }
        : null,
      messages: messages.map((m) => ({ fromId: m.from_id, text: m.text, createdAt: iso(m.created_at)! })),
    });
  }
  return {
    reports,
    people: await people(
      sql,
      rows.flatMap((r) => [r.reporter_id, r.reported_id]),
    ),
  };
}

export async function adminSuspend(
  sql: Sql,
  adminEmail: string,
  profileId: string,
  reason: string,
  now = Date.now(),
) {
  await mustExist(sql, profileId);
  await sql.transaction(async (tx) => {
    await tx`
      update profiles set suspended_at = ${at(now)}, suspended_reason = ${reason.trim().slice(0, 500)}
      where id = ${profileId}`;
    await withdrawEverything(tx, profileId, now);
    await enqueue(
      tx,
      {
        profileId,
        kind: "suspended",
        category: "account",
        title: "Your account is paused",
        body: "We paused it after reviewing a report. Open SamePace to see why and how to reach us.",
        url: "/",
      },
      now,
    );
    await audit(tx, adminEmail, "suspend", { profileId, note: reason });
  });
}

export async function adminUnsuspend(sql: Sql, adminEmail: string, profileId: string) {
  await mustExist(sql, profileId);
  await sql.transaction(async (tx) => {
    await tx`
      update profiles set suspended_at = null, suspended_reason = null where id = ${profileId}`;
    await audit(tx, adminEmail, "unsuspend", { profileId });
  });
}

/** Take a listing down. Every seat is released free; nobody is charged. */
export async function adminRemoveSession(
  sql: Sql,
  adminEmail: string,
  sessionId: string,
  note: string,
  now = Date.now(),
) {
  await sql.transaction(async (tx) => {
    const [s] = await tx<{
      id: string;
      status: string;
      host_id: string;
      title: string;
      training_block_id: string | null;
    }>`
      select id, status, host_id, title, training_block_id
      from sessions where id = ${sessionId} for update`;
    if (!s) throw new PaceError(404, "Session not found.");
    // A block's listing comes back every week with the same words. Taking one
    // week down would change nothing, so the block goes with it.
    if (s.training_block_id && (await blockIsRunning(tx, s.training_block_id))) {
      return adminRemoveTrainingBlock(tx, adminEmail, s.training_block_id, note, now);
    }
    if (s.status === "open") {
      const seats = await tx<{ id: string; participant_id: string }>`
        update bookings set status = 'cancelled', settled_at = ${at(now)}
        where session_id = ${sessionId} and status in ('pending', 'confirmed')
        returning id, participant_id`;
      await tx`update sessions set status = 'cancelled' where id = ${sessionId}`;
      for (const seat of seats) {
        await enqueue(
          tx,
          {
            profileId: seat.participant_id,
            kind: "session_cancelled",
            category: "sessions",
            title: `Called off: ${s.title}`,
            body: "This session isn’t happening. Your seat is released and nothing is charged.",
            url: "/sessions",
            sessionId,
            bookingId: seat.id,
          },
          now,
        );
      }
      await enqueue(
        tx,
        {
          profileId: s.host_id,
          kind: "session_removed",
          category: "account",
          title: "Your session was taken down",
          body: `${s.title} broke the rules for what can be posted. Email support@samepace.app if you think that’s wrong.`,
          url: "/you",
          sessionId,
        },
        now,
      );
    }
    await audit(tx, adminEmail, "remove_session", { sessionId, note });
  });
}

const blockIsRunning = async (tx: Sql, blockId: string) =>
  (await tx`
    select 1 from training_blocks where id = ${blockId} and status in ('forming', 'active')`)
    .length > 0;

/**
 * Take a training block down: its weekly slots end, every session still on the
 * calendar is called off, and every seat is released free. Whoever started it is
 * told why; everyone else is told their seats are gone. What already happened —
 * check-ins, progress, credits — stays on the record.
 */
export async function adminRemoveTrainingBlock(
  sql: Sql,
  adminEmail: string,
  blockId: string,
  note: string,
  now = Date.now(),
) {
  await sql.transaction(async (tx) => {
    const [b] = await tx<{ id: string; status: string; created_by: string }>`
      select id, status, created_by from training_blocks where id = ${blockId} for update`;
    if (!b) throw new PaceError(404, "No training block.");
    if (b.status !== "ended") {
      const sessions = await tx<{ id: string }>`
        select id from sessions where training_block_id = ${blockId} and status = 'open'
          and start_at > ${at(now)} for update`;
      for (const s of sessions) {
        await tx`
          update bookings set status = 'cancelled', settled_at = ${at(now)}
          where session_id = ${s.id} and status in ('pending', 'confirmed')`;
        await tx`update sessions set status = 'cancelled' where id = ${s.id}`;
      }
      await tx`update series set status = 'ended' where training_block_id = ${blockId}`;
      await tx`
        update training_block_requests set status = 'declined', resolved_at = ${at(now)}
        where block_id = ${blockId} and status = 'pending'`;
      await tx`
        update training_blocks set status = 'ended', ended_reason = 'removed' where id = ${blockId}`;

      const members = await tx<{ profile_id: string }>`
        select profile_id from training_block_members where block_id = ${blockId} and left_at is null`;
      for (const m of members) {
        const started = m.profile_id === b.created_by;
        await enqueue(
          tx,
          {
            profileId: m.profile_id,
            kind: started ? "block_removed" : "block_cancelled",
            category: started ? "account" : "sessions",
            title: started ? "Your training block was taken down" : "A training block you’re in has ended",
            body: started
              ? "It broke the rules for what can be posted. Email support@samepace.app if you think that’s wrong."
              : "SamePace took it down. Your seats are released and nothing is charged.",
            url: started ? "/you" : "/sessions",
          },
          now,
        );
      }
    }
    await audit(tx, adminEmail, "remove_training_block", { trainingBlockId: blockId, note });
  });
}

export type ResolveInput = {
  action: "dismiss" | "suspend" | "remove_session" | "suspend_and_remove";
  note?: string;
};

export async function adminResolveReport(
  sql: Sql,
  adminEmail: string,
  reportId: string,
  input: ResolveInput,
  now = Date.now(),
) {
  await sql.transaction(async (tx) => {
    const [r] = await tx<ReportRow>`select * from reports where id = ${reportId} for update`;
    if (!r) throw new PaceError(404, "No such report.");
    if (r.status !== "open") throw new PaceError(409, "Already resolved.");
    const note = (input.note ?? "").trim().slice(0, 1000);
    if (input.action === "suspend" || input.action === "suspend_and_remove") {
      await adminSuspend(tx, adminEmail, r.reported_id, note || `Report: ${r.reason}`, now);
    }
    if ((input.action === "remove_session" || input.action === "suspend_and_remove") && r.session_id) {
      await adminRemoveSession(tx, adminEmail, r.session_id, note, now);
    }
    // A report that was acted on takes back any goal credit the reporter gave them.
    if (input.action !== "dismiss") await withdrawCredits(tx, r.reporter_id, r.reported_id);
    await tx`
      update reports set status = ${input.action === "dismiss" ? "dismissed" : "actioned"},
        resolution = ${`${input.action}${note ? `: ${note}` : ""}`},
        resolved_by = ${adminEmail}, resolved_at = ${at(now)}
      where id = ${reportId}`;
    await audit(tx, adminEmail, `report_${input.action}`, {
      reportId,
      profileId: r.reported_id,
      note,
    });
  });
}

export type AdminMemberDTO = {
  person: Person;
  suspended: { at: string; reason: string } | null;
  deleted: boolean;
  frozenUntil: string | null;
  creditCents: number;
  feesCents: number;
  strikes: number;
  reportsAgainst: number;
  reportsFiled: number;
  upcomingSessions: number;
  /** Every block they have been in, newest first. Counts only, as on a profile. */
  trainingBlocks: {
    id: string;
    goalLabel: string;
    status: string;
    endedReason: string | null;
    goalDate: string;
    startedIt: boolean;
    left: boolean;
    members: number;
    finished: boolean | null;
  }[];
  joinedAt: string;
};

export async function adminGetMember(sql: Sql, profileId: string): Promise<AdminMemberDTO> {
  const [row] = await sql<{
    suspended_at: Date | null;
    suspended_reason: string | null;
    deleted_at: Date | null;
    frozen_until: Date | null;
    credit_cents: number;
    created_at: Date;
  }>`select * from profiles where id = ${profileId}`;
  if (!row) throw new PaceError(404, "No such member.");
  const [person] = await people(sql, [profileId]);
  const [c] = await sql<Record<string, number>>`
    select
      (select coalesce(sum(amount_cents), 0) from ledger_events where profile_id = ${profileId}
        and status = 'assessed' and kind <> 'show_up_credit') as fees,
      (select count(*) from strikes where profile_id = ${profileId}) as strikes,
      (select count(*) from reports where reported_id = ${profileId}) as against,
      (select count(*) from reports where reporter_id = ${profileId}) as filed,
      (select count(*) from sessions where host_id = ${profileId} and status = 'open'
        and start_at > now()) as upcoming`;
  const blocks = await sql<{
    id: string;
    goal_kind: GoalKind;
    event_name: string | null;
    status: string;
    ended_reason: string | null;
    starts_on: string;
    goal_date: string;
    created_by: string;
    left_at: Date | null;
    finished: boolean | null;
    members: number;
    slots: number;
  }>`
    select tb.id, tb.goal_kind, tb.event_name, tb.status, tb.ended_reason, tb.created_by,
      tb.starts_on::text as starts_on, tb.goal_date::text as goal_date, m.left_at, m.finished,
      (select count(*) from training_block_members x
        where x.block_id = tb.id and x.left_at is null) as members,
      (select count(*) from series se where se.training_block_id = tb.id) as slots
    from training_block_members m join training_blocks tb on tb.id = m.block_id
    where m.profile_id = ${profileId}
    order by tb.created_at desc limit 20`;
  return {
    person,
    trainingBlocks: blocks.map((b) => ({
      id: b.id,
      goalLabel: goalLabel(
        b.goal_kind,
        b.event_name,
        Math.max(Number(b.slots), 1),
        blockWeeks(b.starts_on, b.goal_date),
      ),
      status: b.status,
      endedReason: b.ended_reason,
      goalDate: b.goal_date,
      startedIt: b.created_by === profileId,
      left: Boolean(b.left_at),
      members: Number(b.members),
      finished: b.finished,
    })),
    suspended: row.suspended_at
      ? { at: iso(row.suspended_at)!, reason: row.suspended_reason ?? "" }
      : null,
    deleted: Boolean(row.deleted_at),
    frozenUntil: iso(row.frozen_until),
    creditCents: row.credit_cents,
    feesCents: Number(c.fees),
    strikes: Number(c.strikes),
    reportsAgainst: Number(c.against),
    reportsFiled: Number(c.filed),
    upcomingSessions: Number(c.upcoming),
    joinedAt: iso(row.created_at)!,
  };
}

/** Find a member by name or handle. Admin only — members never get a directory. */
export async function adminSearchMembers(sql: Sql, q: string): Promise<AdminMemberDTO[]> {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const rows = await sql.query<{ id: string }>(
    `select id from profiles
     where deleted_at is null and (lower(name) like $1 or lower(handle) like $1)
     order by created_at desc limit 25`,
    [`%${term.replace(/[%_]/g, "")}%`],
  );
  return Promise.all(rows.map((r) => adminGetMember(sql, r.id)));
}

export async function adminListActions(sql: Sql) {
  const rows = await sql<{
    id: string;
    admin_email: string;
    action: string;
    profile_id: string | null;
    session_id: string | null;
    report_id: string | null;
    training_block_id: string | null;
    note: string;
    created_at: Date;
  }>`select * from admin_actions order by created_at desc limit 100`;
  return rows.map((r) => ({
    id: r.id,
    adminEmail: r.admin_email,
    action: r.action,
    profileId: r.profile_id,
    sessionId: r.session_id,
    reportId: r.report_id,
    trainingBlockId: r.training_block_id,
    note: r.note,
    createdAt: iso(r.created_at)!,
  }));
}
