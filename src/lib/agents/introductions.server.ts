/**
 * Meeting someone new is a public meeting, however the session ends up listed.
 *
 * The session an assistant books is invite-only, and the two-strike freeze and
 * identity verification both leave invite-only sessions alone — that exemption is
 * for an invite from someone you already know. A first-time introduction is two
 * strangers, so it answers to the same rules as joining a public session. Checked
 * when members are listed, when one invites another, and again when the workout
 * is booked: a freeze or a reversed verification can land in between.
 */
import type { Sql } from "../db.ts";
import { PaceError, requireVerified } from "../pace/service.server.ts";

type Bar = { message: string; code?: string };

/** Why this member can't meet new partners right now, or `null`. */
export async function introductionBar(
  sql: Sql,
  userId: string,
  now: number,
  opts: { womenOnly?: boolean } = {},
): Promise<Bar | null> {
  const [p] = await sql<{ frozen_until: Date | null }>`
    select frozen_until from profiles where id = ${userId}`;
  if (p?.frozen_until && +new Date(p.frozen_until) > now) {
    return { message: "Meeting new partners is paused for 14 days after two no-shows." };
  }
  try {
    await requireVerified(sql, userId, {
      visibility: "public",
      womenOnly: Boolean(opts.womenOnly),
    });
  } catch (err) {
    if (err instanceof PaceError) return { message: err.message, code: err.code };
    throw err;
  }
  return null;
}

/**
 * Refuse an introduction either member isn't open to. The caller is told why; the
 * other member's reason is theirs, so that reads as "not available".
 */
export async function requireIntroduction(
  sql: Sql,
  userId: string,
  memberIds: string[],
  now: number,
  opts: { womenOnly?: boolean } = {},
) {
  const mine = await introductionBar(sql, userId, now, opts);
  if (mine) throw new PaceError(mine.code ? 403 : 409, mine.message, mine.code);
  for (const id of memberIds) {
    if (id !== userId && (await introductionBar(sql, id, now, opts))) {
      throw new PaceError(409, "This introduction isn’t available right now.");
    }
  }
}
