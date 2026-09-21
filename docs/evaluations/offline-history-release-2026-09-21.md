# Offline workouts and optional coaching history — September 21, 2026

This functional continuation leaves visual redesign to Claude. It adds durable offline logging for already-started/opened workouts and separately consented recent manual-workout context for the cloud assistant.

## Verified with synthetic fixtures

- Server services and actual mobile queue reducers together: empty actuals at workout start; multiple member-entered sets; interrupted/lost save response; later edits while the exact request remains pending; identical retry; preserved finish timestamp; one final database record; explicit partial completion; second-device changes and revoked sharing followed by reviewed reconciliation.
- Embedded and real PostgreSQL tests: owner isolation, separate versioned consent, bounded context and omissions, every successful plan/run/log mutation invalidating derived conversation, old replies losing their generation, unchanged retry preserving chat, and concurrent writes/deletion/booking/privacy locks.
- Real AI SDK with mocked model output: manual context cannot select an arbitrary owner, errors stop further model processing, and privacy options remain enforced. No live model requests or model-quality claims are part of these tests.
- Mobile storage and synchronization logic tests with injected storage/transport: complete document restart/reload, actual-versus-target distinction, immutable pending payloads, late edits after acknowledgement, semantic comparison independent of JSON key order, strict parsing, capacity, expiry, token/owner isolation, account-switch/late-write fences, failed writes, bounded request timeout, deleted records and explicit conflict recovery.

Review found and corrected dropped rapid field updates, stale account-cache lease renewal, stale note reconciliation, online logging being unnecessarily blocked by unavailable protected storage, and late network results resurrecting removed device copies. The online-only editor remains available as a fallback. The current signed iPhone client already contains the Expo Crypto AES implementation used by this JavaScript update; no new native dependency was added.

The isolated Vercel Preview at backend commit `95a737e` passed 40 authenticated HTTP checks, including independent consent, provider-disabled behavior, idempotent result retries, changed-payload rejection, stale-revision conflict, deletion, exports and weekly totals. Both disposable accounts were deleted and their sessions were verified invalid. The backend build and 176 related service checks (including real PostgreSQL) also passed. The full suite then passed all 856 tests across 96 suites, with real PostgreSQL enabled and no skips. Root/mobile typechecks, lint, the authentication invariant check and an iOS JavaScript bundle export passed. These are software checks, not physical-device acceptance.

## Limits and required acceptance

Offline copies are capped at ten opened workouts, expire seven days after their last device save/refresh, and require the same sign-in token plus an account check within 24 hours. New workouts start online. Pending results do not appear in server totals or buddy progress until acknowledged. Conflicts require explicit comparison and a choice; current sharing revocation remains authoritative. Synchronization is driven by the foreground editor, not a new operating-system background task.

The cloud permission is off by default and independent of Apple Health consent. It includes at most three saved plans, three structured records and five exercise logs, with further per-record and 12,000-byte limits and omission labels. It does not grant A2A access, change on-device model context or enable automatic actions.

Physical iPhone keychain/file interruption behavior, a complete disconnected workout and app restart, two-device sharing conflicts, account switching, expiry and actual model quality remain acceptance work. After the owner added Gateway credits, a synthetic model probe succeeded with both privacy flags. Cloud chat remains disabled pending live evaluation. No production payment activation or identity-enforcement activation occurred.

See [the release checklist](../RELEASE-CHECKLIST.md), [workout behavior](../WORKOUT-PLANS.md) and [remaining functional work](../FUNCTIONAL-HANDOFF.md).
