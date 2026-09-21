/** Shared wire contract. Preferences are member-entered, never inferred health facts. */
import type { Ability, Activity } from "../src/lib/pace/types.ts";

export type AssistantPlan = {
  title: string;
  venueId: string;
  activity: Activity;
  ability: Ability;
  startAt: string;
  durationMin: number;
};
export type AssistantPreferencesInput = {
  enabled: boolean;
  activity: Activity;
  ability: Ability;
  durationMin: number;
  venueIds: string[];
  availability: { startAt: string; endAt: string }[];
  approvedIntent: string;
};
export type AssistantPreferences = AssistantPreferencesInput & {
  revision: number;
  updatedAt: string | null;
};
export type AssistantCandidates = {
  candidates: AssistantPlan[];
  reason: string | null;
  preferenceRevision: number;
  partnerPreferenceRevision: number;
};
export type AssistantNegotiation = {
  id: string;
  bookingId: string | null;
  memberIds: string[];
  memberNames?: Record<string, string>;
  consentedIds: string[];
  state: "open" | "approved" | "cancelled" | "expired";
  revision: number;
  plan: AssistantPlan | null;
  confirmedIds: string[];
  expiresAt: string;
  booked: boolean;
  sessionId: string | null;
  resultBookingId: string | null;
};
export type AssistantHistoryEvent = {
  sequence: number;
  actorId: string;
  kind: "consent" | "proposal" | "confirmation" | "cancel" | "booking_approval" | "booked";
  revision: number;
  data: Record<string, unknown>;
  createdAt: string;
};
export type AssistantBookingTerms = {
  revision: number;
  termsHash: string;
  hostId: string;
  participantId: string;
  plan: AssistantPlan;
  visibility: "unlisted";
  capacity: 2;
  lateCancelFeeCents: number;
  noShowFeeCents: number;
  lateCancelHours: number;
  currency: "USD";
  chargeNowCents: 0;
  paymentCollectionEnabled: false;
};
export type AssistantBookingReview = {
  terms: AssistantBookingTerms;
  approvedIds: string[];
  booked: boolean;
  sessionId: string | null;
  bookingId: string | null;
};

/** Permission to propose only. It never authorizes confirmation or booking. */
export type AssistantCoordinationPermission = {
  memberId: string;
  enabled: boolean;
  valid: boolean;
  preferenceRevision: number;
  negotiationRevision: number;
  expiresAt: string;
};
export type AssistantCoordinationRun = {
  id: string;
  status: "queued" | "negotiating" | "awaiting_review" | "no_match" | "cancelled" | "expired";
  reason: string | null;
  baseRevision: number;
  proposalRevision: number;
  stepsUsed: number;
  maxSteps: number;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
  steps: {
    number: number;
    memberId: string;
    action: "proposed" | "counterproposed" | "checked_preferences" | "ready_for_review";
    proposalRevision: number;
    createdAt: string;
  }[];
};
export type AssistantCoordination = {
  negotiationId: string;
  permissions: AssistantCoordinationPermission[];
  latestRun: AssistantCoordinationRun | null;
  ready: boolean;
  reason: string | null;
};
