import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { fixtureMember, fixturePlan, completedSet } from "../workout-plans/fixtures.ts";
import * as workouts from "../workout-plans/service.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import {
  CHAT_NOTICE_VERSION,
  type ChatEvent,
  type ChatSettings,
} from "../../../shared/conversation.ts";
import {
  acceptAppTerms,
  chatResponse,
  compatibleMessage,
  getHistory,
  setSettings,
  turnInput,
  ChatError,
} from "./service.server.ts";
import { executeChatAction } from "./actions.server.ts";
import { createGatewayChatProvider, type ChatProvider, type ChatTools } from "./provider.server.ts";
import { agentToolDefinitions } from "./agent-tools.server.ts";
import { getPrivateGoal } from "./private-goals.server.ts";

let sql: Sql;
const now = Date.parse("2026-09-22T12:00:00.000Z");
const iso = (value: number) => new Date(value).toISOString();
const goal = { label: "Synthetic goal", activity: "walk", date: "2026-10-01" };
before(async () => {
  sql = await makeDb();
});
async function member() {
  const id = await fixtureMember(sql, "Synthetic agent capability member");
  await acceptAppTerms(sql, id, { version: APP_TERMS_VERSION }, now);
  return { id, settings: (await getHistory(sql, id, now)).settings };
}
function turn(settings: ChatSettings, agentCards?: boolean) {
  return {
    requestId: randomUUID(),
    text: "Help with my workout.",
    consentGeneration: settings.consentGeneration,
    historyGeneration: settings.historyGeneration,
    ...(agentCards === undefined ? {} : { agentCards }),
    timeZone: "America/Chicago",
    clientNow: iso(now + 600_000),
  };
}
async function events(response: Response): Promise<ChatEvent[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const options = (provider: ChatProvider) => ({ provider, available: true, now: () => now });

describe("agent action capabilities and completed-turn persistence", () => {
  it("only exposes agent tools to a capable client and filters replay cards for older clients", async () => {
    const { id, settings } = await member();
    for (const capable of [undefined, false, true]) {
      const input = turn(settings, capable);
      const output = await events(
        await chatResponse(
          sql,
          id,
          input,
          new AbortController().signal,
          options(async ({ tools, onText }) => {
            assert.equal(typeof tools.agent, capable ? "function" : "undefined");
            if (tools.agent) await tools.agent("setGoal", goal);
            await onText("Review the proposed goal.");
          }),
        ),
      );
      const final = output.at(-1);
      assert.ok(final?.type === "done");
      assert.equal(
        final.message.actions.filter((action) => action.kind === "agent_card").length,
        capable ? 1 : 0,
      );
      assert.deepEqual(compatibleMessage(final.message, true, false).actions, []);
      if (capable) {
        assert.equal(compatibleMessage(final.message, true, true).actions.length, 1);
        const replay = await events(
          await chatResponse(
            sql,
            id,
            { ...input, agentCards: false },
            new AbortController().signal,
            options(async () => assert.fail("A completed replay must not invoke the model")),
          ),
        );
        assert.equal(replay.filter((event) => event.type === "action").length, 0);
        const done = replay.at(-1);
        assert.ok(done?.type === "done");
        assert.deepEqual(done.message.actions, []);
      }
    }
    assert.equal(await getPrivateGoal(sql, id), null);
  });

  it("streamed drafts become executable rows only when the assistant turn completes", async () => {
    const { id, settings } = await member();
    const offered = latch(),
      release = latch();
    const response = await chatResponse(
      sql,
      id,
      turn(settings, true),
      new AbortController().signal,
      options(async ({ tools, onText }) => {
        await tools.agent!("setGoal", goal);
        offered.release();
        await release.promise;
        await onText("Review this goal before saving.");
      }),
    );
    await offered.promise;
    assert.equal((await sql`select 1 from assistant_chat_actions where user_id=${id}`).length, 0);
    assert.equal(
      (await sql`select 1 from assistant_chat_messages where user_id=${id} and role='assistant'`)
        .length,
      0,
    );
    assert.equal(await getPrivateGoal(sql, id), null);
    release.release();
    const output = await events(response);
    const final = output.at(-1);
    assert.ok(final?.type === "done");
    const action = final.message.actions.find((action) => action.kind === "agent_card")!;
    assert.equal((await sql`select 1 from assistant_chat_actions where id=${action.id}`).length, 1);
    assert.equal(await getPrivateGoal(sql, id), null);
    await executeChatAction(
      sql,
      id,
      action.id,
      {
        consentGeneration: settings.consentGeneration,
        historyGeneration: settings.historyGeneration,
      },
      now + 1,
    );
    assert.equal((await getPrivateGoal(sql, id))?.revision, 1);
  });

  it("aborting after a streamed card leaves no executable row or completed assistant message", async () => {
    const { id, settings } = await member();
    const offered = latch(),
      release = latch(),
      abort = new AbortController();
    const response = await chatResponse(
      sql,
      id,
      turn(settings, true),
      abort.signal,
      options(async ({ tools, onText }) => {
        await tools.agent!("setGoal", goal);
        offered.release();
        await release.promise;
        await onText("This stale reply must not publish.");
      }),
    );
    await offered.promise;
    abort.abort();
    release.release();
    const output = await events(response);
    assert.ok(output.some((event) => event.type === "action"));
    assert.equal(
      output.some((event) => event.type === "done"),
      false,
    );
    assert.equal(output.at(-1)?.type, "error");
    assert.equal((await sql`select 1 from assistant_chat_actions where user_id=${id}`).length, 0);
    assert.equal(
      (await sql`select 1 from assistant_chat_messages where user_id=${id} and role='assistant'`)
        .length,
      0,
    );
    assert.equal(await getPrivateGoal(sql, id), null);
  });

  for (const deleted of ["run", "plan"] as const) {
    it(`real logSet preparation marks its private source used; deleting the ${deleted} removes the card and source prose`, async () => {
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
      const output = await events(
        await chatResponse(
          sql,
          id,
          turn(settings, true),
          new AbortController().signal,
          options(async ({ tools, onText }) => {
            await tools.agent!("logSet", { runId: run.id, exerciseIndex: 0, setIndex: 0, actual });
            await onText("Review the entered interval quantity.");
          }),
        ),
      );
      const final = output.at(-1);
      assert.ok(final?.type === "done");
      const action = final.message.actions.find((action) => action.kind === "agent_card")!;
      assert.equal(
        (
          await sql`select manual_workout_context_used from assistant_chat_settings where user_id=${id}`
        )[0].manual_workout_context_used,
        true,
      );
      assert.deepEqual((await workouts.getRun(sql, id, run.id)).results, []);
      if (deleted === "run") await workouts.deleteRun(sql, id, run.id);
      else await workouts.deletePlan(sql, id, plan.id);
      const after = await getHistory(sql, id, now + 1);
      assert.notEqual(after.settings.historyGeneration, settings.historyGeneration);
      assert.deepEqual(after.messages, []);
      assert.equal(
        (await sql`select 1 from assistant_chat_actions where id=${action.id}`).length,
        0,
      );
      await assert.rejects(
        executeChatAction(
          sql,
          id,
          action.id,
          {
            consentGeneration: settings.consentGeneration,
            historyGeneration: settings.historyGeneration,
          },
          now + 2,
        ),
        (error) => error instanceof ChatError && error.status === 410,
      );
    });
  }

  it("knowing an owned run ID cannot bypass disabled manual-workout context", async () => {
    const { id } = await member();
    const plan = await workouts.createPlan(sql, id, fixturePlan(), now);
    const run = await workouts.startRun(
      sql,
      id,
      { id: randomUUID(), planId: plan.id, expectedPlanRevision: plan.revision },
      now,
    );
    const { settings } = await setSettings(
      sql,
      id,
      { cloudEnabled: true, fitnessContextEnabled: false, noticeVersion: CHAT_NOTICE_VERSION },
      now,
    );
    const { exerciseId: _exerciseId, setId: _setId, ...actual } = completedSet(run);
    const output = await events(
      await chatResponse(
        sql,
        id,
        turn(settings, true),
        new AbortController().signal,
        options(async ({ tools, onText }) => {
          await tools.agent!("logSet", { runId: run.id, exerciseIndex: 0, setIndex: 0, actual });
          await onText("Must not publish.");
        }),
      ),
    );
    assert.equal(output.at(-1)?.type, "error");
    assert.equal(
      output.some((event) => event.type === "action" || event.type === "done"),
      false,
    );
    assert.equal((await sql`select 1 from assistant_chat_actions where user_id=${id}`).length, 0);
    assert.deepEqual((await workouts.getRun(sql, id, run.id)).results, []);
  });

  it("passes a validated device zone and separate server/device clocks without trusting device deadlines", async () => {
    const { id, settings } = await member();
    const input = turn(settings, true);
    assert.equal(turnInput.safeParse({ ...input, timeZone: "not/a-zone" }).success, false);
    assert.equal(turnInput.safeParse({ ...input, clientNow: "whenever" }).success, false);
    await events(
      await chatResponse(
        sql,
        id,
        input,
        new AbortController().signal,
        options(async ({ clock, onText }) => {
          assert.deepEqual(clock, {
            timeZone: "America/Chicago",
            serverNow: iso(now),
            clientNow: iso(now + 600_000),
          });
          await onText("Your device timezone is available.");
        }),
      ),
    );
  });
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason },
  usage,
});
const response = (parts: LanguageModelV4StreamPart[]) => ({
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  }),
});
const baseTools = (): ChatTools => {
  const unexpected = async () => assert.fail("No unexpected tool should run");
  return {
    planning: unexpected,
    sessions: unexpected,
    workouts: unexpected,
    review: unexpected,
    draftPreferences: unexpected,
  };
};

describe("real SDK agent tool capability and clock instructions", () => {
  it("advertises action tool schemas only when the service grants the card capability", async () => {
    for (const capable of [false, true]) {
      const model = new MockLanguageModelV4({ doStream: response([finish("stop")]) });
      const tools = baseTools();
      if (capable) tools.agent = async () => assert.fail("The mock does not request a tool");
      await createGatewayChatProvider(() => model)({
        messages: [{ role: "user", text: "Help me plan" }],
        tools,
        clock: { timeZone: "America/Chicago", serverNow: iso(now), clientNow: iso(now + 600_000) },
        signal: new AbortController().signal,
        onText: async () => {},
      });
      const call = model.doStreamCalls[0];
      const names = (call.tools ?? []).map((tool) => tool.name);
      assert.equal(names.includes("setGoal"), capable);
      if (capable)
        for (const name of Object.keys(agentToolDefinitions)) assert.ok(names.includes(name));
      const system = call.prompt[0];
      assert.equal(system.role, "system");
      assert.equal(typeof system.content, "string");
      const text = String(system.content);
      assert.ok(text.includes(iso(now)) && text.includes(iso(now + 600_000)));
      assert.match(text, /America\/Chicago/);
      assert.match(text, /cannot override server deadlines/);
      assert.equal(
        text.includes("Only a server receipt after the member taps proves success"),
        capable,
      );
    }
  });

  it("validates new tool arguments before dispatching and never accepts a model owner override", async () => {
    const model = new MockLanguageModelV4({
      doStream: response([
        {
          type: "tool-call",
          toolCallId: "goal",
          toolName: "setGoal",
          input: JSON.stringify({ ...goal, userId: "other" }),
        },
        finish("tool-calls"),
      ]),
    });
    let called = false;
    await assert.rejects(
      createGatewayChatProvider(() => model)({
        messages: [{ role: "user", text: "Set a goal" }],
        tools: {
          ...baseTools(),
          agent: async () => {
            called = true;
            return {};
          },
        },
        signal: new AbortController().signal,
        onText: async () => {},
      }),
      /Conversation unavailable/,
    );
    assert.equal(called, false);
    assert.equal(model.doStreamCalls.length, 1);
  });
});
