import type { WeightUnit } from "../../../../shared/fitness.ts";

export type FitnessDraftHandoff = {
  source: "text" | "photo";
  intent: "planned" | "completed" | "unclear";
  note: string;
  exerciseName: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  unit: WeightUnit | null;
};
const entries = new Map<
  string,
  { ownerId: string; draft: FitnessDraftHandoff; expiresAt: number; isCurrent: () => boolean }
>();
/** Ephemeral and single use. Never put private notes or image URIs in navigation URLs. */
export function storeFitnessDraft(
  id: string,
  ownerId: string,
  draft: FitnessDraftHandoff,
  isCurrent: () => boolean,
  now = Date.now(),
) {
  entries.clear();
  if (!isCurrent()) return;
  entries.set(id, { ownerId, draft: { ...draft }, expiresAt: now + 10 * 60_000, isCurrent });
}
export function takeFitnessDraft(
  id: string,
  ownerId: string,
  now = Date.now(),
): FitnessDraftHandoff | null {
  const entry = entries.get(id);
  entries.delete(id);
  if (!entry || entry.ownerId !== ownerId || !entry.isCurrent() || entry.expiresAt <= now)
    return null;
  return entry.draft;
}
