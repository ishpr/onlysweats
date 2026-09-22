import assert from "node:assert/strict";
import test from "node:test";
import {
  agentActionRequest,
  executeAgentAction,
  getChatClock,
  readAgentActionResult,
} from "./agent-action.ts";
import {
  CHAT_HISTORY_USE_NOTICE_VERSION,
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  CHAT_NOTICE_VERSION,
} from "../../../../shared/conversation.ts";

const settings = {
  consentReviewed: true,
  cloudEnabled: true,
  fitnessContextEnabled: false,
  manualWorkoutContextEnabled: true,
  manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  historyUse: "when_relevant",
  historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
  consentGeneration: "consent-1",
  historyGeneration: "history-1",
  noticeVersion: CHAT_NOTICE_VERSION,
  providerAvailable: true,
  model: "backend-model",
};
const action = {
  id: "action-123",
  kind: "agent_card",
  label: "Save goal",
  description: "Save the goal you reviewed.",
  card: {
    kind: "goal_draft",
    facts: ["Walk twice this week"],
    primaryLabel: "Save goal",
    expiresAt: "2026-09-22T18:00:00.000Z",
  },
};
const checkin = { ...action, card: { ...action.card, kind: "checkin", input: "checkin" } };
const result = {
  receipt: {
    actionId: action.id,
    text: "Your goal was saved.",
    createdAt: "2026-09-22T17:00:00.000Z",
  },
  history: { settings: { ...settings, historyGeneration: "history-2" }, messages: [] },
};

test("execution sends only the persisted action ID and permission generations", () => {
  assert.deepEqual(agentActionRequest(action, settings), {
    path: "/assistant/actions/action-123/execute",
    json: { consentGeneration: "consent-1", historyGeneration: "history-1" },
  });
  for (const override of [{ command: { kind: "book" } }, { targetId: "other-account" }]) {
    assert.throws(
      () => agentActionRequest({ ...action, ...override }, settings),
      /no longer available/,
    );
  }
  assert.throws(
    () => agentActionRequest({ ...action, id: "../../other" }, settings),
    /no longer available/,
  );
  assert.throws(() => agentActionRequest(action, settings, { code: "1234" }), /does not accept/);
});

test("check-in requires direct, exclusive code or measured location input", () => {
  assert.deepEqual(agentActionRequest(checkin, settings, { code: "0123" }).json.interaction, {
    code: "0123",
  });
  assert.deepEqual(
    agentActionRequest(checkin, settings, { geo: { lat: 32.9, lng: -96.8, accuracyM: 14 } }).json
      .interaction,
    { geo: { lat: 32.9, lng: -96.8, accuracyM: 14 } },
  );
  const noAccuracy = agentActionRequest(checkin, settings, { geo: { lat: 0, lng: 0 } }).json
    .interaction;
  assert.equal(Object.hasOwn(noAccuracy.geo, "accuracyM"), false);
  for (const input of [
    undefined,
    { code: "123" },
    { code: 1234 },
    { code: "12e3" },
    { code: "1234", geo: { lat: 0, lng: 0 } },
    { code: "1234", command: "checkin" },
    { geo: { lat: NaN, lng: 0 } },
    { geo: { lat: 91, lng: 0 } },
    { geo: { lat: 0, lng: 181 } },
    { geo: { lat: 0, lng: 0, accuracyM: -1 } },
    { geo: { lat: 0, lng: 0, command: "book" } },
  ])
    assert.throws(() => agentActionRequest(checkin, settings, input));
});

test("only a matching server receipt and validated same-consent history become success", () => {
  assert.deepEqual(readAgentActionResult(result, action.id, settings.consentGeneration), result);
  for (const value of [
    { ...result, receipt: { ...result.receipt, actionId: "other" } },
    { ...result, receipt: { ...result.receipt, text: "" } },
    { ...result, receipt: { ...result.receipt, createdAt: "invalid" } },
    { ...result, history: { ...result.history, messages: [{}] } },
    {
      ...result,
      history: { ...result.history, settings: { ...settings, consentGeneration: "revoked" } },
    },
  ])
    assert.throws(() => readAgentActionResult(value, action.id, settings.consentGeneration));
  const completed = {
    ...action,
    card: {
      ...action.card,
      primaryLabel: null,
      receipt: { text: result.receipt.text, createdAt: result.receipt.createdAt },
    },
  };
  assert.throws(() => agentActionRequest(completed, settings), /no longer available/);
});

test("an account switch or abort cannot return a private action result", async () => {
  let current = true;
  let resolve;
  let calls = 0;
  const session = {
    isCurrent: () => current,
    request: async () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
  };
  const controller = new AbortController();
  const pending = executeAgentAction(session, action, settings, controller.signal);
  current = false;
  resolve(result);
  await assert.rejects(pending, /conversation changed/);
  await assert.rejects(
    executeAgentAction(session, action, settings, controller.signal),
    /conversation changed/,
  );
  assert.equal(calls, 1);
  current = true;
  controller.abort();
  await assert.rejects(
    executeAgentAction(session, action, settings, controller.signal),
    /conversation changed/,
  );
  assert.equal(calls, 1);
});

test("retry after a lost response reuses the same persisted action ID", async () => {
  const requests = [];
  const session = {
    isCurrent: () => true,
    request: async (path, init) => {
      requests.push({ path, json: init.json });
      if (requests.length === 1) throw new Error("Connection lost after server commit");
      return result;
    },
  };
  await assert.rejects(
    executeAgentAction(session, action, settings, new AbortController().signal),
    /Connection lost/,
  );
  assert.deepEqual(
    await executeAgentAction(session, action, settings, new AbortController().signal),
    result,
  );
  assert.deepEqual(requests[0], requests[1]);
});

test("chat clock preserves an IANA zone, falling back explicitly instead of guessing", () => {
  const now = new Date("2026-09-22T17:00:00.000Z");
  assert.deepEqual(getChatClock(now, "America/Chicago"), {
    timeZone: "America/Chicago",
    clientNow: now.toISOString(),
  });
  for (const zone of ["not/a-zone", "+05:00", "", "x".repeat(101)]) {
    assert.equal(getChatClock(now, zone).timeZone, "UTC");
  }
  assert.throws(() => getChatClock(new Date("invalid")), /clock/);
});
