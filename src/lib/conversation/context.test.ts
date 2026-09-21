import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatEvent } from "../../../shared/conversation.ts";
import { CHAT_NOTICE_VERSION } from "../../../shared/conversation.ts";
import type { AIWorkoutPlanDraft } from "../../../shared/workout-plans.ts";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { ensureProfile } from "../pace/service.server.ts";
import { conversationContext } from "./context.ts";
import { chatResponse, setSettings } from "./service.server.ts";
const draft = (title = "Prior model circuit"): AIWorkoutPlanDraft => ({
  title,
  activity: "strength",
  instructions: "Editable suggestions only.",
  exercises: [
    {
      name: "Squat",
      instructions: "Choose your own comfortable range.",
      sets: 3,
      reps: 8,
      durationSeconds: null,
      restSeconds: 60,
    },
    {
      name: "Plank",
      instructions: "Breathe normally.",
      sets: 2,
      reps: null,
      durationSeconds: 20,
      restSeconds: 45,
    },
  ],
});
const message = (plan?: AIWorkoutPlanDraft, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: randomUUID(),
  requestId: randomUUID(),
  role: "assistant",
  text: "Review the suggested workout.",
  status: "complete",
  createdAt: new Date().toISOString(),
  actions: plan
    ? [
        {
          id: "draft",
          kind: "workout_plan",
          label: "Review",
          description: "Unsaved",
          workoutPlanDraft: plan,
        },
      ]
    : [],
  ...patch,
});
const request = () => ({
  requestId: randomUUID(),
  text: "Make the second exercise three sets.",
  workoutPlanDrafts: true,
});
const suggestions = (messages: { text: string }[]) =>
  messages.filter((item) => item.text.startsWith("UNSAVED MODEL SUGGESTION"));

describe("bounded prior draft context for iterative authoring", () => {
  it("recalls exactly the latest validated model draft with its unsaved provenance", () => {
    const latest = draft("Most recent suggestion");
    const result = conversationContext(
      [message(draft("Older suggestion")), message(latest)],
      request(),
    );
    assert.equal(suggestions(result).length, 1);
    assert.ok(suggestions(result)[0].text.endsWith(JSON.stringify(latest)));
    assert.match(suggestions(result)[0].text, /Member review is required/);
    assert.doesNotMatch(suggestions(result)[0].text, /Older suggestion/);
    assert.equal(result.at(-1)?.text, "Make the second exercise three sets.");
  });
  it("does not forward drafts to legacy clients or retrieve other action payloads", () => {
    const prior = message(draft());
    prior.actions.push({
      id: "unrelated",
      kind: "preferences",
      label: "Review",
      description: "Private",
      preferenceDraft: { approvedIntent: "UNRELATED_PRIVATE_SENTINEL" },
    });
    const legacy = conversationContext([prior], { ...request(), workoutPlanDrafts: undefined });
    assert.equal(suggestions(legacy).length, 0);
    assert.doesNotMatch(JSON.stringify(legacy), /Prior model circuit|UNRELATED_PRIVATE_SENTINEL/);
    assert.doesNotMatch(
      JSON.stringify(conversationContext([prior], request())),
      /UNRELATED_PRIVATE_SENTINEL/,
    );
  });
  it("ignores incomplete/user/current-request cards and rejects a malformed latest draft rather than reviving an older one", () => {
    const input = request(),
      prior = message(draft("Good older draft"));
    const invalid = message({ ...draft(), secretMeasurement: "DO_NOT_COPY" } as AIWorkoutPlanDraft);
    assert.equal(suggestions(conversationContext([prior, invalid], input)).length, 0);
    for (const excluded of [
      message(draft(), { role: "user" }),
      message(draft(), { status: "interrupted" }),
      message(draft(), { requestId: input.requestId }),
    ])
      assert.equal(suggestions(conversationContext([excluded], input)).length, 0);
  });
  it("counts full structured content toward 16,000 characters and 20 messages while retaining a complete latest draft", () => {
    const large = {
      ...draft(),
      instructions: "x".repeat(1000),
      exercises: Array.from({ length: 12 }, () => ({
        name: "n".repeat(100),
        instructions: "i".repeat(500),
        sets: 10,
        reps: 20,
        durationSeconds: null,
        restSeconds: 60,
      })),
    };
    const history = [
      message(large),
      ...Array.from({ length: 38 }, () => message(undefined, { text: "t".repeat(1000) })),
    ];
    const result = conversationContext(history, { ...request(), text: "u".repeat(2000) });
    assert.ok(result.reduce((sum, item) => sum + item.text.length, 0) <= 16000);
    assert.ok(result.length <= 20);
    assert.equal(suggestions(result).length, 1);
    assert.ok(suggestions(result)[0].text.endsWith(JSON.stringify(large)));
    const short = conversationContext(
      Array.from({ length: 40 }, () => message(draft())),
      request(),
    );
    assert.equal(short.length, 20);
    assert.equal(suggestions(short).length, 1);
  });
});

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
it("a subsequent real service turn receives the prior draft without saving a plan or completed activity", async () => {
  const id = randomUUID();
  await sql`insert into "user"(id,name,email,"emailVerified") values (${id},'Context fixture',${`${id}@example.test`},true)`;
  await ensureProfile(sql, { id, name: "Context fixture", email: `${id}@example.test` });
  const { settings } = await setSettings(sql, id, {
    cloudEnabled: true,
    fitnessContextEnabled: false,
    noticeVersion: CHAT_NOTICE_VERSION,
  });
  const input = () => ({
    ...request(),
    consentGeneration: settings.consentGeneration,
    historyGeneration: settings.historyGeneration,
  });
  const first = await chatResponse(
    sql,
    id,
    { ...input(), text: "Draft a short circuit" },
    new AbortController().signal,
    {
      available: true,
      provider: async ({ tools, onText }) => {
        await tools.draftWorkoutPlan!(draft());
        await onText("Review this draft.");
      },
    },
  );
  await first.text();
  const second = await chatResponse(sql, id, input(), new AbortController().signal, {
    available: true,
    provider: async ({ messages, onText }) => {
      assert.equal(suggestions(messages).length, 1);
      assert.match(suggestions(messages)[0].text, /"name":"Plank"/);
      assert.match(suggestions(messages)[0].text, /"sets":2/);
      assert.match(suggestions(messages)[0].text, /"durationSeconds":20/);
      await onText("Review the revised suggestion before saving.");
    },
  });
  const events: ChatEvent[] = (await second.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1)?.type, "done");
  for (const table of [
    "workout_plans",
    "workout_runs",
    "fitness_strength_logs",
    "health_records",
  ]) {
    const [{ count }] = await sql.query<{ count: number }>(
      `select count(*)::int count from ${table} where user_id = $1`,
      [id],
    );
    assert.equal(count, 0);
  }
});
