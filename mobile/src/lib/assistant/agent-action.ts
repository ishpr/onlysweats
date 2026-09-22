import type { ApiSession } from "../session-transport.ts";
import type {
  ChatAction,
  ChatActionResult,
  ChatSettings,
} from "../../../../shared/conversation.ts";
import { isChatAction, isChatMessage } from "./stream.ts";
import { readChatSettings } from "./settings.ts";

export type AgentActionInteraction =
  { code: string } | { geo: { lat: number; lng: number; accuracyM?: number } };
export type AgentActionResult = ChatActionResult;

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The device supplies a clock hint; the server still owns deadlines and comparisons. */
export function getChatClock(now = new Date(), zone?: string) {
  if (!Number.isFinite(now.getTime())) throw new Error("Your device clock is unavailable.");
  let timeZone = "UTC";
  try {
    const candidate = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Offset strings and arbitrary labels are not IANA identifiers.
    if (candidate && candidate.length <= 100 && /^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(candidate)) {
      timeZone = new Intl.DateTimeFormat("en", { timeZone: candidate }).resolvedOptions().timeZone;
    }
  } catch {
    // UTC is explicit; never guess the member's location from another signal.
  }
  return { timeZone, clientNow: now.toISOString() };
}

/** Only the saved action ID and direct member input travel back, never model commands. */
export function agentActionRequest(
  action: ChatAction,
  settings: Pick<ChatSettings, "consentGeneration" | "historyGeneration">,
  interaction?: AgentActionInteraction,
) {
  if (
    !isChatAction(action) ||
    action.kind !== "agent_card" ||
    !action.card?.primaryLabel ||
    action.card.receipt !== undefined ||
    !idPattern.test(settings.consentGeneration) ||
    !idPattern.test(settings.historyGeneration)
  )
    throw new Error("This action is no longer available. Refresh the conversation.");
  let input: AgentActionInteraction | undefined;
  if (action.card.input === "checkin") {
    const entered: unknown = interaction;
    if (!record(entered)) throw new Error("Use your location or enter the four-digit code.");
    if (
      Object.keys(entered).length === 1 &&
      typeof entered.code === "string" &&
      /^\d{4}$/.test(entered.code)
    ) {
      input = { code: entered.code };
    } else if (Object.keys(entered).length === 1 && record(entered.geo)) {
      const { lat, lng, accuracyM } = entered.geo;
      if (
        Object.keys(entered.geo).some((key) => !["lat", "lng", "accuracyM"].includes(key)) ||
        typeof lat !== "number" ||
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        typeof lng !== "number" ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180 ||
        (accuracyM !== undefined &&
          (typeof accuracyM !== "number" || !Number.isFinite(accuracyM) || accuracyM < 0))
      )
        throw new Error("Your location could not be confirmed. Try again or use the code.");
      input = { geo: { lat, lng, ...(accuracyM === undefined ? {} : { accuracyM }) } };
    } else {
      throw new Error("Enter the four-digit code shown by your workout partner.");
    }
  } else if (interaction !== undefined) {
    throw new Error("This action does not accept check-in details.");
  }
  return {
    path: `/assistant/actions/${encodeURIComponent(action.id)}/execute`,
    json: {
      consentGeneration: settings.consentGeneration,
      historyGeneration: settings.historyGeneration,
      ...(input ? { interaction: input } : {}),
    },
  };
}

export function readAgentActionResult(
  value: unknown,
  actionId: string,
  consentGeneration: string,
): AgentActionResult {
  const invalid = () =>
    new Error("The action result could not be read. Refresh this conversation.");
  if (
    !record(value) ||
    !record(value.receipt) ||
    value.receipt.actionId !== actionId ||
    typeof value.receipt.text !== "string" ||
    !value.receipt.text.trim() ||
    value.receipt.text.length > 24_000 ||
    typeof value.receipt.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.receipt.createdAt)) ||
    !record(value.history) ||
    !Array.isArray(value.history.messages) ||
    value.history.messages.length > 40 ||
    !value.history.messages.every(isChatMessage)
  )
    throw invalid();
  const settings = readChatSettings(value.history.settings);
  if (settings.consentGeneration !== consentGeneration) throw invalid();
  return {
    receipt: {
      actionId,
      text: value.receipt.text,
      createdAt: value.receipt.createdAt,
    },
    history: { settings, messages: value.history.messages },
  };
}

export async function executeAgentAction(
  session: ApiSession,
  action: ChatAction,
  settings: Pick<ChatSettings, "consentGeneration" | "historyGeneration">,
  signal: AbortSignal,
  interaction?: AgentActionInteraction,
) {
  const assertCurrent = () => {
    if (!session.isCurrent() || signal.aborted)
      throw new Error("Your conversation changed. Open it again to continue.");
  };
  assertCurrent();
  const request = agentActionRequest(action, settings, interaction);
  const value = await session.request<unknown>(request.path, {
    method: "POST",
    json: request.json,
    signal,
  });
  assertCurrent();
  return readAgentActionResult(value, action.id, settings.consentGeneration);
}

/** Chat history comes from the action receipt; dependent screens refresh their own facts. */
export function agentActionQueryKeys(ownerId: string): (readonly string[])[] {
  return [
    ["private-assistant", ownerId],
    ["private-agent-goal", ownerId],
    ["private-workout-plans", ownerId],
    ["private-workout-plan", ownerId],
    ["private-workout-runs", ownerId],
    ["private-workout-run", ownerId],
    ["private-fitness", ownerId],
    ["session-workout-plan", ownerId],
    ["mine"],
    ["sessions"],
    ["session"],
    ["me"],
    ["notifications"],
  ];
}
