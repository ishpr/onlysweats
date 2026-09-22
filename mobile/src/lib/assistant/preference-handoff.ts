import type { ChatPreferenceDraft } from "../../../../shared/conversation.ts";

let entry: {
  id: string;
  ownerId: string;
  draft: ChatPreferenceDraft;
  isCurrent: () => boolean;
  expiresAt: number;
} | null = null;

/** Keep private suggestions out of route parameters and persistent storage. */
export function storePreferenceDraft(
  id: string,
  ownerId: string,
  draft: ChatPreferenceDraft,
  isCurrent: () => boolean,
  now = Date.now(),
) {
  entry = isCurrent()
    ? { id, ownerId, draft: { ...draft }, isCurrent, expiresAt: now + 10 * 60_000 }
    : null;
}

export function takePreferenceDraft(id: string, ownerId: string, now = Date.now()) {
  const captured = entry;
  entry = null;
  if (
    !captured ||
    captured.id !== id ||
    captured.ownerId !== ownerId ||
    !captured.isCurrent() ||
    captured.expiresAt <= now
  )
    return undefined;
  return captured.draft;
}
