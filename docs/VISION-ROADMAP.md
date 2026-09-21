# SamePace: remaining work

The vision is a reliable workout community with real fitness records, Jev-assisted interpretation, and personal agents that coordinate workouts for members. This is the working delivery checklist; unchecked items are pending, not shipped capabilities.

**Agreed first data source: Apple Health sync.** Import actual workouts and the other authorized, available metrics useful to the feature. Start with stored records; a custom watch recorder is a later option if live capture becomes necessary. An Apple Health sync is not a promise of an immediate heartbeat stream.

## Already implemented

- Social workout posting/joining, arrival check-in, standing slots, ratings, blocking/reporting, account deletion, and admin tools.
- Training blocks, public discovery/joining, goal credits, end-of-block decisions, and admin controls from the current main branch.
- Repository fixes for the 17 audited gaps, including session-level host attendance, recurring-session eligibility, mobile navigation, delivery retries, Apple revocation retries, and deployment-setup isolation checks.
- A2A 1.0 discovery, scoped revocable credentials, mutual consent, durable proposals/counteroffers, revision checks, and separate member approvals. The feature defaults to off. Approval currently produces **no booking**.
- The project TypeSafe skill and the [Jev fitness design](./JEV-FITNESS.md). The Jev runtime is **not implemented**.
- The first [Apple Health import](./APPLE-HEALTH.md): native read-only reader, private records and API, account-bound manual sync, tombstones/purge, source-based summaries, and standalone workout screen. It defaults off pending physical-device acceptance; redesigned navigation remains separate.

## 1. Verify the release baseline

- [ ] **R1 — Verify deployed database isolation and migrations.** Confirm production and preview use distinct databases/branches, rehearse migrations `0011`–`0014` on an isolated snapshot, verify backup/rollback procedures, and record the deployed revision. The setup script is fixed; actual cloud settings still require verification.
- [ ] **R2 — Exercise real devices and providers.** On physical iOS/Android builds, verify sign-in, invite preservation, check-in, ratings, repeat/leave/skip, training blocks, notifications, blocking, and account deletion. Verify the actual Android OAuth client/signing identity, Google production publishing, APNs/FCM credentials, Apple revocation credentials, and cron operation. Console configuration is not proven by local tests.
- [ ] **R3 — Review historical settlement errors.** Use [the reconciliation guide](./settlement-reconciliation.md), review selected records, and apply auditable corrections where justified. New code prevents recurrence; it has not rewritten historical fees, strikes, or completion counts.
- [ ] **R4 — Test concurrent production-database behavior.** Exercise booking, session settlement, block/leave, training-block advancement, push claims/receipts, and delegation revocation against real Postgres. Local embedded Postgres tests do not establish production concurrency behavior.
- [ ] **R5 — Keep prototype health data visibly separate.** The web prototype contains simulated BPM, HRV, recovery, and workouts. Label or remove misleading connection/writeback claims wherever those screens remain accessible. Never move synthetic records into real health history.

## 2. Build real private fitness records and Apple Health sync

- [x] **H1 — Add a workout domain separate from attendance.** Owner-only records retain source, external ID, source revision, timestamps, and units. Account deletion cascades health data; check-ins never invent exercise measurements. Optional social-booking associations can follow separately.
- [ ] **H2 — Accept the native HealthKit connection on an actual iPhone.** Reader, selected types, permission prompt, unavailable/last-sync/disconnect states, and unsigned iOS simulator build are implemented. Physical-device permissions, locked-device behavior, and real source records still need verification before enabling rollout.
- [ ] **H3 — Accept incremental sync with real source changes.** Server-owned anchors, atomic pages, duplicate prevention, deletions, retry/cancellation, and account-switch tests are implemented. Verify source replacements, permission changes, multiple devices, and interruptions against real HealthKit. Sync is currently manual; background delivery is later work if needed.
- [x] **H4 — Calculate imported-workout summaries in code.** Elapsed time, source active-duration pace, units, distance, and source-bound heart-rate sample statistics are tested. Missing metrics stay null. Manual strength volume and optional daily/context aggregates await their own features.
- [ ] **H5 — Complete the private workout experience.** A standalone screen shows real source facts and supports workout removal and disconnect/purge; a paginated export API exists. Connect redesigned navigation, add member-facing export, corrections, and manual exercise/set logging, and retain corrections across resync.
- [ ] **H6 — Complete the later data-use controls.** Health import opt-in, type selection, retention/purge behavior, and privacy descriptions are implemented. Sending snapshots to TypeSafe and sharing preferences remain disabled until their separate consent controls exist.

**Complete when:** a real workout and its available metrics sync into the correct member's account, survive resync and corrections, disappear when deleted under the chosen policy, and never display an invented measurement.

## 3. Make Jev useful inside fitness tracking

- [ ] **J1 — Add the server-only TypeSafe adapter.** Install the runtime SDK, configure the server credential, pin an evaluated model, version questions, limit state/request size, validate typed responses, and enforce timeout/retry budgets. Record model, question version, source revision, latency, and token usage without logging private request bodies.
- [ ] **J2 — Ship an editable exercise-log draft.** From a member's note, Jev selects an exercise from a catalogue and the meaning of numeric source spans. Code copies the source values, validates units, and computes totals. Include unknown/none options and a correction flow; never invent missing load or repetitions.
- [ ] **J3 — Evaluate contextual workout interpretation.** Use bounded summaries plus the actual goal and optional member note to suggest ambiguous segment labels or explain a stated change of plan. Preserve known timer/source labels. Keep model interpretations separate from observations and avoid unsupported physiological conclusions.
- [ ] **J4 — Handle uncertainty, outages, and stale answers.** Insufficient evidence yields an explicit unknown or a useful question. Offline/provider failures leave ordinary recording and summaries working. Reject results for an old workout revision, another workout, or another member. Model confidence never grants permission to act.
- [ ] **J5 — Build the fitness evaluation set.** Include exercise aliases, unit ambiguity, missing/stale samples, contradictory notes, user corrections, and embedded instructions. Measure draft correction/error/abstention rates and time saved against manual logging; choose per-question thresholds from those results.
- [ ] **J6 — Measure the complete experience.** Report p50/p95/p99 latency, errors, retries, request cost, and battery impact. Evaluate on meaningful events or bounded windows rather than making a request for every heartbeat. Roll out to a small opt-in cohort only after meeting defined acceptance thresholds.

**Complete when:** members can produce a correct, editable workout record with less effort, using real data, with observed accuracy and latency rather than assumptions based on typed output.

## 4. Turn A2A into a member-facing assistant

- [ ] **A1 — Add assistant controls in the app.** Issue/revoke credentials, explain access, opt into a conversation, withdraw consent, and handle expiry, blocking, and suspension. Agents receive scoped credentials; normal member-session tokens stay with the app.
- [ ] **A2 — Build the proposal experience.** Show the current plan, changes from the preceding revision, each member's approval, and clear failed/expired/canceled states. Add proposal notifications and accessible history. A counteroffer must visibly clear earlier approvals.
- [ ] **A3 — Run a bounded planning assistant.** Collect explicit preferences/availability, enumerate eligible candidate plans in code, let Jev judge semantic fit where useful, and send structured proposals/counteroffers. Add stopping rules, retries, deadlines, and a human handoff. Start with the existing mutually consented, known-partner flow.
- [ ] **A4 — Bridge fitness to planning through member choice.** A member can approve a preference such as “a short easy walk this evening.” Only that approved preference reaches another member's agent. Raw Apple Health records, BPM samples, HRV, and sleep remain outside the A2A message contract.
- [ ] **A5 — Convert an approved revision into one booking.** Define the booking/fee confirmation experience, then implement idempotent execution with fresh eligibility, blocks, time, availability, capacity, and financial-term checks. Concurrent or repeated execution must not duplicate bookings. Changed terms require renewed approval.
- [ ] **A6 — Add calendar support if needed.** Begin with entered availability; for connected calendars, define permission and data granularity. Share available slots instead of event contents. Test timezone, daylight-saving, rescheduling, and cancellation behavior.

**Complete when:** two opted-in members can let their assistants propose a workout, review and approve the same plan, and obtain exactly one correctly authorized booking.

## 5. Complete the launch and operating model

- [ ] **L1 — Prove first-time matching separately.** Define consent and discovery for people without a completed shared booking. Keep hard eligibility and blocks in code, evaluate preference ranking, and prevent unsolicited agent contact. Start with one local activity cohort and measure actual repeat shared workouts.
- [ ] **L2 — Finish payments and dispute operations before collecting money.** Confirm membership/density policy and entitlements; add card collection, charging, failed-payment/refund handling, fee disputes, and support tools. The ledger currently records amounts; it does not collect them.
- [ ] **L3 — Complete verification and support workflows.** Decide which phone/identity checks the pilot needs, implement them with clear states, and verify moderation, appeals, deletion, and support responsibilities. Keep product promises aligned with checks actually performed.
- [ ] **L4 — Finish mobile release integration.** Universal/app links, provider production settings, store disclosures/permissions, accessibility, and device acceptance need a release pass. Closed-app Live Activity updates and maps/routes can follow according to pilot need.
- [ ] **L5 — Observe the product and operate failures.** Monitor import freshness/failure, Jev errors/corrections, negotiation drop-off, successful bookings, attendance, repeat workouts, safety reports, notification failures, and revocation-job exhaustion. Establish ownership and response procedures.

## Later extensions

- [ ] **E1 — Live capture if synced records are insufficient.** Add a native Apple Watch/phone recorder with actual sensor input, pause/resume/end, backgrounding, offline persistence, and reconnection. Test device battery and sample freshness. Apple Health import remains useful without this.
- [ ] **E2 — Android fitness data.** Add Health Connect import, and Wear OS live capture only if required, through the same source-preserving workout domain.
- [ ] **E3 — External agent interoperability.** Add partner discovery/authentication, controlled outbound requests, rate limits, failure handling, and independent-client tests when external federation is needed. The existing A2A endpoint is a foundation, not a running federation network.
- [ ] **E4 — Broader fitness coordination.** Expand gym/location matching and additional activity cohorts using evidence from the initial pilot. Training blocks already exist; integrate real workout records only with an explicit product decision about what progress means.

## Decisions still needed

Apple Health is selected; running remains the initial local activity cohort. The remaining choices are which optional health variables drive the first feature, when to add strength logging, retention and inference consent, the booking/fee approval experience, and measurable pilot success thresholds. Evaluate broader matching, live capture, and external agents after the initial complete flow works.

## Recommended next three deliverables

1. **Release baseline:** complete R1–R5 and record the operational/device evidence.
2. **Apple Health workout view:** H1–H6, with genuine synced records and reliable summaries.
3. **Jev-assisted logging pilot:** J1–J6, followed by A1–A5 to close the loop from a member-approved preference to a booked shared workout.

Implementation references: [A2A foundation](./A2A.md), [Jev fitness design](./JEV-FITNESS.md), [API contract](./API.md), [mobile setup](../mobile/README.md), [original gap audit and resolutions](./samepace-gap-audit-2026-09-20.md).
