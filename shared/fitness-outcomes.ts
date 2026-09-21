/** Optional pilot measurements. No exercise notes, weights, or model answers. */
export const FITNESS_PILOT_NOTICE_VERSION = "fitness-pilot-v1" as const;
export const FITNESS_PILOT_NOTICE =
  "Help improve optional exercise drafts by sharing whether suggested fields stayed the same or changed when you saved, time from starting an optional measurement to saving, and optional feedback about usefulness and time saved. We do not put your notes, exercise values, or model responses in these measurements. Timings include pauses and are not proof of time saved. Records expire after 30 days. Turning this off, turning off AI assistance, deleting the related log, or deleting your account removes the associated measurements.";
export type FitnessPilotConsent = {
  enabled: boolean;
  generation: string | null;
  noticeVersion: typeof FITNESS_PILOT_NOTICE_VERSION;
  updatedAt: string | null;
};
export type FitnessLoggingSession = { id: string; expiresAt: string };
export type FitnessDraftMeasurement = { sessionId: string; draftId: string };
export type FitnessSaveMeasurement = { sessionId: string; draftId?: string };
export type FitnessPilotFeedback = {
  helpfulness: "helpful" | "neutral" | "not_helpful" | "unknown";
  timeSaved: "yes" | "no" | "unsure";
};
export type FitnessPilotOutcome = {
  sessionId: string;
  logId: string | null;
  startedAt: string;
  savedAt: string | null;
  status: "open" | "saved" | "expired";
  mode: "no_linked_draft" | "linked_draft" | "unobserved_draft_use";
  draftStatus: "available" | "insufficient_data" | "provider_unavailable" | null;
  /** Server time between start and save; includes network delays and inactivity. */
  elapsedMs: number | null;
  suggestedFields: number;
  unchangedSuggestedFields: number | null;
  changedSuggestedFields: number | null;
  filledMissingFields: number | null;
  comparisonRevision: number | null;
  feedback: FitnessPilotFeedback | null;
};
export type FitnessPilotAggregateGroup = {
  mode: FitnessPilotOutcome["mode"];
  members: number;
  savedLogs: number;
  suggestedFields: number;
  unchangedSuggestedFields: number | null;
  changedSuggestedFields: number | null;
  filledMissingFields: number | null;
  medianElapsedMs: number;
  p95ElapsedMs: number;
};
export type FitnessPilotOverview = {
  since: string;
  retentionDays: 30;
  minimumMembers: 5;
  suppressed: boolean;
  summary: null | {
    members: number;
    sessionsStarted: number;
    savedLogs: number;
    expiredWithoutSave: number;
    draftAvailable: number;
    draftAbstained: number;
    providerUnavailable: number;
    helpful: number;
    neutral: number;
    notHelpful: number;
    feedbackUnknown: number;
    reportsTimeSaved: number;
    reportsNoTimeSaved: number;
    timeSavedUnsure: number;
    feedbackResponses: number;
  };
  groups: FitnessPilotAggregateGroup[];
  /** Not inferred from timing comparisons. Only explicit member reports above. */
  measuredTimeSavedMs: null;
};
