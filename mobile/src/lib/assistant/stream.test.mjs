import assert from "node:assert/strict";
import test from "node:test";
import { createChatStreamParser, isChatAction, isChatMessage } from "./stream.ts";
import { createAssistantRun } from "./run.ts";
import { storeFitnessDraft, takeFitnessDraft } from "./draft-handoff.ts";
const id = "request-1";
const message = {
  id: "message-1",
  requestId: id,
  role: "assistant",
  text: "A short reply",
  createdAt: new Date().toISOString(),
  actions: [],
  status: "complete",
};
const wire = (...events) => events.map(JSON.stringify).join("\n") + "\n";

test("NDJSON handles arbitrary chunks, CRLF and a final unterminated line", () => {
  const received = [];
  const parser = createChatStreamParser(id, (e) => received.push(e));
  const input =
    wire({ type: "start", requestId: id }, { type: "delta", text: "💪\nhello" }).replaceAll(
      "\n",
      "\r\n",
    ) + JSON.stringify({ type: "done", message });
  for (let i = 0; i < input.length; i += 3) parser.push(input.slice(i, i + 3));
  parser.finish();
  assert.equal(received.length, 3);
  assert.equal(received[1].text, "💪\nhello");
});
test("rejects truncated streams, cross-request finals and events after done", () => {
  const p = createChatStreamParser(id, () => {});
  p.push(wire({ type: "start", requestId: id }, { type: "delta", text: "partial" }));
  assert.throws(() => p.finish(), /interrupted/);
  const q = createChatStreamParser(id, () => {});
  assert.throws(
    () =>
      q.push(
        wire(
          { type: "start", requestId: id },
          { type: "done", message: { ...message, requestId: "other" } },
        ),
      ),
    /interrupted/,
  );
  const r = createChatStreamParser(id, () => {});
  r.push(wire({ type: "start", requestId: id }, { type: "done", message }));
  assert.throws(() => r.push(wire({ type: "delta", text: "late" })), /interrupted/);
});
test("does not accept executable action kinds, URLs or overlong responses", () => {
  assert.equal(isChatAction({ id: "1", kind: "book", label: "Book", description: "" }), false);
  assert.equal(
    isChatAction({
      id: "1",
      kind: "session",
      targetId: "https://attacker.test",
      label: "Open",
      description: "",
    }),
    false,
  );
  assert.equal(
    isChatAction({
      id: "1",
      kind: "session",
      targetId: "session_1",
      label: "Open",
      description: "",
    }),
    true,
  );
  const p = createChatStreamParser(id, () => {});
  assert.throws(() => p.push("x".repeat(200001)), /interrupted/);
});
test("cancel/reset fences late callbacks and duplicate starts, while allowing a fresh run", async () => {
  let finish, publish;
  const values = [];
  const run = createAssistantRun(() => true);
  const pending = run.start(
    async (_, emit) => {
      publish = emit;
      await new Promise((r) => (finish = r));
    },
    (v) => values.push(v),
    () => assert.fail(),
    () => values.push("settled"),
  );
  assert.equal(
    await run.start(
      async () => assert.fail(),
      () => {},
      () => {},
      () => {},
    ),
    false,
  );
  publish("first");
  run.cancel();
  publish("late");
  await run.start(
    async (_, emit) => emit("new"),
    (v) => values.push(v),
    () => assert.fail(),
    () => values.push("new settled"),
  );
  finish();
  await pending;
  assert.deepEqual(values, ["first", "new", "new settled"]);
});
test("account switch suppresses local asynchronous results and error callbacks", async () => {
  let current = true,
    finish;
  const run = createAssistantRun(() => current);
  const out = [];
  const pending = run.start(
    async (_, emit) => {
      await new Promise((r) => (finish = r));
      emit("private");
      throw Error("old");
    },
    (v) => out.push(v),
    () => out.push("error"),
    () => out.push("done"),
  );
  current = false;
  finish();
  await pending;
  assert.deepEqual(out, []);
});
test("draft handoffs expire, are one-use and cannot cross account generations", () => {
  const draft = {
    source: "photo",
    intent: "planned",
    note: "private",
    exerciseName: "Squat",
    sets: 3,
    reps: 5,
    weight: null,
    unit: null,
  };
  storeFitnessDraft("a", "alice", draft, () => true, 100);
  assert.equal(takeFitnessDraft("a", "bob", 101), null);
  storeFitnessDraft("b", "alice", draft, () => false, 100);
  assert.equal(takeFitnessDraft("b", "alice", 101), null);
  storeFitnessDraft("c", "alice", draft, () => true, 100);
  assert.equal(takeFitnessDraft("c", "alice", 700000), null);
  storeFitnessDraft("d", "alice", draft, () => true, 100);
  assert.deepEqual(takeFitnessDraft("d", "alice", 101), draft);
  assert.equal(takeFitnessDraft("d", "alice", 102), null);
  let current = true;
  storeFitnessDraft("e", "alice", draft, () => current, 100);
  current = false;
  assert.equal(takeFitnessDraft("e", "alice", 101), null);
});

test("preference cards reject policy changes and invalid numeric drafts", () => {
  const base = { id: "preferences", kind: "preferences", label: "Review", description: "Draft" };
  assert.equal(
    isChatAction({
      ...base,
      preferenceDraft: { activity: "walk", durationMin: 30, approvedIntent: "Easy pace" },
    }),
    true,
  );
  for (const preferenceDraft of [
    { enabled: true },
    { durationMin: 361 },
    { durationMin: 20.5 },
    { activity: "doctor" },
    { approvedIntent: "x".repeat(241) },
  ])
    assert.equal(isChatAction({ ...base, preferenceDraft }), false);
  assert.equal(
    isChatAction({ ...base, kind: "fitness", preferenceDraft: { durationMin: 30 } }),
    false,
  );
});

test("accepts the server's twelve review cards but rejects a thirteenth", () => {
  const actions = Array.from({ length: 12 }, (_, i) => ({
    id: `card-${i}`,
    kind: "session",
    targetId: `session-${i}`,
    label: "Review",
    description: "Actual upcoming session",
  }));
  const p = createChatStreamParser(id, () => {});
  p.push(
    wire(
      { type: "start", requestId: id },
      ...actions.map((action) => ({ type: "action", action })),
      { type: "done", message: { ...message, actions } },
    ),
  );
  p.finish();
  const q = createChatStreamParser(id, () => {});
  q.push(
    wire(
      { type: "start", requestId: id },
      ...actions.map((action) => ({ type: "action", action })),
    ),
  );
  assert.throws(
    () => q.push(wire({ type: "action", action: { ...actions[0], id: "extra" } })),
    /interrupted/,
  );
});

test("handles a rejected request without requiring a start event", () => {
  const result = [];
  const p = createChatStreamParser(id, (event) => result.push(event));
  p.push(wire({ type: "error", message: "Your conversation changed. Refresh to continue." }));
  p.finish();
  assert.deepEqual(
    result.map((event) => event.type),
    ["error"],
  );
});

test("wire values must keep their declared types and a final must be complete", () => {
  assert.equal(
    isChatAction({
      id: "1",
      kind: "preferences",
      label: "Review",
      description: "",
      preferenceDraft: { activity: ["run"] },
    }),
    false,
  );
  assert.equal(isChatMessage({ ...message, role: ["assistant"] }), false);
  assert.equal(isChatMessage({ ...message, status: ["complete"] }), false);
  const p = createChatStreamParser(id, () => {});
  assert.throws(
    () =>
      p.push(
        wire(
          { type: "start", requestId: id },
          { type: "done", message: { ...message, status: "interrupted" } },
        ),
      ),
    /interrupted/,
  );
});
