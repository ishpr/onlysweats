import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { ensureProfile } from "../pace/service.server.ts";
import { CHAT_NOTICE_VERSION, type ChatEvent } from "../../../shared/conversation.ts";
import { isAIWorkoutPlanDraft } from "../../../shared/workout-plan-draft.ts";
import { createGatewayChatProvider, type ChatTools } from "./provider.server.ts";
import { chatResponse, compatibleMessage, getHistory, setSettings } from "./service.server.ts";
import {
  normalizeWorkoutPlanModelDraft,
  workoutPlanDraftInput,
  workoutPlanModelInput,
} from "./plan-draft.ts";

const draft = {
  title: "Bodyweight circuit",
  activity: "strength" as const,
  instructions: "Review the routine before starting.",
  exercises: [
    {
      name: "Squat",
      instructions: "Stand comfortably and move through your chosen range.",
      sets: 3,
      reps: 8,
      durationSeconds: null,
      restSeconds: 60,
    },
    {
      name: "Plank",
      instructions: "Hold a comfortable position and breathe normally.",
      sets: 2,
      reps: null,
      durationSeconds: 20,
      restSeconds: 45,
    },
  ],
};
let sql: Sql;
before(async () => {
  sql = await makeDb();
});
describe("structured cloud workout draft boundary", () => {
  it("converts explicitly selected minutes in code and rejects impossible target combinations", () => {
    const modelDraft = {
      title: "Walking",
      activity: "walk" as const,
      instructions: "Planned walking intervals.",
      exercises: [
        {
          name: "Walk",
          instructions: "Walk for five minutes.",
          sets: 1,
          targetUnit: "minutes" as const,
          targetAmount: 5,
          restSeconds: 0,
        },
      ],
    };
    const normalized = normalizeWorkoutPlanModelDraft(modelDraft);
    assert.equal(normalized.exercises[0].durationSeconds, 300);
    assert.equal(normalized.exercises[0].reps, null);
    assert.equal(isAIWorkoutPlanDraft(normalized), true);
    for (const targetAmount of [0, -1, 0.5, 1441, Infinity])
      assert.throws(() =>
        normalizeWorkoutPlanModelDraft({
          ...modelDraft,
          exercises: [{ ...modelDraft.exercises[0], targetAmount }],
        }),
      );
    assert.equal(
      workoutPlanModelInput.safeParse({
        ...modelDraft,
        exercises: [{ ...modelDraft.exercises[0], targetUnit: "calories" }],
      }).success,
      false,
    );
    assert.throws(() =>
      normalizeWorkoutPlanModelDraft({
        ...modelDraft,
        exercises: [{ ...modelDraft.exercises[0], targetUnit: "repetitions", targetAmount: 1001 }],
      }),
    );
  });
  it("shares schema bounds across provider, editor and streaming validation", () => {
    assert.equal(workoutPlanDraftInput.safeParse(draft).success, true);
    assert.equal(isAIWorkoutPlanDraft(draft), true);
    for (const bad of [
      { ...draft, completed: true },
      { ...draft, exercises: [{ ...draft.exercises[0], weight: 100 }] },
      { ...draft, exercises: [{ ...draft.exercises[0], reps: null }] },
      {
        ...draft,
        exercises: Array.from({ length: 7 }, () => ({ ...draft.exercises[0], sets: 20 })),
      },
    ]) {
      assert.equal(workoutPlanDraftInput.safeParse(bad).success, false);
      assert.equal(isAIWorkoutPlanDraft(bad), false);
    }
  });
  it("only offers an unsaved review card to a capable client, with no activity or shared data written", async () => {
    const id = randomUUID();
    await sql`insert into "user"(id,name,email,"emailVerified") values (${id},'Plan fixture',${`${id}@example.test`},true)`;
    await ensureProfile(sql, { id, name: "Plan fixture", email: `${id}@example.test` });
    const { settings } = await setSettings(sql, id, {
      cloudEnabled: true,
      fitnessContextEnabled: false,
      noticeVersion: CHAT_NOTICE_VERSION,
    });
    const response = await chatResponse(
      sql,
      id,
      {
        requestId: randomUUID(),
        text: "Draft a bodyweight circuit",
        workoutPlanDrafts: true,
        consentGeneration: settings.consentGeneration,
        historyGeneration: settings.historyGeneration,
      },
      new AbortController().signal,
      {
        available: true,
        provider: async ({ tools, onText }) => {
          assert.ok(tools.draftWorkoutPlan);
          assert.deepEqual(await tools.draftWorkoutPlan(draft), {
            reviewOffered: true,
            saved: false,
            shared: false,
            completed: false,
          });
          await tools.draftWorkoutPlan(draft);
          await onText("Review this suggested workout in the editor.");
        },
      },
    );
    const events: ChatEvent[] = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const final = events.at(-1);
    assert.ok(final?.type === "done");
    assert.equal(final.message.actions.length, 1);
    assert.deepEqual(final.message.actions[0].workoutPlanDraft, draft);
    assert.deepEqual(compatibleMessage(final.message, false).actions, []);
    for (const table of ["workout_plans", "workout_runs", "fitness_strength_logs"]) {
      const [{ count }] = await sql.query<{ count: number }>(
        `select count(*)::int count from ${table} where user_id = $1`,
        [id],
      );
      assert.equal(count, 0);
    }
    assert.equal((await getHistory(sql, id)).messages.at(-1)?.actions.length, 1);
    await setSettings(sql, id, {
      cloudEnabled: false,
      fitnessContextEnabled: false,
      noticeVersion: CHAT_NOTICE_VERSION,
    });
    assert.equal((await getHistory(sql, id)).messages.length, 0);
  });
  it("the real SDK validates plan arguments before invoking the review tool", async () => {
    let invoked = false;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "tool-call",
              toolCallId: "plan",
              toolName: "draftWorkoutPlan",
              input: JSON.stringify({ ...draft, shareAccountability: true }),
            });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool-calls" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      }),
    });
    const empty = async () => ({});
    const tools: ChatTools = {
      planning: empty,
      sessions: empty,
      workouts: empty,
      review: empty,
      draftPreferences: empty,
      draftWorkoutPlan: async () => {
        invoked = true;
        return {};
      },
    };
    await assert.rejects(
      createGatewayChatProvider(() => model)({
        messages: [{ role: "user", text: "Make a plan" }],
        signal: new AbortController().signal,
        tools,
        onText: async () => {},
      }),
      /Conversation unavailable/,
    );
    assert.equal(invoked, false);
    assert.equal(model.doStreamCalls.length, 1);
  });
  it("the real SDK hands normalized prescriptions to review and strips tool errors", async () => {
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const input = {
      title: "Walk",
      activity: "walk",
      instructions: "Review first.",
      exercises: [
        {
          name: "Walk",
          instructions: "Walk for five minutes.",
          sets: 1,
          targetUnit: "minutes",
          targetAmount: 5,
          restSeconds: 0,
        },
      ],
    };
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "tool-call",
              toolCallId: "plan",
              toolName: "draftWorkoutPlan",
              input: JSON.stringify(input),
            });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool-calls" },
              usage,
            });
            controller.close();
          },
        }),
      }),
    });
    const empty = async () => ({});
    let invoked = false;
    await assert.rejects(
      createGatewayChatProvider(() => model)({
        messages: [{ role: "user", text: "Suggest a five minute walk" }],
        signal: new AbortController().signal,
        onText: async () => {},
        tools: {
          planning: empty,
          sessions: empty,
          workouts: empty,
          review: empty,
          draftPreferences: empty,
          draftWorkoutPlan: async (normalized) => {
            invoked = true;
            assert.equal(normalized.exercises[0].durationSeconds, 300);
            assert.equal(normalized.exercises[0].reps, null);
            throw new Error("PRIVATE_PLAN_SQL_ERROR");
          },
        },
      }),
      /Conversation unavailable/,
    );
    assert.equal(invoked, true);
    assert.equal(model.doStreamCalls.length, 1);
    assert.equal(JSON.stringify(model.doStreamCalls).includes("PRIVATE_PLAN_SQL_ERROR"), false);
  });
});
