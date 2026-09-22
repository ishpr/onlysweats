import assert from "node:assert/strict";
import { before, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import type { ChatMessage, ChatSettings } from "../../../shared/conversation.ts";
import { makeDb } from "../pace/test-db.ts";
import { fixtureMember } from "../workout-plans/fixtures.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import { acceptAppTerms, chatResponse, getHistory } from "./service.server.ts";
import { prepareAgentTool } from "./agent-tools.server.ts";
import { storeChatActions } from "./actions.server.ts";
import { readPendingWorkoutRecall } from "./pending-workout-context.server.ts";

let sql: Sql;
const now = Date.parse("2026-09-22T12:00:00Z");
const modelDraft = {
  title: "Unperformed circuit",
  activity: "strength",
  overview: "A future suggestion.",
  exercises: [
    {
      name: "Squat",
      instructions: "Choose your comfortable range.",
      sets: 3,
      targetUnit: "repetitions",
      targetAmount: 8,
      restSeconds: 60,
    },
  ],
};
before(async () => {
  sql = await makeDb();
});
const generations = (settings: ChatSettings) => ({
  requestId: randomUUID(),
  consentGeneration: settings.consentGeneration,
  historyGeneration: settings.historyGeneration,
});
async function member() {
  const id = await fixtureMember(sql);
  await acceptAppTerms(sql, id, { version: APP_TERMS_VERSION }, now);
  return { id, settings: (await getHistory(sql, id, now)).settings };
}
async function stored(id: string, settings: ChatSettings, at = now) {
  const result = await prepareAgentTool(sql, id, "draftWorkoutPlan", modelDraft, {
    now: at,
    timeZone: "America/Chicago",
    readManualWorkouts: async () => ({ available: false }),
    readWorkoutSummaries: async () => ({ available: false }),
  });
  const draft = result.drafts[0],
    actionId = randomUUID();
  const message: ChatMessage = {
    id: randomUUID(),
    requestId: randomUUID(),
    role: "assistant",
    text: "Review the draft.",
    status: "complete",
    createdAt: new Date(at).toISOString(),
    actions: [
      {
        id: actionId,
        kind: "agent_card",
        label: draft.label,
        description: draft.description,
        card: draft.card,
      },
    ],
  };
  await sql.transaction(async (tx) => {
    await tx`insert into assistant_chat_messages(id,user_id,request_id,role,text,actions,status,created_at)
      values(${message.id},${id},${message.requestId},'assistant',${message.text},
        ${JSON.stringify(message.actions)}::jsonb,'complete',${message.createdAt})`;
    await storeChatActions(tx, id, message.id, settings, [{ ...draft, id: actionId }], at);
  });
  return { message, actionId, command: draft.command };
}

it("recalls only planned targets from the pending server command, without reading/saving workout records", async () => {
  const { id, settings } = await member();
  const { message, actionId } = await stored(id, settings);
  const result = await readPendingWorkoutRecall(sql, id, [message], generations(settings), now + 1);
  assert.equal(result?.actionId, actionId);
  assert.equal(result.draft.exercises[0].sets, 3);
  assert.equal(result.draft.exercises[0].reps, 8);
  assert.equal(result.draft.exercises[0].durationSeconds, null);
  assert.doesNotMatch(JSON.stringify(result.draft), /runId|exerciseId|setId|"id"|actual|weight/);
  assert.equal((await sql`select 1 from workout_plans where user_id=${id}`).length, 0);
  assert.equal((await sql`select 1 from workout_runs where user_id=${id}`).length, 0);
});

it("never substitutes an older draft when the latest expires, executes or loses its record", async () => {
  const { id, settings } = await member();
  const older = await stored(id, settings),
    latest = await stored(id, settings, now + 1);
  const history = [older.message, latest.message],
    input = generations(settings);
  await sql`update assistant_chat_actions set expires_at=${new Date(now + 10).toISOString()} where id=${latest.actionId}`;
  assert.equal(await readPendingWorkoutRecall(sql, id, history, input, now + 10), null);
  await sql`update assistant_chat_actions set expires_at=${new Date(now + 1000).toISOString()},
    receipt='{}'::jsonb,executed_at=${new Date(now + 5).toISOString()} where id=${latest.actionId}`;
  assert.equal(await readPendingWorkoutRecall(sql, id, history, input, now + 10), null);
  await sql`delete from assistant_chat_actions where id=${latest.actionId}`;
  assert.equal(await readPendingWorkoutRecall(sql, id, history, input, now + 10), null);
});

it("fences source commands by owner, current settings, message completion and execution state", async () => {
  const { id, settings } = await member(),
    other = await member();
  const { message, actionId } = await stored(id, settings),
    input = generations(settings);
  assert.equal(await readPendingWorkoutRecall(sql, other.id, [message], input, now + 1), null);
  for (const field of ["consentGeneration", "historyGeneration"] as const)
    assert.equal(
      await readPendingWorkoutRecall(
        sql,
        id,
        [message],
        { ...input, [field]: randomUUID() },
        now + 1,
      ),
      null,
    );
  await sql`update assistant_chat_actions set executing=true where id=${actionId}`;
  assert.equal(await readPendingWorkoutRecall(sql, id, [message], input, now + 1), null);
  await sql`update assistant_chat_actions set executing=false where id=${actionId}`;
  await sql`update assistant_chat_messages set status='interrupted' where id=${message.id}`;
  assert.equal(await readPendingWorkoutRecall(sql, id, [message], input, now + 1), null);
  await sql`update assistant_chat_messages set status='complete' where id=${message.id}`;
  await sql`update assistant_chat_settings set history_generation=${randomUUID()} where user_id=${id}`;
  assert.equal(await readPendingWorkoutRecall(sql, id, [message], input, now + 1), null);
});

it("rejects malformed or richer commands instead of flattening load or nonuniform targets", async () => {
  const { id, settings } = await member();
  const { message, actionId, command } = await stored(id, settings),
    input = generations(settings);
  assert.ok(command?.kind === "save_workout");
  for (const replacement of [
    { ...command, actualResults: [{ reps: 100 }] },
    {
      ...command,
      plan: {
        ...command.plan,
        exercises: command.plan.exercises.map((e) => ({
          ...e,
          sets: e.sets.map((s) => ({ ...s, weight: 10, unit: "kg" })),
        })),
      },
    },
    {
      ...command,
      plan: {
        ...command.plan,
        exercises: command.plan.exercises.map((e) => ({
          ...e,
          sets: e.sets.map((s, index) => ({ ...s, reps: 8 + index })),
        })),
      },
    },
  ]) {
    await sql`update assistant_chat_actions set command=${JSON.stringify(replacement)}::jsonb where id=${actionId}`;
    assert.equal(await readPendingWorkoutRecall(sql, id, [message], input, now + 1), null);
  }
});

it("a new agent turn receives its latest unexecuted structured workout for revision", async () => {
  const { id, settings } = await member();
  const input = () => ({
    ...generations(settings),
    text: "Revise the second set",
    agentCards: true,
    workoutPlanDrafts: true,
    timeZone: "America/Chicago",
  });
  const first = await chatResponse(sql, id, input(), new AbortController().signal, {
    available: true,
    now: () => now + 1,
    provider: async ({ tools, onText }) => {
      await tools.agent!("draftWorkoutPlan", modelDraft);
      await onText("Review this draft.");
    },
  });
  assert.match(await first.text(), /"type":"done"/);
  let recalled = false;
  const second = await chatResponse(sql, id, input(), new AbortController().signal, {
    available: true,
    now: () => now + 3,
    provider: async ({ messages, onText }) => {
      const context = messages.find((message) =>
        message.text.startsWith("UNSAVED MODEL SUGGESTION"),
      );
      assert.ok(context);
      assert.match(context.text, /"name":"Squat"/);
      assert.match(context.text, /"sets":3,"reps":8/);
      assert.match(context.text, /planned targets, never actual results/);
      recalled = true;
      await onText("Review changes before saving.");
    },
  });
  assert.match(await second.text(), /"type":"done"/);
  assert.equal(recalled, true);
  assert.equal((await sql`select 1 from workout_runs where user_id=${id}`).length, 0);
});
