import assert from "node:assert/strict";
import { test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createGatewayChatProvider, type ChatTools } from "./provider.server.ts";
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
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  }),
});
const draft = {
  title: "Easy walk",
  activity: "walk",
  overview: "Comfortable movement",
  exercises: [
    {
      name: "Walk",
      instructions: "Walk comfortably",
      sets: 1,
      targetUnit: "minutes",
      targetAmount: 5,
      restSeconds: 0,
    },
  ],
};

test("after offering a validated plan, the next model step cannot read unrelated private context", async () => {
  const model = new MockLanguageModelV4({
    doStream: [
      response([
        {
          type: "tool-call",
          toolCallId: "draft",
          toolName: "draftWorkoutPlan",
          input: JSON.stringify(draft),
        },
        finish("tool-calls"),
      ]),
      response([
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "Review the suggested plan." },
        { type: "text-end", id: "text" },
        finish("stop"),
      ]),
    ],
  });
  const unexpected = async () => assert.fail("No unrelated read should execute");
  let offered = 0;
  const tools: ChatTools = {
    planning: unexpected,
    sessions: unexpected,
    workouts: unexpected,
    manualWorkouts: unexpected,
    review: unexpected,
    draftPreferences: unexpected,
    draftWorkoutPlan: async (value) => {
      offered++;
      assert.equal(value.exercises[0].durationSeconds, 300);
      return { reviewOffered: true, saved: false };
    },
  };
  await createGatewayChatProvider(() => model)({
    messages: [{ role: "user", text: "Create a five-minute walk" }],
    historyUse: "when_relevant",
    tools,
    signal: new AbortController().signal,
    onText: async () => {},
  });
  assert.equal(offered, 1);
  assert.equal(model.doStreamCalls.length, 2);
  assert.deepEqual(model.doStreamCalls[1].toolChoice, { type: "none" });
  assert.equal(model.doStreamCalls[1].tools?.length ?? 0, 0);
});

test("actual tool results expose deterministic running pace to the next model request", async () => {
  const model = new MockLanguageModelV4({
    doStream: [
      response([
        { type: "tool-call", toolCallId: "planning", toolName: "readPlanning", input: "{}" },
        finish("tool-calls"),
      ]),
      response([finish("stop")]),
    ],
  });
  const unexpected = async () => assert.fail("No unrelated read should execute");
  await createGatewayChatProvider(() => model)({
    messages: [{ role: "user", text: "What are my preferences?" }],
    tools: {
      planning: async () => ({
        preferences: { ability: { kind: "run", paceMinSec: 540, paceMaxSec: 600, miles: 3 } },
      }),
      sessions: unexpected,
      workouts: unexpected,
      review: unexpected,
      draftPreferences: unexpected,
    },
    signal: new AbortController().signal,
    onText: async () => {},
  });
  const prompt = JSON.stringify(model.doStreamCalls[1].prompt);
  assert.ok(prompt.includes("9:00–10:00 min/mile"));
  assert.ok(!prompt.includes("paceMinSec"));
});
