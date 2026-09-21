import { useRouter } from "expo-router";

import { ApiError } from "./api";
import type { VerificationTier } from "./types";

const TIERS: Record<string, VerificationTier> = {
  verify_member: "member",
  verify_government_id: "government_id",
};

/**
 * The server refuses a post or a join with `verify_member` / `verify_government_id`
 * when there is something to verify first. That isn't an error to show: it's
 * somewhere to go. Returns true when it sent the member there.
 */
export function useVerifyGate() {
  const router = useRouter();
  return (err: unknown): boolean => {
    const tier = err instanceof ApiError && err.code ? TIERS[err.code] : undefined;
    if (!tier) return false;
    router.push({ pathname: "/verify", params: { tier } });
    return true;
  };
}
