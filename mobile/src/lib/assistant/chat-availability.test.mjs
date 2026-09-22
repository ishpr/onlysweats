import assert from "node:assert/strict";
import test from "node:test";
import { appendLocalChatTurn, chatAvailability, localChatNotice } from "./chat-availability.ts";

const ready = {
  settings: { cloudEnabled: true, providerAvailable: true },
  pending: false,
  failed: false,
  permissionsUnconfirmed: false,
  current: true,
};

test("funded cloud coaching stays ready; unknown settings never imply an opt-out", () => {
  assert.equal(chatAvailability(ready), "ready");
  for (const [input, expected] of [
    [{ ...ready, pending: true, settings: undefined }, "checking"],
    [{ ...ready, failed: true }, "unavailable"],
    [{ ...ready, permissionsUnconfirmed: true }, "unconfirmed"],
    [{ ...ready, current: false }, "stale_session"],
  ]) {
    assert.equal(chatAvailability(input), expected);
    assert.equal(localChatNotice(chatAvailability(input)), null);
  }
});

test("local notices require confirmed settings and disclose that no AI received the message", () => {
  const paused = chatAvailability({
    ...ready,
    settings: { cloudEnabled: false, providerAvailable: true },
  });
  const unavailable = chatAvailability({
    ...ready,
    settings: { cloudEnabled: true, providerAvailable: false },
  });
  assert.equal(paused, "paused");
  assert.equal(unavailable, "provider_unavailable");
  for (const state of [paused, unavailable])
    assert.match(localChatNotice(state), /not sent to an AI model/);
  assert.doesNotMatch(localChatNotice(unavailable), /privacy settings/);
  assert.equal(localChatNotice("ready"), null);
});

test("local-only history is bounded and retains the newest input without mutating prior state", () => {
  let turns = [];
  for (let i = 0; i < 25; i++) turns = appendLocalChatTurn(turns, { q: String(i), a: "status" });
  assert.equal(turns.length, 10);
  assert.equal(turns[0].q, "15");
  const appended = appendLocalChatTurn(turns, { q: "x".repeat(3000), a: "status" });
  assert.equal(appended.at(-1).q.length, 2000);
  assert.equal(turns.at(-1).q, "24");
});
