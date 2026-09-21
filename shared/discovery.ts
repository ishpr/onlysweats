import type { Activity } from "../src/lib/pace/types.ts";
export const DISCOVERY_NOTICE =
  "For the next 7 days, use my entered activity, ability, public meeting venues and available times to find compatible workout partners. Show my name and activity to other members who also opt in, and let them invite me to plan. My exact times and planning notes stay private until we both join a conversation. This does not share Apple Health data, start an agent, or book a workout. Editing my preferences pauses discovery until I enable it again.";
export type MemberDiscovery = {
  enabled: boolean;
  expiresAt: string | null;
  eligible: boolean;
  candidates: { memberId: string; name: string; activity: Activity; sharedVenueCount: number }[];
  reason: string | null;
};
