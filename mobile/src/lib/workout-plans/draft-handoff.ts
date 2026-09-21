import type { WorkoutDraft } from "../intelligence/types.ts";
import type { AIWorkoutPlanDraft } from "../../../../shared/workout-plans.ts";

export type WorkoutPlanDraft = Pick<WorkoutDraft, "title" | "note" | "exercises">;
export type WorkoutEditorDraft =
  { kind: "extracted"; draft: WorkoutPlanDraft } | { kind: "generated"; draft: AIWorkoutPlanDraft };

const entries = new Map<
  string,
  { ownerId: string; value: WorkoutEditorDraft; expiresAt: number; isCurrent: () => boolean }
>();

/** A reviewed plan suggestion stays in memory; routes carry only a single-use receipt. */
export function storeWorkoutPlanDraft(
  id: string,
  ownerId: string,
  draft: WorkoutPlanDraft,
  isCurrent: () => boolean,
  now = Date.now(),
) {
  entries.clear();
  if (!isCurrent()) return;
  entries.set(id, {
    ownerId,
    value: {
      kind: "extracted",
      draft: {
        title: draft.title?.slice(0, 120) ?? null,
        note: draft.note.slice(0, 2000),
        exercises: draft.exercises.slice(0, 12).map((exercise) => ({ ...exercise })),
      },
    },
    expiresAt: now + 10 * 60_000,
    isCurrent,
  });
}

export function takeWorkoutPlanDraft(
  id: string,
  ownerId: string,
  now = Date.now(),
): WorkoutPlanDraft | null {
  const entry = takeWorkoutEditorDraft(id, ownerId, now);
  return entry?.kind === "extracted" ? entry.draft : null;
}

export function storeGeneratedWorkoutPlanDraft(
  id: string,
  ownerId: string,
  draft: AIWorkoutPlanDraft,
  isCurrent: () => boolean,
  now = Date.now(),
) {
  entries.clear();
  if (!isCurrent()) return;
  entries.set(id, {
    ownerId,
    value: {
      kind: "generated",
      draft: { ...draft, exercises: draft.exercises.map((exercise) => ({ ...exercise })) },
    },
    expiresAt: now + 10 * 60_000,
    isCurrent,
  });
}

export function takeWorkoutEditorDraft(
  id: string,
  ownerId: string,
  now = Date.now(),
): WorkoutEditorDraft | null {
  const entry = entries.get(id);
  entries.delete(id);
  if (!entry || entry.ownerId !== ownerId || !entry.isCurrent() || entry.expiresAt <= now)
    return null;
  return entry.value;
}
