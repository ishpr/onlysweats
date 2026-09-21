/**
 * Names as people would say them. Apple and Google often hand over ALL CAPS, and
 * "Hide My Email" sign-ups arrive as "Member" — neither belongs in a greeting.
 */
const titleCase = (word: string) =>
  word.length > 1 && word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word;

export const tidyName = (name: string) => name.trim().split(/\s+/).map(titleCase).join(" ");

/** First name for greetings and "with Maya"; `null` when we don't really have one. */
export function firstName(name?: string | null): string | null {
  const tidy = tidyName(name ?? "");
  if (!tidy || tidy === "Member") return null;
  return tidy.split(" ")[0];
}

/** True when the stored name needs the member's attention: a placeholder, or shouting. */
export const nameNeedsFixing = (name?: string | null) =>
  !name?.trim() || name === "Member" || (name.length > 2 && name === name.toUpperCase());
