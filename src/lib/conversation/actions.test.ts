import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { PaceError } from "../pace/service.server.ts";
import { fixtureMember, fixturePlan, completedSet } from "../workout-plans/fixtures.ts";
import * as workouts from "../workout-plans/service.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import {
  CHAT_NOTICE_VERSION,
  type ChatAction,
  type ChatEvent,
  type ChatSettings,
} from "../../../shared/conversation.ts";
import { isAgentChatCard } from "../../../shared/agent-cards.ts";
import {
  executeChatAction,
  storeChatActions,
  actionExecutionInput,
  CHAT_ACTION_TTL_MS,
  type PendingChatAction,
} from "./actions.server.ts";
import { prepareAgentTool, type PreparedAgentCard } from "./agent-tools.server.ts";
import { getPrivateGoal, savePrivateGoal } from "./private-goals.server.ts";
import {
  acceptAppTerms,
  clearHistory,
  getHistory,
  setSettings,
  ChatError,
  chatResponse,
} from "./service.server.ts";

let sql: Sql;
const now = Date.parse("2026-09-22T12:00:00.000Z");
const iso = (time: number) => new Date(time).toISOString();
const context = {
  now,
  timeZone: "America/Chicago",
  readManualWorkouts: async () => ({ available: false }),
  readWorkoutSummaries: async () => ({ available: false }),
};
before(async () => {
  sql = await makeDb();
});

async function member() {
  const id = await fixtureMember(sql, "Synthetic action member");
  await acceptAppTerms(sql, id, { version: APP_TERMS_VERSION }, now);
  return { id, settings: (await getHistory(sql, id, now)).settings };
}
const generations = (settings: ChatSettings) => ({
  consentGeneration: settings.consentGeneration,
  historyGeneration: settings.historyGeneration,
});
async function goalDraft(id: string) {
  const { drafts } = await prepareAgentTool(
    sql,
    id,
    "setGoal",
    {
      label: "Synthetic walk goal",
      activity: "walk",
      date: "2026-10-01",
    },
    context,
  );
  return drafts[0];
}
async function store(id: string, settings: ChatSettings, draft: PreparedAgentCard, at = now) {
  const actionId = randomUUID(),
    messageId = randomUUID();
  const pending: PendingChatAction = { ...draft, id: actionId };
  const action: ChatAction = {
    id: actionId,
    kind: "agent_card",
    label: draft.label,
    description: draft.description,
    card: draft.card,
  };
  await sql.transaction(async (tx) => {
    await tx`insert into assistant_chat_messages(id,user_id,request_id,role,text,actions,status,created_at)
      values(${messageId},${id},${randomUUID()},'assistant','Review this synthetic card.',
      ${JSON.stringify([action])}::jsonb,'complete',${iso(at)})`;
    await storeChatActions(tx, id, messageId, generations(settings), [pending], at);
  });
  return { actionId, messageId, action, pending };
}
const rejected = (operation: Promise<unknown>, status: number) =>
  assert.rejects(
    operation,
    (error) =>
      (error instanceof PaceError || error instanceof ChatError) && error.status === status,
  );

/** Preserve a real transaction while injecting one failure after the domain write. */
function failReceiptWrite(base: Sql): Sql {
  const matches = (text: string) => /update assistant_chat_actions set receipt\s*=/.test(text);
  const wrapped = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (matches(strings.join("?"))) throw new Error("Synthetic receipt storage failure");
    return base(strings, ...values);
  }) as Sql;
  wrapped.query = async <T>(text: string, params?: unknown[]) => {
    if (matches(text)) throw new Error("Synthetic receipt storage failure");
    return base.query<T>(text, params);
  };
  wrapped.transaction = (fn) => base.transaction((tx) => fn(failReceiptWrite(tx)));
  return wrapped;
}

describe("durable member-reviewed assistant actions", () => {
  it("persists drafts without mutation and executes a goal once across duplicate and lost-response retries", async () => {
    const { id, settings } = await member();
    const { actionId } = await store(id, settings, await goalDraft(id));
    assert.equal(await getPrivateGoal(sql, id), null);
    const body = generations(settings);
    const [first, duplicate] = await Promise.all([
      executeChatAction(sql, id, actionId, body, now + 1),
      executeChatAction(sql, id, actionId, body, now + 2),
    ]);
    assert.deepEqual(duplicate.receipt, first.receipt);
    const retry = await executeChatAction(sql, id, actionId, body, now + CHAT_ACTION_TTL_MS + 1);
    assert.deepEqual(retry.receipt, first.receipt);
    assert.equal((await getPrivateGoal(sql, id))?.revision, 1);
    assert.equal(
      (
        await sql`select 1 from assistant_chat_messages where user_id=${id} and text=${first.receipt.text}`
      ).length,
      1,
    );
    const [saved] =
      await sql`select command,card,executing,receipt from assistant_chat_actions where id=${actionId}`;
    assert.deepEqual(saved.command, {});
    assert.deepEqual(saved.card, {});
    assert.equal(saved.executing, false);
    assert.deepEqual(saved.receipt, first.receipt);
  });

  it("projects completed receipts into old cards without another executable button", async () => {
    const { id, settings } = await member();
    const { actionId } = await store(id, settings, await goalDraft(id));
    const result = await executeChatAction(sql, id, actionId, generations(settings), now + 1);
    const history = await getHistory(sql, id, now + 2);
    const card = history.messages
      .flatMap((message) => message.actions)
      .find((action) => action.id === actionId)?.card;
    assert.ok(card);
    assert.equal(card.primaryLabel, null);
    assert.equal(card.input, undefined);
    assert.deepEqual(card.receipt, {
      text: result.receipt.text,
      createdAt: result.receipt.createdAt,
    });
    assert.equal(isAgentChatCard(card), true);
  });

  it("rejects another owner, stale permission/history generations, expired cards and unfinished replies", async () => {
    const { id, settings } = await member();
    const other = await member();
    const { actionId, messageId } = await store(id, settings, await goalDraft(id));
    await rejected(executeChatAction(sql, other.id, actionId, generations(settings), now + 1), 410);
    await rejected(
      executeChatAction(
        sql,
        id,
        actionId,
        { ...generations(settings), consentGeneration: randomUUID() },
        now + 1,
      ),
      409,
    );
    await rejected(
      executeChatAction(
        sql,
        id,
        actionId,
        { ...generations(settings), historyGeneration: randomUUID() },
        now + 1,
      ),
      409,
    );
    await sql`update assistant_chat_settings set history_generation=${randomUUID()} where user_id=${id}`;
    await rejected(executeChatAction(sql, id, actionId, generations(settings), now + 1), 409);
    await sql`update assistant_chat_settings set history_generation=${settings.historyGeneration} where user_id=${id}`;
    await rejected(
      executeChatAction(sql, id, actionId, generations(settings), now + CHAT_ACTION_TTL_MS),
      410,
    );
    await sql`update assistant_chat_messages set status='interrupted' where id=${messageId}`;
    await rejected(executeChatAction(sql, id, actionId, generations(settings), now + 1), 410);
    assert.equal(await getPrivateGoal(sql, id), null);
  });

  it("cannot use the execution body to override the saved command, owner or check-in evidence shape", async () => {
    const { id, settings } = await member();
    const { actionId } = await store(id, settings, await goalDraft(id));
    for (const extra of [
      { command: { kind: "goal", goal: { label: "Tampered" } } },
      { userId: randomUUID() },
      { actionId: randomUUID() },
      { interaction: { code: "1234", geo: { lat: 0, lng: 0 } } },
      { interaction: { geo: { lat: 91, lng: 0 } } },
      { interaction: { code: "123" } },
    ])
      await assert.rejects(
        executeChatAction(sql, id, actionId, { ...generations(settings), ...extra }, now + 1),
        z.ZodError,
      );
    assert.equal(
      actionExecutionInput.safeParse({ ...generations(settings), interaction: { code: "0123" } })
        .success,
      true,
    );
    await rejected(
      executeChatAction(
        sql,
        id,
        actionId,
        { ...generations(settings), interaction: { code: "0123" } },
        now + 1,
      ),
      400,
    );
    assert.equal(await getPrivateGoal(sql, id), null);
    assert.equal(
      (await sql`select executing from assistant_chat_actions where id=${actionId}`)[0].executing,
      false,
    );
  });

  it("requires current Terms, an active member and no running reply before execution", async () => {
    const { id, settings } = await member();
    const { actionId } = await store(id, settings, await goalDraft(id));
    await sql`delete from app_terms_acceptances where user_id=${id}`;
    await rejected(executeChatAction(sql, id, actionId, generations(settings), now + 1), 409);
    await acceptAppTerms(sql, id, { version: APP_TERMS_VERSION }, now + 2);
    await sql`update profiles set suspended_at=${iso(now)} where id=${id}`;
    await rejected(executeChatAction(sql, id, actionId, generations(settings), now + 3), 403);
    await sql`update profiles set suspended_at=null where id=${id}`;
    await sql`update assistant_chat_settings set active_request_id=${randomUUID()},lease_until=${iso(now + 60_000)} where user_id=${id}`;
    await rejected(executeChatAction(sql, id, actionId, generations(settings), now + 4), 409);
    assert.equal(await getPrivateGoal(sql, id), null);
  });

  it("rolls back execution state on a stale domain revision and the whole mutation if receipt storage fails", async () => {
    const { id, settings } = await member();
    const { actionId } = await store(id, settings, await goalDraft(id));
    await assert.rejects(
      executeChatAction(failReceiptWrite(sql), id, actionId, generations(settings), now + 1),
      /Synthetic receipt storage failure/,
    );
    assert.equal(await getPrivateGoal(sql, id), null);
    const [row] =
      await sql`select executing,receipt,command from assistant_chat_actions where id=${actionId}`;
    assert.equal(row.executing, false);
    assert.equal(row.receipt, null);
    assert.equal((row.command as { kind: string }).kind, "goal");
    await savePrivateGoal(
      sql,
      id,
      { label: "Newer member goal", activity: "walk", date: "2026-10-02" },
      0,
      now + 2,
    );
    await rejected(executeChatAction(sql, id, actionId, generations(settings), now + 3), 409);
    assert.equal((await getPrivateGoal(sql, id))?.label, "Newer member goal");
    assert.equal(
      (await sql`select executing,receipt from assistant_chat_actions where id=${actionId}`)[0]
        .executing,
      false,
    );
  });

  for (const change of ["clear", "revoke"] as const) {
    it(`${change} removes pending cards and completed receipts so neither can execute again`, async () => {
      const { id, settings } = await member();
      const done = await store(id, settings, await goalDraft(id));
      await executeChatAction(sql, id, done.actionId, generations(settings), now + 1);
      const pending = await store(id, settings, await goalDraft(id));
      if (change === "clear") await clearHistory(sql, id, now + 2);
      else
        await setSettings(
          sql,
          id,
          { cloudEnabled: false, fitnessContextEnabled: false, noticeVersion: CHAT_NOTICE_VERSION },
          now + 2,
        );
      for (const actionId of [done.actionId, pending.actionId])
        await rejected(executeChatAction(sql, id, actionId, generations(settings), now + 3), 410);
      assert.equal((await sql`select 1 from assistant_chat_actions where user_id=${id}`).length, 0);
      assert.equal((await getPrivateGoal(sql, id))?.revision, 1);
    });
  }

  it("saving and starting a plan survives its own history invalidation and returns the same receipt after a lost response", async () => {
    const { id, settings } = await member();
    const { drafts } = await prepareAgentTool(
      sql,
      id,
      "draftWorkoutPlan",
      {
        title: "Synthetic easy intervals",
        activity: "run",
        overview: "A future plan, not measured activity.",
        exercises: [
          {
            name: "Easy interval",
            instructions: "Choose your pace.",
            sets: 2,
            targetUnit: "seconds",
            targetAmount: 60,
            restSeconds: 30,
          },
        ],
      },
      context,
    );
    const saved = await store(id, settings, drafts[0]);
    const stale = await store(id, settings, await goalDraft(id));
    await sql`update assistant_chat_settings set manual_workout_context_used=true where user_id=${id}`;
    const first = await executeChatAction(sql, id, saved.actionId, generations(settings), now + 1);
    assert.notEqual(first.history.settings.historyGeneration, settings.historyGeneration);
    const workoutLink = first.history.messages
      .flatMap((message) => message.actions)
      .find((action) => action.kind === "workout_run");
    assert.equal(
      workoutLink?.targetId,
      drafts[0].command?.kind === "save_workout" ? drafts[0].command.runId : "missing",
    );
    assert.equal(first.history.settings.consentGeneration, settings.consentGeneration);
    assert.equal(first.history.messages.length, 1);
    assert.equal(first.history.messages[0].text, first.receipt.text);
    assert.equal(
      (await sql`select 1 from assistant_chat_actions where id=${stale.actionId}`).length,
      0,
    );
    assert.equal(
      (await sql`select 1 from assistant_chat_actions where id=${saved.actionId}`).length,
      1,
    );
    const retry = await executeChatAction(sql, id, saved.actionId, generations(settings), now + 2);
    assert.deepEqual(retry.receipt, first.receipt);
    const command = drafts[0].command;
    assert.ok(command?.kind === "save_workout");
    const run = await workouts.getRun(sql, id, command.runId);
    assert.equal(run.status, "in_progress");
    assert.deepEqual(run.results, []);
    assert.equal((await sql`select 1 from workout_plans where user_id=${id}`).length, 1);
    assert.equal((await sql`select 1 from workout_runs where user_id=${id}`).length, 1);
    await rejected(executeChatAction(sql, id, stale.actionId, generations(settings), now + 3), 410);
  });

  it("a reported set clears stale context once without duplicating its result or losing the retry receipt", async () => {
    const { id } = await member();
    const plan = await workouts.createPlan(sql, id, fixturePlan(), now);
    const run = await workouts.startRun(
      sql,
      id,
      { id: randomUUID(), planId: plan.id, expectedPlanRevision: plan.revision },
      now,
    );
    const settings = (await getHistory(sql, id, now)).settings;
    const { exerciseId: _exerciseId, setId: _setId, ...actual } = completedSet(run);
    const response = await chatResponse(
      sql,
      id,
      {
        ...generations(settings),
        requestId: randomUUID(),
        text: "Record my reported interval.",
        agentCards: true,
        timeZone: "America/Chicago",
        clientNow: iso(now),
      },
      new AbortController().signal,
      {
        available: true,
        now: () => now,
        provider: async ({ tools, onText }) => {
          assert.ok(tools.agent);
          await tools.agent("logSet", { runId: run.id, exerciseIndex: 0, setIndex: 0, actual });
          await onText("Review your entered set before saving.");
        },
      },
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as ChatEvent[];
    const final = events.at(-1);
    assert.ok(final?.type === "done");
    const saved = {
      actionId: final.message.actions.find((action) => action.kind === "agent_card")!.id,
    };
    assert.equal(
      (
        await sql`select manual_workout_context_used from assistant_chat_settings where user_id=${id}`
      )[0].manual_workout_context_used,
      true,
    );
    const stale = await store(id, settings, await goalDraft(id));
    const first = await executeChatAction(sql, id, saved.actionId, generations(settings), now + 1);
    const retry = await executeChatAction(sql, id, saved.actionId, generations(settings), now + 2);
    assert.deepEqual(first.receipt, retry.receipt);
    assert.notEqual(first.history.settings.historyGeneration, settings.historyGeneration);
    const updated = await workouts.getRun(sql, id, run.id);
    assert.equal(updated.revision, run.revision + 1);
    assert.deepEqual(updated.results, [completedSet(run)]);
    assert.equal(updated.shareAccountability, false);
    assert.equal(
      (await sql`select 1 from assistant_chat_actions where id=${stale.actionId}`).length,
      0,
    );
    await clearHistory(sql, id, now + 3);
    await rejected(executeChatAction(sql, id, saved.actionId, generations(settings), now + 4), 410);
  });
});
