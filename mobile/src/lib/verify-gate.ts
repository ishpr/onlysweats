import { useRouter } from "expo-router";

// Registers the sheet with the app-wide provider.
import "@/components/verify-gate-sheet";

import { ApiError } from "./api";
import { useGlobalSheets } from "./global-sheets";
import type { VerificationTier } from "./types";

const TIERS: Record<string, VerificationTier> = {
  verify_member: "member",
  verify_government_id: "government_id",
};

/**
 * The server refuses a post or a join with `verify_member` / `verify_government_id`
 * when there is something to verify first. That isn't an error to show: it's a moment to
 * explain, with a way there. Returns true when it handled the refusal.
 */
export function useVerifyGate() {
  const router = useRouter();
  const sheets = useGlobalSheets();
  return (err: unknown): boolean => {
    const tier = err instanceof ApiError && err.code ? TIERS[err.code] : undefined;
    if (!tier) return false;
    // Another app-wide sheet is already up: go straight there rather than stack.
    if (!sheets.open("verify-gate", { tier }))
      router.push({ pathname: "/verify", params: { tier } });
    return true;
  };
}
