import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { FitnessError } from "../fitness/contracts.ts";
import { blockedBetween, lockSession, PaceError, type SessionRow } from "../pace/service.server.ts";
import type {
  WorkoutPlanContent,
  WorkoutPlan,
  WorkoutPlanPage,
  SessionWorkoutPlan,
  SessionWorkoutPlanView,
  WorkoutRun,
  WorkoutRunPage,
  WorkoutSetResult,
} from "../../../shared/workout-plans.ts";
import {
  attachPlanInput,
  copySessionPlanInput,
  createPlanInput,
  removeSessionPlanInput,
  startRunInput,
  updatePlanInput,
  updateRunInput,
  workoutPageInput,
  workoutPlanId,
  type WorkoutPageArgs,
} from "./contracts.ts";

const iso = (value: Date | string) => new Date(value).toISOString();
const at = (now: number) => new Date(now);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const missing = () => new PaceError(404, "Workout plan not found.");
const changed = () => new PaceError(409, "This changed. Refresh before trying again.");
type PlanRow = {
  id: string;
  revision: number;
  data: WorkoutPlanContent;
  created_at: Date;
  updated_at: Date;
};
type AttachedRow = {
  id: string;
  session_id: string;
  author_id: string;
  source_plan_id: string;
  source_plan_revision: number;
  snapshot: WorkoutPlanContent;
  attached_at: Date;
};
type RunRow = {
  id: string;
  user_id: string;
  revision: number;
  source_plan_id: string | null;
  source_plan_revision: number;
  session_id: string | null;
  session_plan_id: string | null;
  snapshot: WorkoutPlanContent;
  results: WorkoutSetResult[];
  status: WorkoutRun["status"];
  note: string;
  share_accountability: boolean;
  started_at: Date;
  finished_at: Date | null;
  updated_at: Date;
};
const planView = (row: PlanRow): WorkoutPlan => ({
  ...row.data,
  id: row.id,
  revision: row.revision,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});
const attachedView = (row: AttachedRow): SessionWorkoutPlan => ({
  sessionId: row.session_id,
  planId: row.source_plan_id,
  planRevision: row.source_plan_revision,
  snapshot: row.snapshot,
  attachedAt: iso(row.attached_at),
});
const runView = (row: RunRow): WorkoutRun => ({
  id: row.id,
  revision: row.revision,
  planId: row.source_plan_id,
  planRevision: row.source_plan_revision,
  sessionId: row.session_id,
  snapshot: row.snapshot,
  status: row.status,
  startedAt: iso(row.started_at),
  finishedAt: row.finished_at ? iso(row.finished_at) : null,
  updatedAt: iso(row.updated_at),
  results: row.results,
  note: row.note,
  shareAccountability: row.share_accountability,
});

/** Match the account deletion order: profile, then identity, then private rows. */
async function owner(tx: Sql, userId: string, profileLocked = false, allowSuspended = false) {
  const rows = await tx.query<{ deleted_at: Date | null; suspended_at: Date | null }>(
    `select deleted_at, suspended_at from profiles where id = $1${profileLocked ? "" : " for no key update"}`,
    [userId],
  );
  if (!rows[0] || rows[0].deleted_at) throw new FitnessError(401, "Unauthorized");
  if (rows[0].suspended_at && !allowSuspended) throw new PaceError(403, "This account is paused.");
  const [identity] = await tx`select id from "user" where id = ${userId} for update`;
  if (!identity) throw new FitnessError(401, "Unauthorized");
}
async function ownedPlan(tx: Sql, userId: string, id: string): Promise<PlanRow> {
  const [row] =
    await tx<PlanRow>`select * from workout_plans where user_id = ${userId} and id = ${workoutPlanId.parse(id)}`;
  if (!row) throw missing();
  return row;
}
async function ownedRun(tx: Sql, userId: string, id: string): Promise<RunRow> {
  const [row] =
    await tx<RunRow>`select * from workout_runs where user_id = ${userId} and id = ${workoutPlanId.parse(id)}`;
  if (!row) throw new PaceError(404, "Workout log not found.");
  return row;
}
async function attached(tx: Sql, sessionId: string) {
  const [row] =
    await tx<AttachedRow>`select * from session_workout_plans where session_id = ${sessionId}`;
  return row;
}
const cursorSchema = z.strictObject({ at: z.iso.datetime(), id: z.uuid() });
function page(input: WorkoutPageArgs = {}) {
  const parsed = workoutPageInput.parse(input);
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (parsed.cursor) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(parsed.cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new PaceError(400, "Invalid page cursor.");
    }
  }
  return { limit: parsed.limit, cursor };
}
function nextCursor(timestamp: Date, id: string) {
  return Buffer.from(JSON.stringify({ at: iso(timestamp), id })).toString("base64url");
}
export async function listPlans(
  sql: Sql,
  userId: string,
  input: WorkoutPageArgs = {},
): Promise<WorkoutPlanPage> {
  const { limit, cursor } = page(input);
  return sql.transaction(async (tx) => {
    await owner(tx, userId, false, true);
    const rows = await tx.query<PlanRow>(
      `select * from workout_plans where user_id = $1
      ${cursor ? "and (created_at, id) < ($3::timestamptz, $4::uuid)" : ""}
      order by created_at desc, id desc limit $2`,
      [userId, limit + 1, ...(cursor ? [cursor.at, cursor.id] : [])],
    );
    const selected = rows.slice(0, limit),
      last = selected.at(-1);
    return {
      plans: selected.map(planView),
      nextCursor: rows.length > limit && last ? nextCursor(last.created_at, last.id) : null,
    };
  });
}
export async function getPlan(sql: Sql, userId: string, id: string): Promise<WorkoutPlan> {
  return sql.transaction(async (tx) => {
    await owner(tx, userId, false, true);
    return planView(await ownedPlan(tx, userId, id));
  });
}
async function insertPlan(
  tx: Sql,
  userId: string,
  id: string,
  data: WorkoutPlanContent,
  now: number,
) {
  const [existing] =
    await tx<PlanRow>`select * from workout_plans where user_id = ${userId} and id = ${id}`;
  if (existing) {
    // jsonb changes object-key order. Parse to canonical input order before comparing.
    const original = createPlanInput.parse({ ...existing.data, id });
    if (!same(original, createPlanInput.parse({ ...data, id }))) throw changed();
    return planView(existing);
  }
  const [{ count }] = await tx<{
    count: string;
  }>`select count(*)::text count from workout_plans where user_id = ${userId}`;
  if (Number(count) >= 500)
    throw new PaceError(409, "Your library has 500 plans. Remove one before adding another.");
  const [row] = await tx<PlanRow>`insert into workout_plans(user_id,id,data,created_at,updated_at)
    values (${userId},${id},${JSON.stringify(data)}::jsonb,${at(now)},${at(now)}) returning *`;
  return planView(row);
}
export async function createPlan(
  sql: Sql,
  userId: string,
  input: unknown,
  now = Date.now(),
): Promise<WorkoutPlan> {
  const { id, ...data } = createPlanInput.parse(input);
  return sql.transaction(async (tx) => {
    await owner(tx, userId);
    return insertPlan(tx, userId, id, data, now);
  });
}
export async function updatePlan(
  sql: Sql,
  userId: string,
  id: string,
  input: unknown,
  now = Date.now(),
): Promise<WorkoutPlan> {
  const { expectedRevision, ...data } = updatePlanInput.parse(input);
  return sql.transaction(async (tx) => {
    await owner(tx, userId);
    const previous = await ownedPlan(tx, userId, id);
    if (previous.revision !== expectedRevision) throw changed();
    const [row] =
      await tx<PlanRow>`update workout_plans set revision = revision + 1, data = ${JSON.stringify(data)}::jsonb,
      updated_at = ${at(now)} where user_id = ${userId} and id = ${previous.id} returning *`;
    return planView(row);
  });
}
export async function deletePlan(sql: Sql, userId: string, id: string): Promise<void> {
  await sql.transaction(async (tx) => {
    await owner(tx, userId, false, true);
    const row = await ownedPlan(tx, userId, id);
    await tx`delete from workout_plans where user_id = ${userId} and id = ${row.id}`;
  });
}

/** A shared prescription is only visible to its booked group, never visitors. */
async function sessionAccess(tx: Sql, userId: string, sessionId: string) {
  const session = await lockSession(tx, sessionId, [userId]);
  if (!session) throw missing();
  await owner(tx, userId, true);
  const members = await tx<{ id: string }>`select p.id from profiles p
    where p.deleted_at is null and p.suspended_at is null and
      (p.id = ${session.host_id} or exists (select 1 from bookings b where b.session_id = ${session.id}
        and b.participant_id = p.id and b.status in ('confirmed', 'completed')))`;
  const ids = members.map((member) => member.id);
  if (!ids.includes(userId) || (await blockedBetween(tx, userId, ids))) throw missing();
  return { session, ids };
}
async function canAttach(tx: Sql, session: SessionRow, userId: string, now: number) {
  if (
    session.host_id !== userId ||
    session.status !== "open" ||
    new Date(session.start_at).getTime() <= now
  )
    return false;
  const [booked] = await tx`select 1 from bookings where session_id = ${session.id}
    and status in ('pending', 'confirmed', 'completed') limit 1`;
  const [started] = await tx`select 1 from workout_runs where session_id = ${session.id} limit 1`;
  return !booked && !started;
}
async function sessionView(
  tx: Sql,
  userId: string,
  session: SessionRow,
  ids: string[],
  now: number,
): Promise<SessionWorkoutPlanView> {
  const plan = await attached(tx, session.id);
  const [mine] =
    await tx<RunRow>`select * from workout_runs where user_id = ${userId} and session_id = ${session.id}`;
  const shared = await tx.query<RunRow & { name: string }>(
    `select r.*, p.name from workout_runs r
    join profiles p on p.id = r.user_id where r.session_id = $1 and r.share_accountability
    and r.user_id = any($2) order by r.started_at, r.user_id`,
    [session.id, ids],
  );
  return {
    plan: plan ? attachedView(plan) : null,
    myRun: mine ? runView(mine) : null,
    canAttach: await canAttach(tx, session, userId, now),
    accountability: shared.map((run) => ({
      userId: run.user_id,
      name: run.name,
      status: run.status,
      completedSets: run.results.filter((set) => set.status === "completed").length,
      skippedSets: run.results.filter((set) => set.status === "skipped").length,
      plannedSets: run.snapshot.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
      updatedAt: iso(run.updated_at),
    })),
  };
}
export async function getSessionPlan(
  sql: Sql,
  userId: string,
  sessionId: string,
  now = Date.now(),
): Promise<SessionWorkoutPlanView> {
  return sql.transaction(async (tx) => {
    const { session, ids } = await sessionAccess(tx, userId, sessionId);
    return sessionView(tx, userId, session, ids, now);
  });
}
export async function attachSessionPlan(
  sql: Sql,
  userId: string,
  sessionId: string,
  input: unknown,
  now = Date.now(),
): Promise<SessionWorkoutPlanView> {
  const args = attachPlanInput.parse(input);
  return sql.transaction(async (tx) => {
    const { session, ids } = await sessionAccess(tx, userId, sessionId);
    if (session.host_id !== userId) throw new PaceError(403, "Only the host can attach a plan.");
    const previous = await attached(tx, sessionId);
    // A retry of the same published revision remains harmless after someone books.
    if (
      previous?.source_plan_id === args.planId &&
      previous.source_plan_revision === args.expectedPlanRevision
    )
      return sessionView(tx, userId, session, ids, now);
    if (!(await canAttach(tx, session, userId, now)))
      throw new PaceError(
        409,
        "The session plan is fixed once someone books or the workout starts.",
      );
    const plan = await ownedPlan(tx, userId, args.planId);
    if (plan.revision !== args.expectedPlanRevision) throw changed();
    if (plan.data.activity !== session.activity)
      throw new PaceError(400, "Choose a plan for this session's activity.");
    if (previous) throw new PaceError(409, "Remove the current plan before attaching another one.");
    await tx`insert into session_workout_plans(session_id,id,author_id,source_plan_id,source_plan_revision,snapshot,attached_at)
      values (${sessionId},${randomUUID()},${userId},${plan.id},${plan.revision},${JSON.stringify(plan.data)}::jsonb,${at(now)})`;
    return sessionView(tx, userId, session, ids, now);
  });
}
export async function removeSessionPlan(
  sql: Sql,
  userId: string,
  sessionId: string,
  input: unknown,
  now = Date.now(),
): Promise<SessionWorkoutPlanView> {
  const args = removeSessionPlanInput.parse(input);
  return sql.transaction(async (tx) => {
    const { session, ids } = await sessionAccess(tx, userId, sessionId);
    if (session.host_id !== userId) throw new PaceError(403, "Only the host can remove a plan.");
    if (!(await canAttach(tx, session, userId, now)))
      throw new PaceError(
        409,
        "The session plan is fixed once someone books or the workout starts.",
      );
    const previous = await attached(tx, sessionId);
    if (!previous) throw missing();
    if (
      previous.source_plan_id !== args.expectedPlanId ||
      previous.source_plan_revision !== args.expectedPlanRevision
    )
      throw changed();
    await tx`delete from session_workout_plans where session_id = ${sessionId}`;
    return sessionView(tx, userId, session, ids, now);
  });
}
export async function copySessionPlan(
  sql: Sql,
  userId: string,
  sessionId: string,
  input: unknown,
  now = Date.now(),
): Promise<WorkoutPlan> {
  const args = copySessionPlanInput.parse(input);
  return sql.transaction(async (tx) => {
    await sessionAccess(tx, userId, sessionId);
    const plan = await attached(tx, sessionId);
    if (!plan) throw missing();
    if (
      plan.source_plan_id !== args.expectedPlanId ||
      plan.source_plan_revision !== args.expectedPlanRevision
    )
      throw changed();
    return insertPlan(tx, userId, args.id, plan.snapshot, now);
  });
}
export async function startRun(
  sql: Sql,
  userId: string,
  input: unknown,
  now = Date.now(),
): Promise<WorkoutRun> {
  const args = startRunInput.parse(input);
  return sql.transaction(async (tx) => {
    let session: SessionRow | undefined;
    if (args.sessionId) ({ session } = await sessionAccess(tx, userId, args.sessionId));
    else await owner(tx, userId);
    const [existing] =
      await tx<RunRow>`select * from workout_runs where user_id = ${userId} and id = ${args.id}`;
    if (existing) {
      if (
        existing.session_id !== (args.sessionId ?? null) ||
        (!args.sessionId &&
          (existing.source_plan_id !== args.planId ||
            existing.source_plan_revision !== args.expectedPlanRevision))
      )
        throw changed();
      return runView(existing);
    }
    let planId: string,
      revision: number,
      snapshot: WorkoutPlanContent,
      sessionPlanId: string | null = null;
    if (session) {
      if (session.status === "cancelled") throw new PaceError(409, "This session was called off.");
      if (now < new Date(session.start_at).getTime() - 30 * 60_000)
        throw new PaceError(409, "Start recording within 30 minutes of the session.");
      const plan = await attached(tx, session.id);
      if (!plan) throw missing();
      const [duplicate] =
        await tx`select 1 from workout_runs where user_id = ${userId} and session_id = ${session.id}`;
      if (duplicate)
        throw new PaceError(
          409,
          "You already started this session's workout. Open your existing log.",
        );
      planId = plan.source_plan_id;
      revision = plan.source_plan_revision;
      snapshot = plan.snapshot;
      sessionPlanId = plan.id;
    } else {
      const plan = await ownedPlan(tx, userId, args.planId!);
      if (plan.revision !== args.expectedPlanRevision) throw changed();
      planId = plan.id;
      revision = plan.revision;
      snapshot = plan.data;
    }
    const [{ count }] = await tx<{
      count: string;
    }>`select count(*)::text count from workout_runs where user_id = ${userId} and status = 'in_progress'`;
    if (Number(count) >= 10)
      throw new PaceError(409, "Finish or remove an open workout before starting another.");
    const [row] =
      await tx<RunRow>`insert into workout_runs(user_id,id,session_id,session_plan_id,source_plan_id,source_plan_revision,
      snapshot,status,started_at,updated_at) values (${userId},${args.id},${args.sessionId ?? null},${sessionPlanId},${planId},${revision},
      ${JSON.stringify(snapshot)}::jsonb,'in_progress',${at(now)},${at(now)}) returning *`;
    return runView(row);
  });
}
export async function getRun(sql: Sql, userId: string, id: string): Promise<WorkoutRun> {
  return sql.transaction(async (tx) => {
    await owner(tx, userId, false, true);
    return runView(await ownedRun(tx, userId, id));
  });
}
export async function listRuns(
  sql: Sql,
  userId: string,
  input: WorkoutPageArgs = {},
): Promise<WorkoutRunPage> {
  const { limit, cursor } = page(input);
  return sql.transaction(async (tx) => {
    await owner(tx, userId, false, true);
    const rows = await tx.query<RunRow>(
      `select * from workout_runs where user_id = $1
      ${cursor ? "and (started_at, id) < ($3::timestamptz, $4::uuid)" : ""}
      order by started_at desc, id desc limit $2`,
      [userId, limit + 1, ...(cursor ? [cursor.at, cursor.id] : [])],
    );
    const selected = rows.slice(0, limit),
      last = selected.at(-1);
    return {
      runs: selected.map(runView),
      nextCursor: rows.length > limit && last ? nextCursor(last.started_at, last.id) : null,
    };
  });
}
export async function updateRun(
  sql: Sql,
  userId: string,
  id: string,
  input: unknown,
  now = Date.now(),
): Promise<WorkoutRun> {
  const args = updateRunInput.parse(input);
  // Read only our row to find the immutable session reference before taking locks.
  const reference = await ownedRun(sql, userId, id);
  return sql.transaction(async (tx) => {
    if (args.shareAccountability) {
      if (!reference.session_id)
        throw new PaceError(400, "Only session workouts can share progress with buddies.");
      await sessionAccess(tx, userId, reference.session_id);
    } else await owner(tx, userId);
    const previous = await ownedRun(tx, userId, id);
    if (previous.revision !== args.expectedRevision) throw changed();
    if (previous.status === "completed" && !args.finish)
      throw new PaceError(
        409,
        "A finished workout stays finished; you can still correct its results.",
      );
    const sets = new Map(
      previous.snapshot.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => [set.id, exercise.id]),
      ),
    );
    if (args.results.some((result) => sets.get(result.setId) !== result.exerciseId))
      throw new PaceError(400, "A result does not belong to this workout's saved plan.");
    if (now < new Date(previous.started_at).getTime())
      throw new PaceError(400, "A workout cannot finish before it starts.");
    const [row] =
      await tx<RunRow>`update workout_runs set revision = revision + 1, results = ${JSON.stringify(args.results)}::jsonb,
      status = ${args.finish ? "completed" : "in_progress"}, finished_at = ${args.finish ? (previous.finished_at ?? at(now)) : null},
      note = ${args.note}, share_accountability = ${args.shareAccountability}, updated_at = ${at(now)}
      where user_id = ${userId} and id = ${previous.id} returning *`;
    return runView(row);
  });
}
export async function deleteRun(sql: Sql, userId: string, id: string): Promise<void> {
  await sql.transaction(async (tx) => {
    await owner(tx, userId, false, true);
    const row = await ownedRun(tx, userId, id);
    await tx`delete from workout_runs where user_id = ${userId} and id = ${row.id}`;
  });
}

/** Export already holds the identity lock; never reverse profile/identity ordering. */
export async function readPlanForExport(tx: Sql, userId: string, id: string): Promise<WorkoutPlan> {
  return planView(await ownedPlan(tx, userId, id));
}
export async function readRunForExport(tx: Sql, userId: string, id: string): Promise<WorkoutRun> {
  return runView(await ownedRun(tx, userId, id));
}
