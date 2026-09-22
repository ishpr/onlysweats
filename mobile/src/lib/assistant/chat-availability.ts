import type { ChatSettings } from "../../../../shared/conversation.ts";

export type ChatAvailability =
  | "checking"
  | "unconfirmed"
  | "unavailable"
  | "stale_session"
  | "paused"
  | "provider_unavailable"
  | "ready";

/** Absence of verified settings says nothing about the member's saved choice. */
export function chatAvailability({
  settings,
  pending,
  failed,
  permissionsUnconfirmed,
  current,
}: {
  settings?: Pick<ChatSettings, "cloudEnabled" | "providerAvailable"> | null;
  pending: boolean;
  failed: boolean;
  permissionsUnconfirmed: boolean;
  current: boolean;
}): ChatAvailability {
  if (!current) return "stale_session";
  if (permissionsUnconfirmed) return "unconfirmed";
  if (failed) return "unavailable";
  if (pending || !settings) return "checking";
  if (!settings.cloudEnabled) return "paused";
  return settings.providerAvailable ? "ready" : "provider_unavailable";
}

/** Local status notices are fixed app copy, never a model response. */
export function localChatNotice(availability: ChatAvailability): string | null {
  if (availability === "paused")
    return "Cloud coaching is paused in your saved privacy settings. This message stayed on this device and was not sent to an AI model. You can review your settings or use the available cards.";
  if (availability === "provider_unavailable")
    return "Cloud coaching is currently unavailable for this app. This message stayed on this device and was not sent to an AI model. You can try again later or use the available cards.";
  return null;
}

export type LocalChatTurn = { q: string; a: string };
export function appendLocalChatTurn(turns: LocalChatTurn[], turn: LocalChatTurn): LocalChatTurn[] {
  return [...turns.slice(-9), { q: turn.q.slice(0, 2000), a: turn.a }];
}
