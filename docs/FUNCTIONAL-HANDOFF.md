# Functional handoff — September 21, 2026

Claude owns the visual redesign. This handoff covers the remaining functional work and acceptance for AI-assisted fitness, Apple Health, finding a buddy and following a shared workout with explicit exercises, sets and instructions.

## Merged implementation

The intelligence experience, shared workout plans, complete weekly activity totals and native Apple sign-in fix are merged through [PR #30](https://github.com/ishpr/onlysweats/pull/30), [#31](https://github.com/ishpr/onlysweats/pull/31), [#32](https://github.com/ishpr/onlysweats/pull/32) and [#33](https://github.com/ishpr/onlysweats/pull/33). The functional code base is main commit `38c84a2953b2cde2da96a942446213b606336d2b`.

A read-only audit also confirmed that historical A2A, HealthKit and Persona branches were incorporated by [PR #18](https://github.com/ishpr/onlysweats/pull/18), [#20](https://github.com/ishpr/onlysweats/pull/20) and [#25](https://github.com/ishpr/onlysweats/pull/25). Some old branch commits are not ancestors because integration used rebasing or squashing; their patch/tree equivalents are already merged. No unmerged functional source changes were found.

Implemented: private source-preserving HealthKit imports; manual exercise and structured workout results; complete seven-day manual-activity totals; typed Jev assistance; local conversation and workout drafting; optional cloud conversation with reviewed drafts; member-approved A2A matching and booking; fixed shared plans, separate actual results and optional aggregate buddy progress. See [the maintained roadmap](VISION-ROADMAP.md) for the complete implementation inventory.

Apple sign-in was confirmed successful by the user on the physical iPhone after PR #33. The refreshed physical-phone view also showed the current home screen and imported Health data. These observations do not complete the HealthKit or workout acceptance checklist. On-device plan generation has not yet been confirmed on this phone.

The signed [phone artifact e01757e4](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/e01757e4-d659-442b-861a-dd611db94636) contains native plan generation. The installed app's generic version/build metadata did not identify its exact EAS package, so the pending on-device capability check is still necessary.

The live Expo server on port 8098 now serves the main checkout at `samepace-shared-workouts/mobile`, using the production API and no synthetic development token. The temporary sign-in-fix and simulator-fixture worktrees were removed; disposable fixture accounts and servers were cleaned up. The existing phone client can receive the sign-in JavaScript fix without a new native build.

## Remaining work for the core vision

| Priority | Remaining item | What completes it |
| --- | --- | --- |
| 1 | Cloud conversation activation and evaluation | Establish funded Vercel AI Gateway access, then evaluate real replies, edits and workout drafts with the configured privacy restrictions. The last synthetic call returned `paid_credits_required`; cloud chat remains disabled. A proposed one-time credit purchase has not been authorized. This is provider setup and acceptance, not a missing conversation adapter. |
| 1 | Physical on-device AI and workout flow | Verify model availability on the actual iPhone; generate a plan, review/edit all phases and units, save it, record actual quantities, skip a set, finish a partial workout, correct it and verify totals. Check photo/text drafts, cancellation and account switching. The next requested check is a small on-device draft; its result is still pending. |
| 1 | Two-member shared workout acceptance | Use two consenting test members/devices to find a buddy, approve the meetup, attach/review the same fixed plan and record different actual results. Check progress opt-in/revocation, private data boundaries, interrupted-form recovery and stale revisions. The automated protocol and database checks passed; the complete physical flow remains unverified. |
| 1 | Full HealthKit acceptance | Compare selected imported fields with Health; exercise permission denial/revocation, incremental changes/deletions, interrupted and automatic sync, multiple devices, export and account switching. Measure battery/background behavior. Viewing existing imports is only a smoke check. |
| 2 | Apple Watch packaging and acceptance | Provision a physical Watch and pair it with the test iPhone, include the Watch app in a signed build, then test real recording, pause/resume, offline recovery, replication, mirroring, zones, stale readings and battery. The current `device-phone` build excludes the Watch app; recorder source and native compile checks are already implemented. |
| 2 | Representative AI and member outcomes | Run the consented pilot and review incorrect/omitted draft fields, exercise instructions, latency, cost and effort. Define acceptable quality/abstention thresholds and observe actual shared attendance and repeat workouts. Synthetic results do not establish general quality or member outcomes. |

Follow [workout plans](WORKOUT-PLANS.md), [the release checklist](RELEASE-CHECKLIST.md) and [physical iPhone/Watch acceptance](INTELLIGENCE-ACCEPTANCE.md). Fix any failures found in these passes through reviewed PRs.

## Before a public launch

- **Stripe:** finish failed-renewal, refund, replay/outage and physical return-path tests; configure live credentials and billing disclosures, then explicitly decide whether to enable collection and membership enforcement. Sandbox payment flows have passed; production collection is off.
- **Persona:** finish real phone/selfie/ID and gating/return cases, reversals and retention; confirm production entitlements and moderation/appeal ownership before enabling enforcement. Sandbox integration has passed; production enforcement is off.
- **Distribution and account lifecycle:** verify push credentials and delivery, Apple revocation, Google production access, installed universal links, deletion/recovery and assistive-technology behavior. Complete store configuration/disclosures and release acceptance. Android-specific setup is needed only if Android ships.
- **Operations:** assign alert/support/recovery owners, choose retention and recovery targets, rehearse provider failures and production-scale restore/failover, and review pilot dashboards with actual activity.

## Optional expansion, not an unfinished core implementation

- Let cloud conversation read selected manual logs and structured workout results through a new, explicit permission and deletion/update handling. Its current optional fitness context covers only a bounded set of imported HealthKit workouts.
- Add a durable full-workout offline queue and conflict reconciliation if uninterrupted offline logging is required. The implemented recovery preserves one pending form for up to 24 hours; it does not queue an entire workout.
- External partner-agent federation, connected-calendar availability, Android Health Connect/Wear OS and additional location/cohort integrations.
- Private Cloud Compute entitlement/integration and continuous camera-based form or rep recognition. These are separate scope decisions and must not be presented as delivered capabilities.

## Redesign boundary

Start redesign work from current `origin/main`, including the native authentication fix. Preserve the distinction between planned targets, member-entered actual results, measured Health data and AI suggestions. Keep explicit review/save, sharing permissions, missing-value labels and error/recovery behavior visible through any layout changes. No design edits are part of this handoff.
