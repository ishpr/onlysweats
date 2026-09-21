import type { ChatAction, ChatMessage, ChatEvent } from "../../../../shared/conversation.ts";
import { isAIWorkoutPlanDraft } from "../../../../shared/workout-plan-draft.ts";

const actionKinds = new Set([
  "preferences",
  "discovery",
  "negotiation",
  "session",
  "workout",
  "fitness",
  "workout_plan",
]);
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}
export function isPreferenceDraft(value: unknown): boolean {
  if (
    !record(value) ||
    Object.keys(value).length === 0 ||
    Object.keys(value).some((key) => !["activity", "durationMin", "approvedIntent"].includes(key))
  )
    return false;
  return (
    (value.activity === undefined ||
      (typeof value.activity === "string" &&
        ["run", "ride", "walk", "hike", "strength", "mobility"].includes(value.activity))) &&
    (value.durationMin === undefined ||
      (typeof value.durationMin === "number" &&
        Number.isInteger(value.durationMin) &&
        value.durationMin >= 10 &&
        value.durationMin <= 360)) &&
    (value.approvedIntent === undefined || boundedText(value.approvedIntent, 240))
  );
}
export function isChatAction(value: unknown): value is ChatAction {
  return (
    record(value) &&
    typeof value.id === "string" &&
    idPattern.test(value.id) &&
    typeof value.kind === "string" &&
    actionKinds.has(value.kind) &&
    boundedText(value.label, 200) &&
    boundedText(value.description, 1000) &&
    (value.preferenceDraft === undefined ||
      (value.kind === "preferences" && isPreferenceDraft(value.preferenceDraft))) &&
    (value.workoutPlanDraft === undefined ||
      (value.kind === "workout_plan" && isAIWorkoutPlanDraft(value.workoutPlanDraft))) &&
    (value.kind !== "workout_plan" || isAIWorkoutPlanDraft(value.workoutPlanDraft)) &&
    (value.targetId === undefined ||
      (typeof value.targetId === "string" && idPattern.test(value.targetId))) &&
    (!["negotiation", "session", "workout"].includes(value.kind) ||
      typeof value.targetId === "string")
  );
}
export function isChatMessage(value: unknown): value is ChatMessage {
  return (
    record(value) &&
    typeof value.id === "string" &&
    idPattern.test(value.id) &&
    typeof value.requestId === "string" &&
    idPattern.test(value.requestId) &&
    typeof value.role === "string" &&
    ["user", "assistant"].includes(value.role) &&
    boundedText(value.text, 24_000) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.status === "string" &&
    ["complete", "interrupted"].includes(value.status) &&
    Array.isArray(value.actions) &&
    value.actions.length <= 12 &&
    value.actions.every(isChatAction)
  );
}

/** Bounded NDJSON; incomplete output can never masquerade as a saved final answer. */
export function createChatStreamParser(requestId: string, emit: (event: ChatEvent) => void) {
  let buffer = "";
  let started = false;
  let terminal = false;
  let total = 0;
  let textLength = 0;
  let actionCount = 0;
  const invalid = () => new Error("The assistant response was interrupted. Please try again.");
  const line = (input: string) => {
    if (!input.trim()) return;
    if (terminal) throw invalid();
    let value: unknown;
    try {
      value = JSON.parse(input);
    } catch {
      throw invalid();
    }
    if (!record(value)) throw invalid();
    switch (value.type) {
      case "start":
        if (started || value.requestId !== requestId) throw invalid();
        started = true;
        break;
      case "delta":
        if (!started || !boundedText(value.text, 24_000)) throw invalid();
        textLength += value.text.length;
        if (textLength > 24_000) throw invalid();
        break;
      case "action":
        if (!started || !isChatAction(value.action) || ++actionCount > 12) throw invalid();
        break;
      case "done":
        if (
          !started ||
          !isChatMessage(value.message) ||
          value.message.role !== "assistant" ||
          value.message.status !== "complete" ||
          value.message.requestId !== requestId
        )
          throw invalid();
        terminal = true;
        break;
      case "error":
        if (!boundedText(value.message, 1000)) throw invalid();
        terminal = true;
        break;
      default:
        throw invalid();
    }
    emit(value as ChatEvent);
  };
  return {
    push(chunk: string) {
      total += chunk.length;
      if (total > 200_000) throw invalid();
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (buffer.length > 60_000) throw invalid();
    },
    finish() {
      if (buffer.trim()) line(buffer);
      buffer = "";
      if (!terminal) throw invalid();
    },
  };
}
