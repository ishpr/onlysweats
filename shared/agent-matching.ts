/** Matching is included in current product Terms; these are privacy/status controls. */
export type AgentMatching = {
  enabled: boolean;
  ready: boolean;
  reason: string | null;
  needs: string | null;
  lastCheckedAt: string | null;
  womenOnly: boolean;
  canChooseWomenOnly: boolean;
};
export type AgentMatchingInput = { enabled: boolean; womenOnly?: boolean };
