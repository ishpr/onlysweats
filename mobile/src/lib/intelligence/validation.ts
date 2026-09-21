import type { LocalDraftResult, LocalFailure, LocalTextResult, WorkoutDraft } from "./types";

const failure = (): LocalFailure => ({
  status: "error",
  reason: "invalid_response",
  execution: "on_device",
});
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const string = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const nullableNumber = (v: unknown, max: number) =>
  v == null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
const integer = (v: unknown, max: number) =>
  v == null || (nullableNumber(v, max) && Number.isInteger(v) && (v as number) > 0);

export function parseLocalResult(raw: string, kind: "draft"): LocalDraftResult;
export function parseLocalResult(raw: string, kind: "text"): LocalTextResult;
export function parseLocalResult(
  raw: string,
  kind: "draft" | "text",
): LocalDraftResult | LocalTextResult {
  if (raw.length > 32_000) return failure();
  let r: unknown;
  try {
    r = JSON.parse(raw);
  } catch {
    return failure();
  }
  if (!object(r) || r.execution !== "on_device") return failure();
  if (["unavailable", "error", "cancelled"].includes(r.status as string)) {
    return {
      status: r.status as LocalFailure["status"],
      reason: string(r.reason, 80) ? r.reason : "unavailable",
      execution: "on_device",
    };
  }
  if (r.status !== "available" || typeof r.modelUsed !== "boolean") return failure();
  if (kind === "text") {
    if (!string(r.text, 4_000) || !r.text.trim()) return failure();
    return { status: "available", text: r.text, modelUsed: r.modelUsed, execution: "on_device" };
  }
  const d = r.draft;
  if (
    !object(d) ||
    !["text", "photo"].includes(d.source as string) ||
    !string(d.sourceText, 4_000) ||
    !string(d.note, 4_000) ||
    d.note !== d.sourceText ||
    d.requiresReview !== true ||
    d.startedAt != null ||
    !["planned", "completed", "unclear"].includes(d.intent as string) ||
    (d.title != null && (!string(d.title, 120) || !d.sourceText.includes(d.title))) ||
    (d.activity != null &&
      !["run", "ride", "walk", "hike", "strength", "mobility"].includes(d.activity as string)) ||
    !nullableNumber(d.durationMin, 360) ||
    !Array.isArray(d.exercises) ||
    d.exercises.length > 12
  )
    return failure();
  const exercises: WorkoutDraft["exercises"] = [];
  for (const e of d.exercises) {
    if (
      !object(e) ||
      !string(e.name, 120) ||
      !e.name.trim() ||
      !d.sourceText.includes(e.name) ||
      !integer(e.sets, 30) ||
      !integer(e.reps, 500) ||
      !nullableNumber(e.weight, 2_000) ||
      (e.unit != null && !["kg", "lb", "bodyweight"].includes(e.unit as string)) ||
      (e.weight != null && e.unit !== "kg" && e.unit !== "lb")
    )
      return failure();
    exercises.push({
      name: e.name,
      sets: (e.sets as number) ?? null,
      reps: (e.reps as number) ?? null,
      weight: (e.weight as number) ?? null,
      unit: (e.unit as WorkoutDraft["exercises"][number]["unit"]) ?? null,
    });
  }
  return {
    status: "available",
    modelUsed: r.modelUsed,
    reason: string(r.reason, 80) ? r.reason : null,
    execution: "on_device",
    draft: {
      source: d.source as WorkoutDraft["source"],
      sourceText: d.sourceText,
      note: d.note,
      title: (d.title as string) ?? null,
      activity: (d.activity as WorkoutDraft["activity"]) ?? null,
      intent: d.intent as WorkoutDraft["intent"],
      startedAt: null,
      durationMin: (d.durationMin as number) ?? null,
      exercises,
      requiresReview: true,
    },
  };
}
