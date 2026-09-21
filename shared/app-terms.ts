/** Product terms acceptance; source permissions and action approvals still apply. */
export const APP_TERMS_VERSION = "samepace-2026-09-21" as const;
export const APP_TERMS_COACHING_NOTICE =
  "SamePace includes AI coaching. Your private conversations, relevant planning information and bounded recent saved plans and entered workout results may go to our cloud AI provider through Vercel when useful to your request. Summaries of imported Apple Health workouts, including recorded heart-rate summaries, may also be used; Apple Health access and syncing still require your separate permission. TypeSafe/Jev may help interpret exercise notes you submit and selected workout summaries. Plans are targets, entered results are your records, and missing measurements stay unknown. AI replies and suggestions can be wrong and are not medical advice. Conversations are kept for up to 30 days unless cleared sooner. This does not enable pilot telemetry or share private records with buddies or A2A agents. Saving workouts, changing preferences, booking, sharing and payments still require your review. Existing privacy opt-outs are preserved; you can review or change these choices in privacy controls.";

export type AppTermsStatus = {
  ownerId: string;
  version: typeof APP_TERMS_VERSION;
  accepted: boolean;
  acceptedVersion: string | null;
  acceptedAt: string | null;
};
