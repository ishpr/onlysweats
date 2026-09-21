# SamePace: remaining work

The vision is a reliable workout community with real fitness records, Jev-assisted interpretation, and personal agents that coordinate workouts for members. This is the working delivery checklist; unchecked items are pending, not shipped capabilities.

**Agreed first data source: Apple Health sync.** Import actual workouts and the other authorized, available metrics useful to the feature. Start with stored records; a custom watch recorder is a later option if live capture becomes necessary. An Apple Health sync is not a promise of an immediate heartbeat stream.

## Already implemented

- Social workout posting/joining, arrival check-in, standing slots, ratings, blocking/reporting, account deletion, and admin tools.
- Training blocks, public discovery/joining, goal credits, end-of-block decisions, and admin controls from the current main branch.
- Repository fixes for the 17 audited gaps, including session-level host attendance, recurring-session eligibility, mobile navigation, delivery retries, Apple revocation retries, and deployment-setup isolation checks.
- A2A 1.0 discovery, scoped revocable credentials, mutual consent, durable proposals/counteroffers, revision checks, and separate member approvals. The feature defaults to off. Separate, exact-term approval by both members can now create one normal booking; delegated agents cannot perform that approval.
- The project TypeSafe skill, server-only Jev adapter, separate inference consent, editable exercise drafts, and bounded workout-note interpretation. See [Jev fitness](./JEV-FITNESS.md) for live evaluation results and remaining acceptance.
- The first [Apple Health import](./APPLE-HEALTH.md): native read-only reader, private records and API, account-bound manual sync, tombstones/purge, source-based summaries, and standalone workout screen. The production Health API has been enabled. The release combines redesigned navigation, private exports, manual exercise logs, and persistent correction overlays; physical-device acceptance remains pending.

## 1. Verify the release baseline

- [ ] **R1 — Verify deployed database isolation and migrations.** Migrations 0001–0017 rehearse successfully on disposable PostgreSQL 17; three concurrent deploy migrators serialize correctly. Created a schema-only Neon preview branch, verified it contains no copied accounts or health records, applied release migrations there, and pointed Vercel preview at it with a fresh separate auth secret. Production was unchanged. Neon currently retains six hours of history; backup/restore rehearsal and the required retention policy remain pending.
- [ ] **R2 — Exercise real devices and providers.** On physical iOS/Android builds, verify sign-in, invite preservation, check-in, ratings, repeat/leave/skip, training blocks, notifications, blocking, and account deletion. Verify the actual Android OAuth client/signing identity, Google production publishing, APNs/FCM credentials, Apple revocation credentials, and cron operation. Console configuration is not proven by local tests.
- [x] **R3 — Review historical settlement exposure.** A read-only production check on September 21 found zero ledger events and zero settled bookings. There were no historical settlements to correct. Keep [the reconciliation guide](./settlement-reconciliation.md) for future incidents; no production history was rewritten.
- [ ] **R4 — Finish concurrent production-database acceptance.** Real PostgreSQL tests now prove one booking from eight concurrent human approvals, one winner when ordinary posting races assistant booking in either order, one acknowledged duplicate health page, and no deadlock for reciprocal joins or early check-in racing a late join. Settlement, training advancement, push receipts, and revocation jobs retain embedded-Postgres tests; extend real-Postgres coverage for those workflows.
- [x] **R5 — Keep prototype health data visibly separate.** Web demo screens now have a persistent simulation label, and misleading Health connection, writeback, and identity-verification claims are removed. These records never enter the real private health domain.

## 2. Build real private fitness records and Apple Health sync

- [x] **H1 — Add a workout domain separate from attendance.** Owner-only records retain source, external ID, source revision, timestamps, and units. Account deletion cascades health data; check-ins never invent exercise measurements. Optional social-booking associations can follow separately.
- [ ] **H2 — Accept the native HealthKit connection on an actual iPhone.** Reader, selected types, permission prompt, unavailable/last-sync/disconnect states, and unsigned iOS simulator build are implemented. Physical-device permissions, locked-device behavior, and real source records still need verification before enabling rollout.
- [ ] **H3 — Accept incremental sync with real source changes.** Server-owned anchors, atomic pages, duplicate prevention, deletions, retry/cancellation, and account-switch tests are implemented. Verify source replacements, permission changes, multiple devices, and interruptions against real HealthKit. Sync is currently manual; background delivery is later work if needed.
- [x] **H4 — Calculate imported-workout summaries in code.** Elapsed time, source active-duration pace, units, distance, and source-bound heart-rate sample statistics are tested. Manual strength logs calculate repetitions and known load volume. Missing metrics stay null. Optional daily/context aggregates await their own features.
- [x] **H5 — Complete the private workout experience.** Redesigned You navigation opens Apple Health, private exercise logging, and workout details. Members can export all source records or fitness logs, edit/delete exercises and sets, and retain title/note/activity corrections across resync. Source facts remain separate.
- [x] **H6 — Complete the data-use controls.** Separate versioned TypeSafe consent gates each inference request. Revocation removes saved interpretations and invalidates in-flight results. Entered planning preferences use a separate sharing control; raw HealthKit records never enter A2A.

**Complete when:** a real workout and its available metrics sync into the correct member's account, survive resync and corrections, disappear when deleted under the chosen policy, and never display an invented measurement.

## 3. Make Jev useful inside fitness tracking

- [x] **J1 — Add the server-only TypeSafe adapter.** Implemented the documented HTTP API with a pinned model, versioned questions, bounded state/responses, validation, deadline, per-member request budgets, and metadata-only operational logs. The user-provided key is stored as a Vercel production/preview Secret and in an ignored owner-only local server file. Live evaluation and rollout remain separate checks below.
- [x] **J2 — Ship an editable exercise-log draft.** Jev selects catalogue exercises and numeric source spans. Code normalizes explicit values and units; unknown repetitions/load remain blank. Nothing saves until the member reviews and submits it. Manual logging remains available without inference.
- [ ] **J3 — Accept contextual workout interpretation.** Implemented selected-workout summary plus explicit goal/note interpretation, fully separated from measurements. Validate with representative member notes before a wider pilot. Segment labels, physiological advice, and recovery scores are not implemented.
- [x] **J4 — Handle uncertainty, outages, and stale answers.** Unknown/unavailable states preserve manual logging. Full authorized snapshot fingerprints, consent generations, ownership, and revision checks reject stale results, including late heart-rate samples and correction changes.
- [ ] **J5 — Evaluate fitness accuracy and useful abstention.** Live synthetic evaluation is recorded in docs/evaluations: revised and held-out exercise fixtures had 41 correct proposed fields, zero observed wrong filled fields, and 9/18 complete drafts; workout-note fixtures matched 9/9 expected outcomes. Initial failures remain in the report. Add representative real-user corrections and time-saved comparisons; these small fixtures do not establish general accuracy.
- [ ] **J6 — Measure the complete experience.** Provider metadata records latency and token usage. The admin reliability view reports request p50/p95/p99, failures, conflicts, import activity and assistant bookings. Measure real-user correction rates, request cost, end-to-end time saved, and device battery impact before broad rollout.

**Complete when:** members can produce a correct, editable workout record with less effort, using real data, with observed accuracy and latency rather than assumptions based on typed output.

## 4. Turn A2A into a member-facing assistant

- [x] **A1 — Add assistant controls in the app.** Issue/revoke scoped credentials, manage preference sharing, opt into conversations, withdraw consent, and handle expiration/access changes. Suspended members retain authority-removal controls; account sessions never go to delegated agents.
- [x] **A2 — Build the proposal experience.** The app shows plan revisions, history, readable venues, each approval, notifications, cancellation, and expiry. Counteroffers clear previous approvals, and access/refetch failures suppress stale approval controls.
- [ ] **A3 — Extend bounded planning into an autonomous assistant loop.** Implemented explicit preferences/availability, at most five eligible deterministic candidates, feasibility checks, structured proposals/counteroffers, expiration, and a no-match handoff. This release is member-initiated; an autonomous two-agent negotiation loop and semantic ranking remain separate work.
- [x] **A4 — Bridge fitness to planning through member choice.** Members enter and explicitly enable a shareable planning preference. Only entered preferences and available slots reach a mutually consented active A2A conversation. Raw Apple Health records, BPM, HRV, and sleep remain outside the contract.
- [x] **A5 — Convert an approved revision into one booking.** After separate plan confirmations, both signed-in humans accept the same revision and hashed booking terms. Execution rechecks eligibility, blocking, time, preferences, overlap, and fees inside one transaction. Replays cannot duplicate bookings. No payment is collected.
- [ ] **A6 — Connect calendars if needed.** Entered availability is implemented with local-date parsing and invalid daylight-saving time rejection. Connected calendars remain optional future work; define provider permissions and share free slots only.

**Complete when:** two opted-in members can let their assistants propose a workout, review and approve the same plan, and obtain exactly one correctly authorized booking.

## 5. Complete the launch and operating model

- [ ] **L1 — Prove first-time matching separately.** Define consent and discovery for people without a completed shared booking. Keep hard eligibility and blocks in code, evaluate preference ranking, and prevent unsolicited agent contact. Start with one local activity cohort and measure actual repeat shared workouts.
- [ ] **L2 — Finish payments and dispute operations before collecting money.** Confirm membership/density policy and entitlements; add card collection, charging, failed-payment/refund handling, fee disputes, and support tools. The ledger currently records amounts; it does not collect them.
- [ ] **L3 — Complete verification and support workflows.** Decide which phone/identity checks the pilot needs, implement them with clear states, and verify moderation, appeals, deletion, and support responsibilities. Keep product promises aligned with checks actually performed.
- [ ] **L4 — Finish mobile release integration.** Universal/app links, provider production settings, store disclosures/permissions, accessibility, and device acceptance need a release pass. Closed-app Live Activity updates and maps/routes can follow according to pilot need.
- [ ] **L5 — Operate failures and measure outcomes.** Added admin-only aggregate service reliability, failed push/revocation counts, and seven-day database event cleanup. Assign operating ownership and alert destinations; complete attendance/repeat-workout/correction-rate outcome tracking and incident response practice.

## Later extensions

- [ ] **E1 — Live capture if synced records are insufficient.** Add a native Apple Watch/phone recorder with actual sensor input, pause/resume/end, backgrounding, offline persistence, and reconnection. Test device battery and sample freshness. Apple Health import remains useful without this.
- [ ] **E2 — Android fitness data.** Add Health Connect import, and Wear OS live capture only if required, through the same source-preserving workout domain.
- [ ] **E3 — External agent interoperability.** Add partner discovery/authentication, controlled outbound requests, rate limits, failure handling, and independent-client tests when external federation is needed. The existing A2A endpoint is a foundation, not a running federation network.
- [ ] **E4 — Broader fitness coordination.** Expand gym/location matching and additional activity cohorts using evidence from the initial pilot. Training blocks already exist; integrate real workout records only with an explicit product decision about what progress means.

## Decisions still needed

Apple Health is selected; running remains the initial local activity cohort. Strength logging, separate inference consent, and explicit booking-term approval are now implemented. Remaining decisions include pilot accuracy/speed thresholds, membership and payment policy, verification providers, and whether calendar, live recording, Android Health Connect, or external federation should enter the next release. Evaluate broader matching, live capture, and external agents after the initial complete flow works.

## Recommended next three deliverables

1. **One development-client build:** install HealthKit and sharing together, then accept real iPhone permissions, sync, export, correction, and account-switch behavior.
2. **Measured Jev pilot:** use the configured key for synthetic/held-out evaluations, then a small explicit opt-in pilot with editable drafts.
3. **Operating acceptance:** prove cloud database isolation/restore and provider configuration, define payment/verification choices, and measure repeat shared workouts before expanding to future platforms.

Implementation references: [A2A foundation](./A2A.md), [Jev fitness design](./JEV-FITNESS.md), [API contract](./API.md), [mobile setup](../mobile/README.md), [original gap audit and resolutions](./samepace-gap-audit-2026-09-20.md).
