import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAgentChatCard } from "../../../shared/agent-cards.ts";
import type { Sql } from "../db.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import {
  CHAT_NOTICE_VERSION,
  type ChatAction,
  type ChatActionReceipt,
  type ChatActionResult,
} from "../../../shared/conversation.ts";
import { ChatError, getHistory } from "./service.server.ts";
import {
  commandInput,
  executeAgentCommand,
  lockAgentCommandProfiles,
  type PreparedAgentCard,
} from "./agent-tools.server.ts";

export const CHAT_ACTION_TTL_MS = 30 * 60_000;
export type PendingChatAction = PreparedAgentCard & { id: string };
export const actionExecutionInput = z.strictObject({
  consentGeneration: z.uuid(),
  historyGeneration: z.uuid(),
  interaction: z
    .union([
      z.strictObject({ code: z.string().regex(/^\d{4}$/) }),
      z.strictObject({
        geo: z.strictObject({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          accuracyM: z.number().nonnegative().max(10000).optional(),
        }),
      }),
    ])
    .optional(),
});
type ActionRow = {
  id: string;
  user_id: string;
  message_id: string;
  command: unknown;
  card: unknown;
  consent_generation: string;
  history_generation: string;
  expires_at: Date | string;
  receipt: ChatActionReceipt | string | null;
};
const value = <T>(input: T | string): T =>
  typeof input === "string" ? (JSON.parse(input) as T) : input;
const iso = (now: number) => new Date(now).toISOString();

/** Called only when a complete reply commits. Streaming previews never authorize a write. */
export async function storeChatActions(
  tx: Sql,
  userId: string,
  messageId: string,
  generations: { consentGeneration: string; historyGeneration: string },
  drafts: PendingChatAction[],
  now: number,
) {
  if (drafts.length > 12) throw new ChatError(400, "Too many review cards.");
  for (const draft of drafts) {
    if (!isAgentChatCard(draft.card))
      throw new ChatError(400, "The review card could not be prepared.");
    if (!draft.command) continue;
    const command = commandInput.parse(draft.command);
    if (JSON.stringify(command).length > 32_000)
      throw new ChatError(400, "Please use a smaller action.");
    const expiry = Math.min(Date.parse(draft.card.expiresAt), now + CHAT_ACTION_TTL_MS);
    if (!Number.isFinite(expiry) || expiry <= now)
      throw new ChatError(409, "This review expired. Ask for a fresh card.");
    await tx`insert into assistant_chat_actions
      (id, user_id, message_id, consent_generation, history_generation, command, card, created_at, expires_at)
      values (${draft.id}, ${userId}, ${messageId}, ${generations.consentGeneration},
      ${generations.historyGeneration}, ${JSON.stringify(command)}::jsonb,
      ${JSON.stringify(draft.card)}::jsonb, ${iso(now)}, ${iso(expiry)})`;
  }
}

/** A completed action remains visibly completed after a reload or lost response. */
export async function actionReceipts(sql: Sql, userId: string, actionIds?: string[]) {
  if (actionIds && !actionIds.length) return new Map<string, ChatActionReceipt>();
  const rows = await sql.query<{ id: string; receipt: ChatActionReceipt | string }>(
    "select id, receipt from assistant_chat_actions where user_id = $1 and receipt is not null" +
      (actionIds ? " and id = any($2::uuid[])" : " order by executed_at desc limit 480"),
    actionIds ? [userId, actionIds] : [userId],
  );
  return new Map(rows.map((row) => [row.id, value(row.receipt)]));
}
export function withActionReceipts(
  actions: ChatAction[],
  receipts: Map<string, ChatActionReceipt>,
) {
  return actions.map((action): ChatAction => {
    const receipt = receipts.get(action.id);
    if (!receipt || action.kind !== "agent_card" || !action.card) return action;
    const { input: _input, ...card } = action.card;
    return {
      ...action,
      card: {
        ...card,
        primaryLabel: null,
        receipt: {
          text: receipt.text,
          createdAt: receipt.createdAt,
        },
      },
    };
  });
}

/** An authenticated member may execute only the exact stored draft they reviewed.
 * Provider/model output has no access to this entry point. Domain write + durable
 * receipt commit together, including when a workout write rotates chat history. */
export async function executeChatAction(
  sql: Sql,
  userId: string,
  actionId: string,
  body: unknown,
  now = Date.now(),
): Promise<ChatActionResult> {
  z.uuid().parse(actionId);
  const input = actionExecutionInput.parse(body);
  return sql.transaction(async (tx) => {
    const [snapshot] = await tx<ActionRow>`select * from assistant_chat_actions
      where id = ${actionId} and user_id = ${userId}`;
    if (!snapshot)
      throw new ChatError(410, "This card is no longer available. Ask for a fresh one.");
    // Domain services use profile-before-identity lock order. A receipt replay
    // requires only its owner; deleted/changed counterpart state cannot replay a write.
    const command = snapshot.receipt ? null : commandInput.parse(value(snapshot.command));
    if (command) await lockAgentCommandProfiles(tx, userId, command);
    else await tx`select id from profiles where id = ${userId} order by id for no key update`;
    const identities = await tx`select id from "user" where id = ${userId} for update`;
    const [profile] = await tx<{ suspended_at: Date | null; deleted_at: Date | null }>`
      select suspended_at, deleted_at from profiles where id = ${userId}`;
    if (!identities.length || !profile || profile.deleted_at)
      throw new ChatError(401, "Sign in again to continue.");
    if (profile.suspended_at) throw new ChatError(403, "Your account is paused.");
    const [settings] = await tx<{
      cloud_enabled: boolean;
      notice_version: string;
      consent_generation: string;
      history_generation: string;
      active_request_id: string | null;
      lease_until: Date | null;
    }>`select * from assistant_chat_settings where user_id = ${userId} for update`;
    const [row] = await tx<ActionRow>`select * from assistant_chat_actions
      where id = ${actionId} and user_id = ${userId} for update`;
    if (!row) throw new ChatError(410, "This card is no longer available. Ask for a fresh one.");
    if (
      !settings?.cloud_enabled ||
      settings.notice_version !== CHAT_NOTICE_VERSION ||
      settings.consent_generation !== input.consentGeneration ||
      row.consent_generation !== input.consentGeneration
    )
      throw new ChatError(409, "Your agent settings changed. Refresh the conversation.");
    const [terms] = await tx`select 1 from app_terms_acceptances
      where user_id = ${userId} and version = ${APP_TERMS_VERSION}`;
    if (!terms) throw new ChatError(409, "Review the current SamePace Terms first.");
    if (input.historyGeneration !== row.history_generation)
      throw new ChatError(409, "This card belongs to an earlier conversation.");
    if (row.receipt)
      return { receipt: value(row.receipt), history: await getHistory(tx, userId, now) };
    if (settings.history_generation !== input.historyGeneration)
      throw new ChatError(409, "Your conversation changed. Ask for a fresh card.");
    if (+new Date(row.expires_at) <= now)
      throw new ChatError(410, "This card expired. Ask for a fresh one.");
    if (settings.active_request_id && settings.lease_until && +new Date(settings.lease_until) > now)
      throw new ChatError(409, "Wait for the current reply before using this card.");
    const [message] = await tx`select 1 from assistant_chat_messages
      where id = ${row.message_id} and user_id = ${userId} and role = 'assistant' and status = 'complete'`;
    if (!message || !command)
      throw new ChatError(410, "This card is no longer available. Ask for a fresh one.");
    // Source-context invalidation deletes other stale drafts but preserves this
    // transaction's execution row until its minimal receipt has been recorded.
    await tx`update assistant_chat_actions set executing = true where id = ${actionId}`;
    const outcome = await executeAgentCommand(tx, userId, command, input.interaction, now);
    const receipt: ChatActionReceipt = { actionId, text: outcome.text, createdAt: iso(now) };
    await tx`update assistant_chat_actions set receipt = ${JSON.stringify(receipt)}::jsonb,
      executed_at = ${iso(now)}, executing = false, command = '{}'::jsonb, card = '{}'::jsonb
      where id = ${actionId} and user_id = ${userId}`;
    const [current] = await tx<{ consent_generation: string; history_generation: string }>`
      select consent_generation, history_generation from assistant_chat_settings where user_id = ${userId}`;
    const messageId = randomUUID();
    const followups: PendingChatAction[] = (outcome.followups ?? []).map((draft) => ({
      ...draft,
      id: randomUUID(),
      card: { ...draft.card, expiresAt: iso(now + CHAT_ACTION_TTL_MS) },
    }));
    const actions: ChatAction[] = followups.map((draft) => ({
      id: draft.id,
      kind: "agent_card",
      label: draft.label,
      description: draft.description,
      card: draft.card,
    }));
    if (outcome.related?.kind === "workout_run")
      actions.push({
        id: randomUUID(),
        kind: "workout_run",
        targetId: outcome.related.targetId,
        label: "Open your workout",
        description: "Use the timer and record each set as you perform it.",
      });
    await tx`insert into assistant_chat_messages
      (id, user_id, request_id, role, text, actions, status, created_at)
      values (${messageId}, ${userId}, ${randomUUID()}, 'assistant', ${receipt.text},
      ${JSON.stringify(actions)}::jsonb, 'complete', ${iso(now)})`;
    await storeChatActions(
      tx,
      userId,
      messageId,
      {
        consentGeneration: current.consent_generation,
        historyGeneration: current.history_generation,
      },
      followups,
      now,
    );
    return { receipt, history: await getHistory(tx, userId, now) };
  });
}
