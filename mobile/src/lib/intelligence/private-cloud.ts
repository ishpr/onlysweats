/** Separate from all on-device APIs. Never call this as an automatic fallback. */
export type PrivateCloudCapability = {
  available: boolean;
  reason: string | null;
  execution: "apple_private_cloud";
  quota: "unknown" | "below_limit" | "approaching_limit" | "limit_reached";
  resetAt: string | null;
};
export type PrivateCloudResult =
  | {
      status: "available";
      text: string;
      execution: "apple_private_cloud";
    }
  | {
      status: "unavailable" | "cancelled" | "error";
      reason: string;
      execution: "apple_private_cloud";
    };
const reasons = new Set([
  "entitlement_not_configured",
  "native_module_missing",
  "unsupported_platform",
  "unsupported_os",
  "device_not_eligible",
  "model_not_ready",
  "unavailable",
  "quota_reached",
  "network_unavailable",
  "service_unavailable",
  "cloud_consent_required",
  "invalid_input",
  "busy",
  "timeout",
  "cancelled",
]);
const reason = (value: unknown) =>
  typeof value === "string" && reasons.has(value) ? value : "unavailable";
export const privateCloudFailure = (
  status: "unavailable" | "cancelled" | "error",
  code: string,
): PrivateCloudResult => ({ status, reason: reason(code), execution: "apple_private_cloud" });
export function parsePrivateCloudResult(raw: string): PrivateCloudResult {
  try {
    if (raw.length > 32_000) throw new Error();
    const value = JSON.parse(raw);
    if (value.execution !== "apple_private_cloud") throw new Error();
    if (
      value.status === "available" &&
      typeof value.text === "string" &&
      value.text.trim() &&
      value.text.length <= 4_000
    ) {
      return { status: "available", text: value.text, execution: "apple_private_cloud" };
    }
    if (["unavailable", "cancelled", "error"].includes(value.status))
      return privateCloudFailure(value.status, reason(value.reason));
  } catch {
    /* Do not expose malformed native/provider errors or payloads. */
  }
  return privateCloudFailure("error", "unavailable");
}
export function parsePrivateCloudCapability(raw: string): PrivateCloudCapability {
  const fallback: PrivateCloudCapability = {
    available: false,
    reason: "unavailable",
    quota: "unknown",
    resetAt: null,
    execution: "apple_private_cloud",
  };
  try {
    if (raw.length > 4_000) return fallback;
    const value = JSON.parse(raw);
    if (
      value.execution !== "apple_private_cloud" ||
      typeof value.available !== "boolean" ||
      !["unknown", "below_limit", "approaching_limit", "limit_reached"].includes(value.quota)
    )
      return fallback;
    if (value.available && !["below_limit", "approaching_limit"].includes(value.quota))
      return fallback;
    return {
      available: value.available,
      reason: value.available ? null : reason(value.reason),
      quota: value.quota,
      resetAt:
        typeof value.resetAt === "string" &&
        value.resetAt.length <= 40 &&
        Number.isFinite(Date.parse(value.resetAt))
          ? value.resetAt
          : null,
      execution: "apple_private_cloud",
    };
  } catch {
    return fallback;
  }
}
export const PRIVATE_CLOUD_NOTICE =
  "This sends only the text you explicitly submit to Apple's Private Cloud Compute. It needs a connection and has daily limits. Photos and health history are not attached. Nothing is saved, shared with another member, or booked automatically.";
