# Workout reliability — September 21, 2026

This functional pass builds on `21a68a8` on `main`, including Claude's PR #39. It changes timer recovery and imported-health freshness without a design pass. All data used below is synthetic and confined to disposable test databases, unsaved native fixtures or a local acceptance service. No member health records, production workout results, live bookings, payments or provider calls were created by these checks.

## Durable timer and offline store checks

The timer engine now saves epoch-based checkpoints rather than relying on a mounted foreground interval. A started exercise or rest clock can continue through navigation, locking and process restart; explicit pause excludes paused time. Timers do not create completed sets, health observations or actual duration fields by themselves. The member must pause, choose the elapsed duration, review it and save the completed set.

The automated engine tests cover fractional seconds, pause/resume/reset, serialization and reanchoring without double counting, restored running and paused clocks, account/set identity changes, invalid checkpoints, backwards time and the bounded 24-hour interval. An unknown elapsed duration remains unknown across another restart. The optional monotonic drift detector is tested as an engine capability; the current native hook uses wall time, so these checks do not prove detection of every device clock adjustment.

The engine is composed with the actual offline document validator, protected-store abstraction and upload acknowledgement functions. These tests establish that:

- Old documents without a timer remain readable. A corrupt timer is dropped without deleting valid workout actuals.
- A timer belongs to one exact prescription/set and its current actuals. A queued callback cannot replace or clear a newer clock.
- Uploading an earlier set excludes timer state from the server payload; its acknowledgement preserves the active clock and still-unrecorded duration.
- A compatible server refresh preserves a saved rest clock. New actuals, conflicts and finishing invalidate an incompatible clock.
- Failed storage, deletion, logout, an expired owner lease and logout during a delayed write cannot acknowledge or resurrect a clock for another identity.

These storage tests use the real store logic with deterministic memory-backed protected I/O. They are not a physical Keychain/file-system durability test. Native storage absence retains the existing online fallback with a visible limitation; it does not promise restart recovery.

## Imported health source and controller checks

Five new integration tests exercise the actual mobile sync controller against the actual health persistence service in embedded PostgreSQL, rather than duplicating server behavior in a mock transport. They cover:

- A lost response after a committed page, resumption from its durable anchor, a source correction, a replacement UUID, exact duplicate replay and a tombstone that prevents resurrection.
- Withdrawing a selected type while a native page is pending: its old generation is rejected without advancing cursors or importing a subsequent type.
- An account switch during a native read: its transient page never reaches persistence.
- Disconnect during a dispatched connection update: the controller waits for that request and then purges the resulting connection and cursors.
- Late heart-rate readings and source corrections after coaching has read a workout summary. Changed observations now clear dependent history and invalidate the active reply lease before another stale delta can be emitted. Unchanged reimports preserve the completed conversation.

The change reuses the existing owner lock and privacy invalidation boundary. Measured source records remain distinct from editable corrections, manual sets and model interpretations. Server and controller tests continue to cover owner isolation, unit and batch validation, transactional cursor writes, retry limits, fixed import windows, source deletions, generation changes and explicit connection selection. HealthKit read authorization remains opaque: an empty result cannot prove either permission or its revocation.

The native reader previously used `strictStartDate`, excluding an interval that started before the fixed import boundary even when it ended inside the window. The server explicitly supports overlapping source intervals. The reader now uses the matching inclusive-overlap predicate. The real iOS 27 HealthKit fixture executable checks an overlapping sleep sample and workout, excludes a wholly older heart-rate sample, and includes a sample exactly on the boundary. Existing units, secure anchors, missing-value and invalid-record checks also pass. Fixtures are never saved to a HealthKit store. The existing deprecated workout-fixture constructor warning remains.

The native predicate correction requires the next iPhone binary. Existing anchors do not automatically backfill intervals omitted by the former predicate. Actual HealthKit permission changes, locked-store reads, multiple recording sources and multiple phones remain device acceptance cases.

## A2A to shared workout composition

The added end-to-end service test uses two official A2A SDK clients against the in-process protocol adapter and a disposable embedded database. It completes mutual negotiation consent, proposal/counterproposal, revision fencing, both members' exact booking-term approvals and one booking. Duplicate commands and approval retries do not create duplicate records. A revoked delegate loses access; it cannot perform the member's booking action.

The host then attaches a reviewed routine to the confirmed session. Private library edits leave the shared copy fixed. Each member explicitly starts a separate private workout against the exact reviewed plan revision, with no actuals prefilled. Independently entered durations remain private; optional buddy visibility includes only approved summary counts. Turning sharing off, withdrawing negotiation consent and blocking are checked separately. Delegated task responses expose neither private actuals, notes nor health readings. Workout activity never awards attendance or creates a payment ledger entry.

This proves protocol/service composition with synthetic members. It is not a live two-person workout, push-delivery, human approval usability or external-agent interoperability evaluation.

## Verification

- Initial full automated run: **929 passed, 0 failed, 13 skipped**. The skips were explicitly gated real-PostgreSQL suites because no test database URL was configured.
- Full rerun against disposable loopback-only PostgreSQL 17: **964 passed, 0 failed, 0 skipped**. All real database suites ran. No temporary test schemas remained, and the disposable container was removed.
- Root and mobile typechecks: passed.
- Focused root/mobile lint for every changed TypeScript/JavaScript source and test: passed without warnings.
- Focused health/controller suite: **54 passed**. Existing conversation/fitness suites: **36 passed**.
- Real iOS 27 HealthKit fixture executable: passed with unsaved samples and the existing fixture deprecation warning.
- iOS production JavaScript export: passed (Hermes bundle), using the live API setting and no development token.
- Rendered iPhone 18 Pro / iOS 27 simulator: the actual native protected-store path was exercised against an isolated loopback synthetic service. A running timer continued through a visible screen lock; a paused 55-second timer restored unchanged after a full JavaScript reload. Its actual field remained empty until explicit confirmation.
- With the synthetic API stopped, confirming and saving that set retained the 55-second result locally and created its rest clock. A second timer started offline, survived another full JavaScript reload, and continued running after reopening the saved workout. Reconnecting synced the first result while preserving the second timer and its empty actual field. The second result was then explicitly paused, reviewed and saved at 52 seconds. A paused rest clock restored at the same six seconds remaining after another reload; skipping rest removed it. Finishing required review of the four unrecorded sets. The loopback service then held one finished workout, exactly two completed results (55 and 52 seconds), and no invented results for the remaining sets.

These rendered checks exercised native protected storage across JavaScript runtime reloads, not an OS process kill or physical-device data-protection behavior. They do not replace the remaining physical acceptance below.

Full test, type and lint logs are retained locally under `.vercel/reliability-acceptance/`; they are not committed. The real-PostgreSQL runner records test-schema cleanup and removes its disposable container when finished.

## Remaining physical acceptance

On the signed iPhone build, verify a complete timed workout through screen lock, force quit/relaunch, offline set entry and reconnect. Check explicit pause/review/save, rest recovery, failed protected writes and account switching. Exercise the new native import boundary with real HealthKit records and verify user-driven source changes and permission behavior. Run a genuine two-member shared workout with sharing withdrawal and accessibility tools. These checks remain necessary even when the synthetic suite and simulator pass.
