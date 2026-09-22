/** Public review facts only. Executable commands remain on the server. */
export const AGENT_CARD_KINDS = [
  "goal_draft",
  "preferences_draft",
  "person",
  "session_draft",
  "plan",
  "session",
  "booking_request",
  "workout_plan_draft",
  "workout_set",
  "progress",
  "checkin",
  "again",
  "recap",
  "receipt",
] as const;
export type AgentChatCard = {
  kind: (typeof AGENT_CARD_KINDS)[number];
  title?: string;
  facts: string[];
  primaryLabel: string | null;
  input?: "checkin";
  expiresAt: string;
  receipt?: { text: string; createdAt: string };
};

/** Deliberately dependency-free so native stream parsing uses the same boundary. */
export function isAgentChatCard(value: unknown): value is AgentChatCard {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const card = value as Record<string, unknown>;
  const receipt = card.receipt as Record<string, unknown> | undefined;
  return (
    Object.keys(card).every((key) =>
      ["kind", "title", "facts", "primaryLabel", "input", "expiresAt", "receipt"].includes(key),
    ) &&
    typeof card.kind === "string" &&
    (AGENT_CARD_KINDS as readonly string[]).includes(card.kind) &&
    (card.title === undefined ||
      (typeof card.title === "string" && card.title.length > 0 && card.title.length <= 160)) &&
    Array.isArray(card.facts) &&
    card.facts.length <= 40 &&
    card.facts.every(
      (fact) => typeof fact === "string" && fact.length > 0 && fact.length <= 1200,
    ) &&
    (card.primaryLabel === null ||
      (typeof card.primaryLabel === "string" &&
        card.primaryLabel.length > 0 &&
        card.primaryLabel.length <= 80)) &&
    (card.input === undefined || (card.kind === "checkin" && card.input === "checkin")) &&
    (card.kind !== "receipt" || card.primaryLabel === null) &&
    typeof card.expiresAt === "string" &&
    card.expiresAt.length <= 40 &&
    Number.isFinite(Date.parse(card.expiresAt)) &&
    (receipt === undefined ||
      (card.primaryLabel === null &&
        card.input === undefined &&
        receipt !== null &&
        typeof receipt === "object" &&
        !Array.isArray(receipt) &&
        Object.keys(receipt).every((key) => key === "text" || key === "createdAt") &&
        typeof receipt.text === "string" &&
        receipt.text.length > 0 &&
        receipt.text.length <= 1200 &&
        typeof receipt.createdAt === "string" &&
        receipt.createdAt.length <= 40 &&
        Number.isFinite(Date.parse(receipt.createdAt))))
  );
}
