# Backlog release acceptance — September 21, 2026

This release adds opt-in first-time discovery, bounded automatic planning, optional fitness-pilot measurement, Stripe billing, reliable Persona cleanup, mobile app links and operating views. It includes the existing Persona implementation from PR #22. Work was isolated on `codex/backlog-completion`; the separate design worktree was not edited.

## Verified

- **590 tests passed, zero failures and zero skips**, including tests against disposable PostgreSQL for concurrent bookings, planning, health imports, billing and background jobs. Provider responses in these tests are synthetic.
- Web TypeScript, lint and production build passed. Lint retains two pre-existing warnings in `venue-map.tsx` and `use-current-user.ts`; no new errors.
- Mobile TypeScript, lint, 15 focused checks, iOS export and web export passed. The production API URL was used with no development bearer token. The configured Jev secret was absent from source and exported client bundles.
- Eleven checks through the actual local HTTP router passed: authentication, separate AI/pilot/discovery permissions, log revisions/export, scoped A2A access, revoked credentials, admin restrictions and account deletion. The temporary member was deleted.
- Mobile browser acceptance covered manual logging and pilot feedback, discovery consent, both members' planning authorization, zero automatic human approvals, revocation, disabled billing and destination preservation after expired-session sign-in. Temporary accounts were deleted.
- The admin browser rendered aggregate/withheld pilot results and fee disputes without page errors. A synthetic waiver action sent the expected resolution and refreshed the queue. This used browser fixtures, not an actual Stripe transaction.
- Independent payment review found and verified the correction for a cancellation blocker: a fee/refund failure no longer prevents Stripe customer deletion or subscription cancellation. Lost checkout/deletion responses remain recoverable; unrelated fee failures no longer stale membership reconciliation.
- The [cloud restore rehearsal](neon-restore-2026-09-21.md) restored both original synthetic canaries in 2.738 seconds after the restore request. Both temporary branches were deleted. No existing branch or member data was changed.

## Native build

The first build (`d9a8face-4320-40bc-9aae-40488ad14760`) failed because the existing Apple provisioning profile lacked Associated Domains. The valid Apple session enabled that capability and regenerated only the SamePace ad hoc profile. The existing selected iPhone, shared distribution certificate and widget profile were preserved; mobile source was unchanged.

Replacement build: [0ae3901c-d73d-4aa8-8c1c-e279bda74235](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/0ae3901c-d73d-4aa8-8c1c-e279bda74235). Build completion and physical installation are separate acceptance steps; consult the build page for its current status. The device profile uses the live SamePace API with Expo development-client updates.

## Deliberately unclaimed

Stripe and Persona accounts are not set up. Collection and enforcement remain off. No real payment, identity-verification session, health sensor acceptance, app-link device acceptance, member-pilot outcome, production-scale failover or battery result is implied by these checks. The existing Jev key remains server-only in Vercel; no additional live inference evaluation was run for this release.

The [remaining acceptance checklist](../VISION-ROADMAP.md) records provider configuration, physical-device checks, representative member evaluation, operational ownership and future scope choices.
