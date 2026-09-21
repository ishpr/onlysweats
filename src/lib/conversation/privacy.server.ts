import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";

/** Caller holds the auth identity lock, as do all HealthKit mutations. Removing
 * source readings also removes private conversations that may summarize them. */
export async function forgetFitnessConversation(sql: Sql, userId: string) {
  const changed = await sql`update assistant_chat_settings set fitness_context_used = false,
    history_generation = ${randomUUID()}, active_request_id = null, active_attempt_id = null, lease_until = null
    where user_id = ${userId} and fitness_context_used returning user_id`;
  if (changed.length) await sql`delete from assistant_chat_messages where user_id = ${userId}`;
}
