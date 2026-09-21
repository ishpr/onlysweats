import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { listPublicSessions } from "../pace/service.server.ts";
import { getPreferences } from "../agents/assistant.server.ts";
import { getAgentMatching } from "../agents/contact.server.ts";
import { listWorkouts } from "../health/service.server.ts";
import { workoutPlanDraftInput } from "./plan-draft.ts";
import { conversationContext } from "./context.ts";
import { readManualWorkoutContext } from "./manual-workout-context.server.ts";
import { APP_TERMS_VERSION, type AppTermsStatus } from "../../../shared/app-terms.ts";
import { FITNESS_AI_NOTICE_VERSION } from "../../../shared/fitness.ts";
import {
  CHAT_NOTICE_VERSION,
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  CHAT_HISTORY_USE_NOTICE_VERSION,
  type ChatAction,
  type ChatEvent,
  type ChatHistory,
  type ChatMessage,
  type ChatSettings,
} from "../../../shared/conversation.ts";
import {
  chatAvailable,
  chatModel,
  gatewayChatProvider,
  type ChatProvider,
} from "./provider.server.ts";

export class ChatError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ChatError";
  }
}

const iso = (n: number) => new Date(n).toISOString();
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const parse = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const DAY = 86_400_000;
const RETENTION_DAYS = 30;
export const MAX_CHAT_BODY_BYTES = 16_384;
export const settingsInput = z
  .object({
    cloudEnabled: z.boolean(),
    fitnessContextEnabled: z.boolean(),
    manualWorkoutContextEnabled: z.boolean().default(false),
    manualWorkoutContextNoticeVersion: z.literal(CHAT_MANUAL_WORKOUT_NOTICE_VERSION).optional(),
    historyUse: z.enum(["when_requested", "when_relevant"]).optional(),
    historyUseNoticeVersion: z.literal(CHAT_HISTORY_USE_NOTICE_VERSION).optional(),
    initialSetup: z.literal(true).optional(),
    expectedConsentGeneration: z.uuid().optional(),
    noticeVersion: z.literal(CHAT_NOTICE_VERSION),
  })
  .strict()
  .refine(
    (s) => !s.fitnessContextEnabled || s.cloudEnabled,
    "Enable cloud conversation before fitness context.",
  )
  .refine(
    (s) =>
      !s.manualWorkoutContextEnabled ||
      (s.cloudEnabled &&
        s.manualWorkoutContextNoticeVersion === CHAT_MANUAL_WORKOUT_NOTICE_VERSION),
    "Review the separate manual workout notice and enable cloud conversation first.",
  )
  .refine(
    (s) =>
      s.historyUse !== "when_relevant" ||
      (s.cloudEnabled && s.historyUseNoticeVersion === CHAT_HISTORY_USE_NOTICE_VERSION),
    "Review the current history-use notice and enable cloud conversation first.",
  );
export const turnInput = z
  .object({
    requestId: z.uuid(),
    text: z.string().trim().min(1).max(2000),
    consentGeneration: z.uuid(),
    historyGeneration: z.uuid(),
    workoutPlanDrafts: z.boolean().optional(),
  })
  .strict();
export const preferenceDraftInput = z
  .object({
    activity: z.enum(["run", "walk", "hike", "ride", "strength", "mobility"]).optional(),
    durationMin: z.number().int().min(10).max(360).optional(),
    approvedIntent: z.string().trim().max(240).optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), "Include a suggested field.");
type SettingsRow = {
  user_id: string;
  consent_reviewed: boolean;
  cloud_enabled: boolean;
  fitness_context_enabled: boolean;
  manual_workout_context_enabled: boolean;
  manual_workout_notice_version: string | null;
  history_use: string;
  history_use_notice_version: string | null;
  consent_generation: string;
  history_generation: string;
  notice_version: string;
  active_request_id: string | null;
  active_attempt_id: string | null;
  lease_until: Date | null;
  request_day: Date | string | null;
  request_count: number;
};
type MessageRow = {
  id: string;
  request_id: string;
  role: ChatMessage["role"];
  text: string;
  actions: ChatAction[] | string;
  status: ChatMessage["status"];
  created_at: Date;
};
const messageView = (r: MessageRow): ChatMessage => ({
  id: r.id,
  requestId: r.request_id,
  role: r.role,
  text: r.text,
  actions: parse(r.actions),
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
});
export const compatibleMessage = (message: ChatMessage, workoutPlanDrafts: boolean): ChatMessage =>
  workoutPlanDrafts
    ? message
    : {
        ...message,
        actions: message.actions.filter((action) => action.kind !== "workout_plan"),
      };
const settingsView = (r: SettingsRow): ChatSettings => ({
  consentReviewed: r.consent_reviewed,
  cloudEnabled: r.cloud_enabled,
  fitnessContextEnabled: r.fitness_context_enabled,
  manualWorkoutContextEnabled:
    r.manual_workout_context_enabled &&
    r.manual_workout_notice_version === CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  historyUse:
    r.cloud_enabled &&
    r.history_use === "when_relevant" &&
    r.history_use_notice_version === CHAT_HISTORY_USE_NOTICE_VERSION
      ? "when_relevant"
      : "when_requested",
  historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
  consentGeneration: r.consent_generation,
  historyGeneration: r.history_generation,
  noticeVersion: CHAT_NOTICE_VERSION,
  providerAvailable: chatAvailable(),
  model: chatModel(),
});

async function owner(sql: Sql, userId: string, active = false) {
  const rows = await sql<{
    suspended_at: Date | null;
  }>`select suspended_at from profiles where id = ${userId} and deleted_at is null`;
  if (!rows.length) throw new ChatError(401, "Sign in again to continue.");
  if (active && rows[0].suspended_at) throw new ChatError(403, "Your account is paused.");
  return rows[0];
}
async function lockOwner(sql: Sql, userId: string) {
  const rows = await sql`select id from "user" where id = ${userId} for update`;
  if (!rows.length) throw new ChatError(401, "Sign in again to continue.");
}
async function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    stop = () => reject(new ChatError(409, "Reply stopped. You can try again."));
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
  try {
    return await Promise.race([work, stopped]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
async function settings(sql: Sql, userId: string): Promise<SettingsRow> {
  await owner(sql, userId);
  await sql`insert into assistant_chat_settings (user_id, consent_generation, history_generation, notice_version)
    values (${userId}, ${randomUUID()}, ${randomUUID()}, ${CHAT_NOTICE_VERSION}) on conflict (user_id) do nothing`;
  const [row] =
    await sql<SettingsRow>`select * from assistant_chat_settings where user_id = ${userId}`;
  return row;
}
async function prune(sql: Sql, userId: string, now: number) {
  await sql`delete from assistant_chat_messages where user_id = ${userId} and created_at < ${iso(now - RETENTION_DAYS * DAY)}`;
  await sql`delete from assistant_chat_messages where user_id = ${userId} and id in
    (select id from assistant_chat_messages where user_id = ${userId} order by created_at desc, id desc offset 80)`;
}
export async function getHistory(sql: Sql, userId: string, now = Date.now()): Promise<ChatHistory> {
  await settings(sql, userId);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const [row] =
      await tx<SettingsRow>`select * from assistant_chat_settings where user_id = ${userId} for update`;
    if (!row) throw new ChatError(401, "Sign in again to continue.");
    await prune(tx, userId, now);
    const rows =
      await tx<MessageRow>`select * from assistant_chat_messages where user_id = ${userId} order by created_at desc, id desc limit 40`;
    return { settings: settingsView(row), messages: rows.reverse().map(messageView) };
  });
}
export async function setSettings(sql: Sql, userId: string, body: unknown, now = Date.now()) {
  const input = settingsInput.parse(body);
  await settings(sql, userId);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const [current] =
      await tx<SettingsRow>`select * from assistant_chat_settings where user_id = ${userId} for update`;
    if (
      (input.initialSetup && current.consent_reviewed) ||
      (input.expectedConsentGeneration &&
        input.expectedConsentGeneration !== current.consent_generation)
    )
      throw new ChatError(
        409,
        "Your conversation settings changed. Refresh and review them again.",
      );
    await owner(tx, userId, input.cloudEnabled);
    // Omitted new fields cannot broaden history use. Older clients preserve an
    // already accepted mode only while cloud remains enabled.
    const historyUse = input.cloudEnabled
      ? (input.historyUse ?? settingsView(current).historyUse)
      : "when_requested";
    // Every consent update invalidates in-flight requests and deletes prior context.
    await tx`delete from assistant_chat_messages where user_id = ${userId}`;
    const [row] = await tx<SettingsRow>`update assistant_chat_settings set consent_reviewed = true,
      cloud_enabled = ${input.cloudEnabled},
      fitness_context_enabled = ${input.fitnessContextEnabled}, fitness_context_used = false, consent_generation = ${randomUUID()}, history_generation = ${randomUUID()},
      manual_workout_context_enabled = ${input.manualWorkoutContextEnabled}, manual_workout_context_used = false,
      manual_workout_notice_version = ${input.manualWorkoutContextEnabled ? CHAT_MANUAL_WORKOUT_NOTICE_VERSION : null},
      history_use = ${historyUse},
      history_use_notice_version = ${historyUse === "when_relevant" ? CHAT_HISTORY_USE_NOTICE_VERSION : null},
      notice_version = ${CHAT_NOTICE_VERSION}, updated_at = ${iso(now)}, active_request_id = null, active_attempt_id = null, lease_until = null where user_id = ${userId} returning *`;
    return { settings: settingsView(row) };
  });
}

export const appTermsInput = z.object({ version: z.literal(APP_TERMS_VERSION) }).strict();

export async function getAppTerms(sql: Sql, userId: string): Promise<AppTermsStatus> {
  await owner(sql, userId);
  const [accepted] = await sql<{ version: string; accepted_at: Date | string }>`
    select version, accepted_at from app_terms_acceptances
    where user_id = ${userId} and version = ${APP_TERMS_VERSION}`;
  return {
    ownerId: userId,
    version: APP_TERMS_VERSION,
    accepted: Boolean(accepted),
    acceptedVersion: accepted?.version ?? null,
    acceptedAt: accepted ? new Date(accepted.accepted_at).toISOString() : null,
  };
}

/** Terms acceptance and fresh defaults commit together. Replays never re-grant. */
export async function acceptAppTerms(
  sql: Sql,
  userId: string,
  body: unknown,
  now = Date.now(),
): Promise<AppTermsStatus> {
  appTermsInput.parse(body);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const profile = await owner(tx, userId);
    const currentTerms = await getAppTerms(tx, userId);
    if (currentTerms.accepted) return currentTerms;

    let current = settingsView(await settings(tx, userId));
    if (!current.consentReviewed) {
      const enableCoaching = profile.suspended_at === null;
      const initialized = await setSettings(
        tx,
        userId,
        {
          cloudEnabled: enableCoaching,
          fitnessContextEnabled: enableCoaching,
          manualWorkoutContextEnabled: enableCoaching,
          manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
          noticeVersion: CHAT_NOTICE_VERSION,
          historyUse: enableCoaching ? "when_relevant" : "when_requested",
          historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
          initialSetup: true,
          expectedConsentGeneration: current.consentGeneration,
        },
        now,
      );
      current = initialized.settings;
    }
    // No row means no previous choice. Existing false, stale-notice and true
    // rows all remain unchanged, including their rate limits and generations.
    await tx`insert into fitness_consents (user_id, enabled, generation, notice_version, updated_at)
      values (${userId}, ${profile.suspended_at === null}, ${randomUUID()}, ${FITNESS_AI_NOTICE_VERSION}, ${iso(now)})
      on conflict (user_id) do nothing`;
    const [fitness] = await tx<{ generation: string }>`
      select generation from fitness_consents where user_id = ${userId}`;
    await tx`insert into app_terms_acceptances
      (user_id, version, accepted_at, assistant_consent_generation, fitness_consent_generation)
      values (${userId}, ${APP_TERMS_VERSION}, ${iso(now)}, ${current.consentGeneration}, ${fitness.generation})`;
    const { initializeAgentContactsFromTerms } = await import("../agents/contact.server.ts");
    await initializeAgentContactsFromTerms(tx, userId, now);
    return getAppTerms(tx, userId);
  });
}
export async function clearHistory(sql: Sql, userId: string, now = Date.now()) {
  await settings(sql, userId);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    await tx`select user_id from assistant_chat_settings where user_id = ${userId} for update`;
    await tx`delete from assistant_chat_messages where user_id = ${userId}`;
    const [row] =
      await tx<SettingsRow>`update assistant_chat_settings set history_generation = ${randomUUID()}, fitness_context_used = false, manual_workout_context_used = false, updated_at = ${iso(now)}, active_request_id = null, active_attempt_id = null, lease_until = null where user_id = ${userId} returning *`;
    return { settings: settingsView(row), messages: [] };
  });
}

export async function pruneConversations(sql: Sql, now = Date.now()) {
  await sql`delete from assistant_chat_messages where created_at < ${iso(now - RETENTION_DAYS * DAY)}`;
  await sql`update assistant_chat_settings set active_request_id = null, active_attempt_id = null, lease_until = null where lease_until < ${iso(now)}`;
}

export async function readChatBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_CHAT_BODY_BYTES)
    throw new ChatError(413, "Message is too large.");
  if (!request.body) throw new ChatError(400, "Enter a message.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHAT_BODY_BYTES) {
        await reader.cancel();
        throw new ChatError(413, "Message is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ChatError(400, "Body must be JSON.");
  }
}

/** Turns are serialized per owner; idempotency is scoped to that owner and history generation. */
export async function chatResponse(
  sql: Sql,
  userId: string,
  body: unknown,
  requestSignal: AbortSignal,
  options: { provider?: ChatProvider; now?: () => number; available?: boolean } = {},
): Promise<Response> {
  const input = turnInput.parse(body);
  const now = options.now ?? Date.now;
  const provider = options.provider ?? gatewayChatProvider;
  if (!(options.available ?? chatAvailable()))
    throw new ChatError(
      503,
      "Cloud conversation is not available yet. You can still use the planning tools.",
    );
  await settings(sql, userId);
  const startedAt = now();
  const attemptId = randomUUID();
  const reserved = await sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const [row] = await tx<
      SettingsRow & { current_day: boolean }
    >`select *, (request_day = ${iso(startedAt).slice(0, 10)}::date) as current_day from assistant_chat_settings where user_id = ${userId} for update`;
    await owner(tx, userId, true);
    if (!row.cloud_enabled || row.notice_version !== CHAT_NOTICE_VERSION)
      throw new ChatError(403, "Enable cloud conversation first.");
    if (
      row.consent_generation !== input.consentGeneration ||
      row.history_generation !== input.historyGeneration
    )
      throw new ChatError(409, "Your conversation settings changed. Refresh and try again.");
    const existing =
      await tx<MessageRow>`select * from assistant_chat_messages where user_id = ${userId} and request_id = ${input.requestId}`;
    const previous = existing.find((m) => m.role === "user");
    if (previous && previous.text !== input.text)
      throw new ChatError(409, "Use a new message identifier for an edited message.");
    const completed = existing.find((m) => m.role === "assistant" && m.status === "complete");
    if (completed) return { row, completed: messageView(completed) };
    if (row.active_request_id && row.lease_until && +new Date(row.lease_until) > startedAt)
      throw new ChatError(
        409,
        "A reply is still being prepared. Stop it or wait before trying again.",
      );
    const today = iso(startedAt).slice(0, 10);
    const count = row.current_day ? row.request_count : 0;
    if (count >= 50)
      throw new ChatError(
        429,
        "You have reached today's assistant limit. Your planning tools are still available.",
      );
    await tx`update assistant_chat_settings set active_request_id = ${input.requestId}, active_attempt_id = ${attemptId}, lease_until = ${iso(startedAt + 60_000)}, request_day = ${today}, request_count = ${count + 1} where user_id = ${userId}`;
    await tx`insert into assistant_chat_messages (user_id,id,request_id,role,text,status,created_at)
      values (${userId},${randomUUID()},${input.requestId},'user',${input.text},'interrupted',${iso(startedAt)}) on conflict(user_id,request_id,role) do nothing`;
    return { row, completed: null };
  });
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  requestSignal.addEventListener("abort", onAbort, { once: true });
  if (requestSignal.aborted) abort.abort();
  const timeout = setTimeout(() => abort.abort(), 45_000);
  let closed = false;
  let text = "";
  const actions: ChatAction[] = [];
  let toolCalls = 0;
  let fitnessSnapshot: string | null = null;
  let manualSnapshot: string | null = null;
  const assertCurrent = async () => {
    if (abort.signal.aborted) throw new ChatError(409, "Reply stopped. You can try again.");
    const [r] =
      await sql<SettingsRow>`select s.* from assistant_chat_settings s join profiles p on p.id = s.user_id
      where s.user_id = ${userId} and p.deleted_at is null and p.suspended_at is null`;
    if (
      !r?.cloud_enabled ||
      r.consent_generation !== input.consentGeneration ||
      r.history_generation !== input.historyGeneration ||
      (!reserved.completed &&
        (r.active_request_id !== input.requestId || r.active_attempt_id !== attemptId))
    )
      throw new ChatError(409, "Your conversation changed. Refresh to continue.");
  };
  const workoutContext = async (tx: Sql) => {
    if (!reserved.row.fitness_context_enabled || process.env.HEALTH_SYNC_ENABLED !== "true")
      return null;
    const [connection] = await tx<{
      generation: string;
      types: string[];
    }>`select generation, types from health_connections where user_id = ${userId}`;
    const { workouts } = await listWorkouts(tx, userId, { limit: 5 });
    return {
      connection: connection ?? null,
      summaries: workouts.map((w) => ({
        id: w.id,
        revision: w.revision,
        activity: w.record.activity,
        startAt: w.record.startAt,
        durationSeconds: w.record.durationSeconds,
        distanceMeters: w.record.distanceMeters,
        activeEnergyKilocalories: w.record.activeEnergyKilocalories,
        heartRate: w.heartRate,
      })),
    };
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      };
      const addAction = async (action: Omit<ChatAction, "id">) => {
        await assertCurrent();
        const id = digest(action).slice(0, 24);
        if (!actions.some((a) => a.id === id) && actions.length < 12) {
          const value = { ...action, id };
          actions.push(value);
          emit({ type: "action", action: value });
        }
      };
      const toolGuard = async () => {
        await assertCurrent();
        if (++toolCalls > 6) throw new ChatError(429, "Please narrow your request.");
      };
      try {
        await assertCurrent();
        emit({ type: "start", requestId: input.requestId });
        if (reserved.completed) {
          emit({ type: "delta", text: reserved.completed.text });
          const compatible = compatibleMessage(
            reserved.completed,
            input.workoutPlanDrafts === true,
          );
          for (const action of compatible.actions) emit({ type: "action", action });
          emit({ type: "done", message: compatible });
          return;
        }
        const history = await getHistory(sql, userId, startedAt);
        const messages = conversationContext(history.messages, input);
        await assertCurrent();
        await withAbort(
          provider({
            messages,
            historyUse: settingsView(reserved.row).historyUse,
            signal: abort.signal,
            onText: async (delta) => {
              await assertCurrent();
              if (text.length + delta.length > 12000)
                throw new ChatError(400, "The reply was too long. Try a narrower question.");
              text += delta;
              emit({ type: "delta", text: delta });
            },
            tools: {
              ...(input.workoutPlanDrafts
                ? {
                    draftWorkoutPlan: async (draft: unknown) => {
                      await toolGuard();
                      if (actions.some((action) => action.kind === "workout_plan"))
                        return { reviewOffered: true, saved: false, reason: "One plan per reply." };
                      const workoutPlanDraft = workoutPlanDraftInput.parse(draft);
                      await addAction({
                        kind: "workout_plan",
                        label: "Review workout plan",
                        description:
                          "Check the exercises, sets and instructions before saving your private plan.",
                        workoutPlanDraft,
                      });
                      return { reviewOffered: true, saved: false, shared: false, completed: false };
                    },
                  }
                : {}),
              draftPreferences: async (draft) => {
                await toolGuard();
                if (process.env.A2A_ENABLED !== "true") return { available: false };
                const preferenceDraft = preferenceDraftInput.parse(draft);
                await addAction({
                  kind: "preferences",
                  label: "Review suggested preferences",
                  description: "Edit these suggestions, then choose whether to save them.",
                  preferenceDraft,
                });
                return { reviewOffered: true, saved: false, sharingChanged: false };
              },
              planning: async () => {
                await toolGuard();
                if (process.env.A2A_ENABLED !== "true") return { available: false };
                const p = await getPreferences(sql, userId);
                const matching = await getAgentMatching(sql, userId);
                await assertCurrent();
                await addAction({
                  kind: "preferences",
                  label: "Review planning preferences",
                  description: "Choose your times, activity and public meeting places.",
                });
                return {
                  preferences: {
                    enabled: p.enabled,
                    activity: p.activity,
                    ability: p.ability,
                    durationMin: p.durationMin,
                    availability: p.availability,
                    approvedIntent: p.approvedIntent,
                  },
                  matching: {
                    enabled: matching.enabled,
                    ready: matching.ready,
                    reason: matching.reason,
                    needs: matching.needs,
                    lastCheckedAt: matching.lastCheckedAt,
                  },
                };
              },
              sessions: async () => {
                await toolGuard();
                const { sessions } = await listPublicSessions(sql, userId);
                const upcoming = sessions.filter((s) => +new Date(s.startAt) > now()).slice(0, 8);
                for (const s of upcoming)
                  await addAction({
                    kind: "session",
                    targetId: s.id,
                    label: s.title.slice(0, 120),
                    description: "Review this session and its current availability.",
                  });
                return {
                  sessions: upcoming.map((s) => ({
                    title: s.title,
                    activity: s.activity,
                    startAt: s.startAt,
                    durationMin: s.durationMin,
                    ability: s.ability,
                  })),
                };
              },
              workouts: async () => {
                await toolGuard();
                const context = await sql.transaction(async (tx) => {
                  await lockOwner(tx, userId);
                  const changed =
                    await tx`update assistant_chat_settings set fitness_context_used = true
                  where user_id = ${userId} and fitness_context_enabled and cloud_enabled and active_attempt_id = ${attemptId}
                    and consent_generation = ${input.consentGeneration} and history_generation = ${input.historyGeneration} returning user_id`;
                  return changed.length ? workoutContext(tx) : null;
                });
                if (context === null)
                  return {
                    available: false,
                    reason:
                      "Separate fitness context permission is off. Ask the member to enable it if they want to share summaries.",
                  };
                const { summaries } = context;
                fitnessSnapshot = digest(context);
                await assertCurrent();
                for (const w of summaries)
                  await addAction({
                    kind: "workout",
                    targetId: w.id,
                    label: "Review recorded workout",
                    description: `${w.activity} · ${new Date(w.startAt).toISOString().slice(0, 10)}`,
                  });
                return {
                  summaries,
                  limitation:
                    "Recorded observations, not a medical assessment. Missing measurements stay unknown.",
                };
              },
              manualWorkouts: async () => {
                await toolGuard();
                const snapshot = await sql.transaction(async (tx) => {
                  await lockOwner(tx, userId);
                  const changed =
                    await tx`update assistant_chat_settings set manual_workout_context_used = true
                    where user_id = ${userId} and manual_workout_context_enabled
                      and manual_workout_notice_version = ${CHAT_MANUAL_WORKOUT_NOTICE_VERSION}
                      and cloud_enabled and active_attempt_id = ${attemptId}
                      and consent_generation = ${input.consentGeneration}
                      and history_generation = ${input.historyGeneration} returning user_id`;
                  return changed.length ? readManualWorkoutContext(tx, userId, startedAt) : null;
                });
                if (snapshot === null)
                  return {
                    available: false,
                    reason:
                      "Separate manual workout context permission is off. Ask the member to review that permission before sharing saved plans or entered results.",
                  };
                manualSnapshot = digest(snapshot);
                await assertCurrent();
                return snapshot.context;
              },
              review: async (kind) => {
                await toolGuard();
                if (kind !== "fitness" && process.env.A2A_ENABLED !== "true")
                  return { available: false };
                const labels = {
                  preferences: [
                    "Review planning preferences",
                    "Choose your activity, times and venues.",
                  ],
                  discovery: [
                    "Find workout partners",
                    "Review automatic matching status and your saved planning preferences.",
                  ],
                  fitness: [
                    "Review an exercise log",
                    "Enter or correct the exercise and sets before saving.",
                  ],
                };
                await addAction({ kind, label: labels[kind][0], description: labels[kind][1] });
                return { reviewOffered: true, saved: false, booked: false };
              },
            },
          }),
          abort.signal,
        );
        await assertCurrent();
        if (!text.trim())
          throw new ChatError(503, "The assistant could not finish a reply. Please try again.");
        const completed = await sql.transaction(async (tx) => {
          await lockOwner(tx, userId);
          const [r] =
            await tx<SettingsRow>`select * from assistant_chat_settings where user_id = ${userId} for update`;
          await owner(tx, userId, true);
          if (
            !r.cloud_enabled ||
            r.consent_generation !== input.consentGeneration ||
            r.history_generation !== input.historyGeneration ||
            r.active_request_id !== input.requestId ||
            r.active_attempt_id !== attemptId ||
            abort.signal.aborted
          )
            throw new ChatError(409, "Your conversation changed. Refresh to continue.");
          if (fitnessSnapshot !== null && digest(await workoutContext(tx)) !== fitnessSnapshot)
            throw new ChatError(
              409,
              "Your workout records changed. Ask again for an up-to-date summary.",
            );
          if (
            manualSnapshot !== null &&
            digest(await readManualWorkoutContext(tx, userId, startedAt)) !== manualSnapshot
          )
            throw new ChatError(
              409,
              "Your manual workout records changed. Ask again for an up-to-date reply.",
            );
          const [m] =
            await tx<MessageRow>`insert into assistant_chat_messages (user_id,id,request_id,role,text,actions,status,created_at)
            values (${userId},${randomUUID()},${input.requestId},'assistant',${text},${JSON.stringify(actions)}::jsonb,'complete',${iso(Math.max(now(), startedAt + 1))}) returning *`;
          await tx`update assistant_chat_messages set status = 'complete' where user_id = ${userId} and request_id = ${input.requestId} and role = 'user'`;
          return messageView(m);
        });
        emit({ type: "done", message: completed });
      } catch (error) {
        abort.abort();
        // Never echo an SDK/database error or private provider payload.
        emit({
          type: "error",
          message:
            error instanceof ChatError
              ? error.message
              : "The assistant is unavailable right now. Try again, or use the planning tools.",
        });
      } finally {
        clearTimeout(timeout);
        requestSignal.removeEventListener("abort", onAbort);
        if (!reserved.completed)
          await sql`update assistant_chat_settings set active_request_id = null, active_attempt_id = null, lease_until = null
          where user_id = ${userId} and active_request_id = ${input.requestId} and active_attempt_id = ${attemptId} and consent_generation = ${input.consentGeneration} and history_generation = ${input.historyGeneration}`.catch(
            () => {},
          );
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
    },
  });
}
