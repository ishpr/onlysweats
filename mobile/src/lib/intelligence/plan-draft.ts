import { isAIWorkoutPlanDraft } from "../../../../shared/workout-plan-draft.ts";
import type { LocalFailure, LocalWorkoutPlanResult } from "./types.ts";

const failure = (): LocalFailure => ({
  status: "error",
  reason: "invalid_response",
  execution: "on_device",
});

export function parseLocalWorkoutPlanResult(raw: string): LocalWorkoutPlanResult {
  if (raw.length > 16000) return failure();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return failure();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return failure();
  const result = value as Record<string, unknown>;
  if (result.execution !== "on_device") return failure();
  if (["unavailable", "cancelled", "error"].includes(result.status as string)) {
    const allowedReasons = [
      "device_not_eligible",
      "intelligence_disabled",
      "model_not_ready",
      "unsupported_os",
      "plan_build_required",
      "plan_not_applicable",
      "invalid_input",
      "timeout",
      "cancelled",
      "busy",
      "unavailable",
    ];
    return {
      status: result.status as LocalFailure["status"],
      reason: allowedReasons.includes(result.reason as string)
        ? (result.reason as string)
        : "unavailable",
      execution: "on_device",
    };
  }
  if (
    result.status !== "available" ||
    result.modelUsed !== true ||
    result.requiresReview !== true ||
    !isAIWorkoutPlanDraft(result.planDraft)
  )
    return failure();
  return {
    status: "available",
    draft: result.planDraft,
    requiresReview: true,
    modelUsed: true,
    execution: "on_device",
  };
}
