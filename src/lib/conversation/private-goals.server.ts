import { z } from "zod";
import type { Sql } from "../db.ts";
import { activity } from "../agents/contracts.ts";
import { PaceError } from "../pace/service.server.ts";

export const goalInput = z.strictObject({
  label: z.string().trim().min(1).max(160),
  activity,
  date: z.iso.date(),
});
export type PrivateGoal = z.infer<typeof goalInput> & { revision: number };
export async function getPrivateGoal(sql: Sql, userId: string): Promise<PrivateGoal | null> {
  const [row] = await sql<PrivateGoal>`select label, activity, goal_date::text as date, revision
    from private_agent_goals where user_id = ${userId}`;
  return row ?? null;
}
export function validateGoalDate(date: string, now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const day = (kind: string) => parts.find((p) => p.type === kind)!.value;
  const today = `${day("year")}-${day("month")}-${day("day")}`;
  if (date < today || Date.parse(date) - now > 5 * 366 * 86_400_000)
    throw new PaceError(400, "Choose a goal date from today through the next five years.");
}
export async function savePrivateGoal(
  sql: Sql,
  userId: string,
  body: unknown,
  expectedRevision: number,
  now: number,
  timeZone = "UTC",
) {
  const goal = goalInput.parse(body);
  validateGoalDate(goal.date, now, timeZone);
  return sql.transaction(async (tx) => {
    const [owner] = await tx`select id from profiles where id = ${userId}
      and deleted_at is null and suspended_at is null for no key update`;
    if (!owner) throw new PaceError(403, "Your goal is unavailable.");
    const current = await getPrivateGoal(tx, userId);
    if ((current?.revision ?? 0) !== expectedRevision)
      throw new PaceError(409, "Your goal changed. Review it again.");
    await tx`insert into private_agent_goals(user_id,label,activity,goal_date,updated_at)
      values(${userId},${goal.label},${goal.activity},${goal.date},${new Date(now)})
      on conflict(user_id) do update set label=excluded.label,activity=excluded.activity,
        goal_date=excluded.goal_date,revision=private_agent_goals.revision+1,updated_at=excluded.updated_at`;
    return (await getPrivateGoal(tx, userId))!;
  });
}
