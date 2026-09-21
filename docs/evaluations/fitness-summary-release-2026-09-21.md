# Fitness summary follow-up — September 21, 2026

The completion audit found a reporting defect: the seven-day card counted only the visible page of 20 individual exercise logs and excluded structured workout results. Finishing a shared workout could therefore leave the card empty. Paging changed its totals, and a partial known-load sum appeared as complete kilograms lifted.

The corrected owner-only summary aggregates both manual logging sources into seven calendar days on the server. It counts only explicitly recorded completed sets, including saved results in an unfinished workout. Planned, skipped, unrecorded and future entries are excluded. Apple Health remains a separate source. Dates use the requested calendar time zone and exact day boundaries, including daylight-saving changes; results are attributed to the log/workout start date because no per-set timestamp was recorded.

Reps, entered set durations and known external load × reps retain null values and contributing-set counts. Bodyweight and missing loads are excluded from external volume. The interface labels this quantity as a kg·reps subtotal, displays timed-only activity, refreshes after corrections/deletion and hides cached private records after failed reads. No migration or new native binary is required.

## Verification

- Full suite: 757 passed, zero failed, 12 optional PostgreSQL checks skipped in this invocation.
- Eleven focused database cases cover more than 20 logs, pagination independence, both manual sources, skipped/partial/timed-only work, known zero versus missing quantities, owner isolation, corrections/deletion, future/boundary records, both daylight-saving transitions and excluded HealthKit observations.
- Three mobile helper cases cover calendar keys/day labels and explicit quantity/time formatting.
- Fifty-two authenticated local HTTP checks passed, including the new summary route, missing/invalid time zones, owner isolation, actual versus prescribed quantities, mixed source totals, deletion and A2A credential rejection. Three synthetic accounts were deleted and the loopback server stopped.
- Thirty protected Preview API checks and four cleanup checks passed against `samepace-l3wkspdy5-servesys-labs.vercel.app`, using the official Vercel CLI. The real PostgreSQL service returned the expected mixed-source totals and cleared them after deletion. Both temporary accounts were deleted and their old sessions returned 401. Branch-specific database/auth configuration was applied before this deployment.
- Root/mobile types and lint, web build and iOS JavaScript export passed. Two existing root lint warnings remain. Independent code review found no additional actionable issue in the summary changes.

## Goal audit

| Requested behavior | Implemented evidence | Still unverified |
| --- | --- | --- |
| AI-assisted custom workouts with reps, sets and instructions | Native guided drafting, cloud review-card adapter, editable manual/photo/text handoff, strict schemas and explicit-unit conversion; actual synthetic Mac examples in the [model evaluation](workout-plan-local-v1-2026-09-21.md). | Representative instructions/phase coverage and physical iPhone model behavior. Cloud requests remain blocked by provider access. |
| HealthKit sync and fitness/activity logs | Source-preserving sync/cursors/deletion, manual logs, structured actual results and the corrected complete weekly totals; [native/device checklist](../INTELLIGENCE-ACCEPTANCE.md) and automated domain checks. | Actual permissions, sensors, background scheduling, account switching and battery on the intended hardware. |
| Finding a buddy and accountability | Member-controlled discovery, mutual A2A proposals/booking approval, bounded coordination and revocable aggregate set progress; protocol/database/HTTP flows verified. | A real two-member workout and subsequent member outcomes. |
| Both buddies follow the initially created plan | Frozen session snapshot, exact reviewed identity/revision required to start, private actual results, explicit copying, revision and booking/blocking race tests; [shared-workout evidence](shared-workouts-release-2026-09-21.md). | Full interface interaction on two actual devices, accessibility and interrupted-edit recovery. |

Optional broader cloud access to manual results remains roadmap E5, not an implicit expansion of existing fitness consent. Calendar integrations, external federation and Android capture are separate future scope choices. Synthetic evidence does not establish that the app is the best fitness product or that members achieve health outcomes.

## Current external conditions

The Mac was still locked when device testing was retried. A single fresh synthetic Gateway probe, with both production privacy flags, a 16-token maximum and no retries, returned HTTP 403 `paid_credits_required`. Credit lookup showed $5 balance and $0 used before and after. No purchase, feature activation, new credential or real member-data transmission occurred. The pending one-time credit purchase and physical acceptance need user action; these conditions are not resolved by more offline tests.

The release guides now point to [iPhone build e01757e4](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/e01757e4-d659-442b-861a-dd611db94636), which includes native plan generation. This follow-up uses compatible JavaScript and the same client.

Release PR: [#32](https://github.com/ishpr/onlysweats/pull/32). Verified code source: `556a875c591d41ca783e899ecc9e06d552b107f6`; the subsequent evidence update changes documentation only.
