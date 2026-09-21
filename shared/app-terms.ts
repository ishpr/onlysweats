/** Product terms acceptance; source permissions and action approvals still apply. */
export const APP_TERMS_VERSION = "samepace-2026-09-21-agent-chats" as const;
export const APP_TERMS_COACHING_NOTICE =
  "SamePace includes AI coaching and agent matching. Your private conversations, relevant planning information and bounded recent saved plans and entered workout results may go to our cloud AI provider through Vercel when useful to your request. Summaries of imported Apple Health workouts, including recorded heart-rate summaries, may also be used; Apple Health access and syncing still require your separate permission. TypeSafe/Jev may help interpret exercise notes you submit and selected workout summaries. Plans are targets, entered results are your records, and missing measurements stay unknown. AI replies and suggestions can be wrong and are not medical advice. Private coaching conversations are kept for up to 30 days unless cleared sooner. Your agent automatically uses your saved activity, ability, public venues and available times to find compatible members, initiate contact with their agents and exchange bounded workout proposals. Members can read those exchanges in Chats. Matching shares your first name and entered planning information with the matched member and their agent; private coaching conversations, imported health records and private workout results are excluded. You can pause matching or withdraw from a conversation. Both people must approve the workout plan and booking terms; agents cannot make these approvals or authorize payments. Saving workout results and changing preferences still require your review. This does not enable pilot telemetry. Existing privacy opt-outs are preserved; you can review or change these choices in privacy controls.";

export type AppTermsStatus = {
  ownerId: string;
  version: typeof APP_TERMS_VERSION;
  accepted: boolean;
  acceptedVersion: string | null;
  acceptedAt: string | null;
};
