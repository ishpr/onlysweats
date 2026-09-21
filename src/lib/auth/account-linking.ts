/** Ownership of the pre-existing account must be verified before auto-linking. */
export const accountLinkingPolicy = {
  enabled: true,
  requireLocalEmailVerified: true,
} as const;
