import { requireOptionalNativeModule } from "expo-modules-core";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import type { IntelligenceHistory, IntelligenceOptions } from "../../src/lib/intelligence/types";
import {
  parsePrivateCloudCapability,
  parsePrivateCloudResult,
  privateCloudFailure,
  type PrivateCloudCapability,
  type PrivateCloudResult,
} from "../../src/lib/intelligence/private-cloud";

type PrivateCloudBridge = {
  pccCapability(): Promise<string>;
  runPccRequest(request: string): Promise<string>;
  cancelPcc(requestId: string): Promise<void>;
  addListener(
    event: "onPccResponse",
    listener: (event: { requestId: string; text: string }) => void,
  ): { remove(): void };
};
const native =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<PrivateCloudBridge>("SamePaceIntelligence")
    : null;
const absent = () => (Platform.OS === "ios" ? "native_module_missing" : "unsupported_platform");
export async function getPrivateCloudCapability(): Promise<PrivateCloudCapability> {
  const fallback: PrivateCloudCapability = {
    available: false,
    reason: absent(),
    quota: "unknown",
    resetAt: null,
    execution: "apple_private_cloud",
  };
  if (!native?.pccCapability) return fallback;
  try {
    return parsePrivateCloudCapability(await native.pccCapability());
  } catch {
    return fallback;
  }
}
/** Caller must have shown the cloud notice and obtained an explicit send action.
 * Never reuse local/photo history when switching mode. The default native build
 * rejects this call before creating a model because PCC is not provisioned. */
export async function respondWithPrivateCloud(
  text: string,
  history: IntelligenceHistory[],
  options: IntelligenceOptions & { allowAppleCloud: true },
): Promise<PrivateCloudResult> {
  if (options.allowAppleCloud !== true)
    return privateCloudFailure("error", "cloud_consent_required");
  if (options.signal?.aborted) return privateCloudFailure("cancelled", "cancelled");
  if (
    !text.trim() ||
    text.length > 1_000 ||
    history.length > 6 ||
    history.some((m) => !["user", "assistant"].includes(m.role) || m.text.length > 2_000) ||
    history.reduce((sum, m) => sum + m.text.length, text.length) > 6_000
  )
    return privateCloudFailure("error", "invalid_input");
  if (!native?.runPccRequest) return privateCloudFailure("unavailable", absent());
  const requestId = options.requestId ?? Crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(requestId))
    return privateCloudFailure("error", "invalid_input");
  let closed = false;
  let stop!: (value: PrivateCloudResult) => void;
  const stopped = new Promise<PrivateCloudResult>((resolve) => {
    stop = resolve;
  });
  const cancel = (timeout = false) => {
    closed = true;
    void native.cancelPcc(requestId).catch(() => undefined);
    stop(privateCloudFailure(timeout ? "error" : "cancelled", timeout ? "timeout" : "cancelled"));
  };
  const abort = () => cancel();
  const listener = native.addListener("onPccResponse", (event) => {
    if (
      !closed &&
      event.requestId === requestId &&
      typeof event.text === "string" &&
      event.text.length <= 4_000
    )
      options.onPartial?.(event.text);
  });
  const timer = setTimeout(() => cancel(true), 35_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const pending = native
      .runPccRequest(JSON.stringify({ requestId, text, history, allowAppleCloud: true }))
      .then(parsePrivateCloudResult)
      .catch(() => privateCloudFailure("error", "unavailable"));
    if (options.signal?.aborted) abort();
    return await Promise.race([pending, stopped]);
  } finally {
    closed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    listener.remove();
  }
}
