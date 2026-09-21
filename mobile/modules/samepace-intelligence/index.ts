import { requireOptionalNativeModule } from "expo-modules-core";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { parseLocalResult } from "../../src/lib/intelligence/validation";
import { parseLocalWorkoutPlanResult } from "../../src/lib/intelligence/plan-draft";
import type {
  IntelligenceCapability,
  IntelligenceHistory,
  IntelligenceOptions,
  LocalDraftResult,
  LocalFailure,
  LocalTextResult,
  LocalWorkoutPlanResult,
  WorkoutRecapInput,
} from "../../src/lib/intelligence/types";

type NativeBridge = {
  capability(): Promise<string>;
  runRequest(request: string): Promise<string>;
  cancel(requestId: string): Promise<void>;
  cancelAll(): Promise<void>;
  setNextSessionShortcut(url: string | null, expiresAt: number | null): Promise<void>;
  addListener(
    event: "onResponse",
    listener: (event: { requestId: string; text: string }) => void,
  ): { remove(): void };
};
const native =
  Platform.OS === "ios" ? requireOptionalNativeModule<NativeBridge>("SamePaceIntelligence") : null;
const absent = () => (Platform.OS === "ios" ? "native_module_missing" : "unsupported_platform");
const failed = (status: LocalFailure["status"], reason: string): LocalFailure => ({
  status,
  reason,
  execution: "on_device",
});

export async function getIntelligenceCapability(): Promise<IntelligenceCapability> {
  const fallback: IntelligenceCapability = {
    available: false,
    reason: absent(),
    photoTextRecognition: false,
    planDrafting: false,
    execution: "on_device",
  };
  if (!native) return fallback;
  try {
    const r = JSON.parse(await native.capability());
    if (
      typeof r.available !== "boolean" ||
      typeof r.photoTextRecognition !== "boolean" ||
      r.execution !== "on_device"
    )
      return fallback;
    return {
      available: r.available,
      photoTextRecognition: r.photoTextRecognition,
      planDrafting: r.planDrafting === true,
      reason: typeof r.reason === "string" ? r.reason : null,
      execution: "on_device",
    };
  } catch {
    return fallback;
  }
}

async function run(
  kind: string,
  body: Record<string, unknown>,
  options: IntelligenceOptions,
): Promise<string | LocalFailure> {
  if (options.signal?.aborted) return failed("cancelled", "cancelled");
  if (!native) return failed("unavailable", absent());
  const requestId = options.requestId ?? Crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) return failed("error", "invalid_input");
  let closed = false;
  let stop!: (value: LocalFailure) => void;
  const stopped = new Promise<LocalFailure>((resolve) => {
    stop = resolve;
  });
  const abort = () => {
    closed = true;
    void native.cancel(requestId).catch(() => undefined);
    stop(failed("cancelled", "cancelled"));
  };
  const listener = native.addListener("onResponse", (event) => {
    if (
      !closed &&
      event.requestId === requestId &&
      typeof event.text === "string" &&
      event.text.length <= 4_000
    ) {
      options.onPartial?.(event.text);
    }
  });
  const timer = setTimeout(() => {
    closed = true;
    void native.cancel(requestId).catch(() => undefined);
    stop(failed("error", "timeout"));
  }, 35_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const pending = native
      .runRequest(JSON.stringify({ ...body, kind, requestId }))
      .catch(() => failed("error", "unavailable"));
    if (options.signal?.aborted) abort();
    return await Promise.race([pending, stopped]);
  } finally {
    closed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    listener.remove();
  }
}

export async function draftText(
  note: string,
  options: IntelligenceOptions = {},
): Promise<LocalDraftResult> {
  if (!note.trim() || note.length > 4_000) return failed("error", "invalid_input");
  const result = await run("draft", { text: note }, options);
  return typeof result === "string" ? parseLocalResult(result, "draft") : result;
}
export async function draftPhoto(
  uri: string,
  options: IntelligenceOptions = {},
): Promise<LocalDraftResult> {
  if (!uri.startsWith("file://") || uri.length > 4_096) return failed("error", "image_unavailable");
  const result = await run("photo", { imageUri: uri }, options);
  return typeof result === "string" ? parseLocalResult(result, "draft") : result;
}
/** Generates a prescription for review. It does not read health data or create a log. */
export async function draftWorkoutPlan(
  note: string,
  options: IntelligenceOptions = {},
): Promise<LocalWorkoutPlanResult> {
  if (options.signal?.aborted) return failed("cancelled", "cancelled");
  if (!note.trim() || note.length > 1000) return failed("error", "invalid_input");
  if (!native) return failed("unavailable", absent());
  const capability = await getIntelligenceCapability();
  if (options.signal?.aborted) return failed("cancelled", "cancelled");
  if (!capability.planDrafting) return failed("unavailable", "plan_build_required");
  if (!capability.available) return failed("unavailable", capability.reason ?? "unavailable");
  const result = await run("plan", { text: note }, options);
  return typeof result === "string" ? parseLocalWorkoutPlanResult(result) : result;
}
export async function respond(
  text: string,
  history: IntelligenceHistory[] = [],
  options: IntelligenceOptions = {},
): Promise<LocalTextResult> {
  if (
    !text.trim() ||
    text.length > 1_000 ||
    history.length > 6 ||
    history.some((m) => !["user", "assistant"].includes(m.role) || m.text.length > 2_000) ||
    history.reduce((sum, m) => sum + m.text.length, text.length) > 6_000
  )
    return failed("error", "invalid_input");
  const result = await run("chat", { text, history }, options);
  return typeof result === "string" ? parseLocalResult(result, "text") : result;
}
export async function summarizeWorkout(
  summary: WorkoutRecapInput,
  options: IntelligenceOptions = {},
): Promise<LocalTextResult> {
  const result = await run("recap", { summary }, options);
  return typeof result === "string" ? parseLocalResult(result, "text") : result;
}
export async function cancelAllIntelligence(): Promise<void> {
  await native?.cancelAll().catch(() => undefined);
}
/** Opaque route only; no workout titles, metrics, names, or authentication data. */
export async function setNextSessionShortcut(
  url: string | null,
  expiresAtMs: number | null,
): Promise<void> {
  await native
    ?.setNextSessionShortcut(url, expiresAtMs === null ? null : expiresAtMs / 1_000)
    .catch(() => undefined);
}
