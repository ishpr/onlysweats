import assert from "node:assert/strict";
import { it } from "node:test";
import { agentTranscriptEntry } from "../../../shared/agent-transcript.ts";
import type { AssistantHistoryEvent } from "../../../shared/assistant.ts";

const entry = (kind: AssistantHistoryEvent["kind"], data: Record<string, unknown> = {}) =>
  agentTranscriptEntry({
    sequence: 1,
    actorId: "synthetic-member",
    kind,
    revision: 1,
    data,
    createdAt: "2026-09-21T12:00:00Z",
  });
it("never relabels historical member proposals or approvals as agent speech", () => {
  assert.equal(entry("proposal", { agentLabel: "Member" }).actorKind, "member");
  assert.equal(entry("proposal").actorKind, "system");
  assert.equal(entry("confirmation", { actorKind: "agent" }).actorKind, "member");
  assert.equal(entry("booking_approval").actorKind, "member");
  assert.equal(entry("booked").actorKind, "system");
  assert.equal(entry("consent", { allowed: false }).title, "Planning permission withdrawn");
});
it("labels authenticated agent provenance and renders bounded action summaries", () => {
  assert.equal(entry("proposal", { agentLabel: "SamePace assistant" }).actorKind, "agent");
  const contact = entry("agent_message", {
    actorKind: "agent",
    action: "contact",
    message: { parts: [{ text: "untrusted text" }] },
  });
  assert.equal(contact.actorKind, "agent");
  assert.equal(contact.title, "Contact initiated");
  assert.ok(!contact.body.includes("untrusted text"));
  assert.equal(
    entry("agent_message", { actorKind: "agent", action: "unknown" }).title,
    "Agent activity recorded",
  );
});

it("shows actual replanning and limit actions without inventing an approval", () => {
  const revised = entry("agent_message", { actorKind: "agent", action: "preferences_changed" });
  assert.equal(revised.title, "Planning updated");
  assert.match(revised.body, /approvals no longer apply/);
  assert.equal(
    entry("agent_message", { actorKind: "agent", action: "planning_limited" }).title,
    "Planning limit reached",
  );
});
