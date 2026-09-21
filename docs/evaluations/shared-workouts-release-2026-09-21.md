# Shared workout delivery checks — September 21, 2026

This release connects a private workout library, reviewed AI suggestions, a frozen buddy-session prescription and each member's private actual results. Agent-arranged bookings can receive their first plan before the session begins. Starting requires the exact plan and revision the member reviewed. It does not infer attendance, write completed activity to HealthKit, or expose actual quantities through buddy progress.

## Software verification

| Check | Result |
| --- | --- |
| Full default suite | 743 passed, 0 failed; 12 optional PostgreSQL checks skipped in this invocation. |
| Structured-plan database tests | 14 PGlite cases passed, including actual A2A proposal confirmation → mutual booking-term approval → booking → first plan attachment → exact-version start. |
| Separate PostgreSQL 17 concurrency suite | 9 checks passed, covering 8 lock-order scenarios plus the parent. Disposable schema/container cleanup verified. |
| Authenticated local HTTP | 41 checks passed, including owner isolation, CSRF, revisions, immutable copies, accountability revocation, exports and synthetic account cleanup. |
| Protected Vercel Preview | 20 HTTP checks plus 4 cleanup checks passed through the official CLI: no-store/auth rejection, owner isolation, idempotency, revisions, actual-versus-planned results, export and deletion. Both synthetic accounts were deleted and their sessions returned 401 afterward. |
| Root/mobile types and lint | Passed; root retains two existing warnings. |
| Web build | Passed. No local production database was used. |
| iOS JavaScript production export | Passed, 3,901 modules. Subsequent editor-only timing review and portable property checking passed types/lint or focused boundary tests as applicable. |
| Native guided generation | SDK compilation and parser checks passed. Strict schemas, code-owned time conversion and UUID expansion are separately tested. |
| Real local model | Four fixed synthetic requests ran on the Mac. Initial defects and the remaining instruction-only warm-up limitation are recorded in the [evaluation](workout-plan-local-v1-2026-09-21.md). |

The full suite ran after integration. The subsequent portable property-validation change passed five focused draft-boundary tests; the editor timing-summary change passed mobile types and focused lint. No physical sensor or member data was used for these checks.

Preview deployment `samepace-mvdmwu1rk-servesys-labs.vercel.app` was READY at source commit `76fb81fb5586ecb4c652194a9309c39194a1cca3`. The isolated Preview database contains migration `0029_workout_plans.sql`. Branch-specific database/auth configuration was applied before this deployment. No provider calls or real member records were involved in its smoke test. Release PR: [#31](https://github.com/ishpr/onlysweats/pull/31).

## Signed iPhone package

[Expo build e01757e4-d659-442b-861a-dd611db94636](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/e01757e4-d659-442b-861a-dd611db94636) is finished, internally distributed and targets a physical iPhone. The signed package includes native workout-plan generation with explicit target units, HealthKit/background delivery, the widget extension, App Shortcuts and iOS 27 scene support. Native source commit: `0800d6eead498ae8edbb8cb60cef499d87aa0d28`.

IPA SHA-256: `56afffc7265117724c2872ffbee0e6b7a517293689ffdb8792a23286c76833ab`.

Archive checks found no cloud key, development member token, dotenv file or embedded JavaScript. This is a development client: compatible interface changes arrive through the live-service Metro server. The iPhone profile excludes Watch because a physical Watch is not provisioned. PCC is not entitled or enabled. No App Store/TestFlight submission occurred.

## Remaining acceptance

- Complete the two-member physical workout flow, interruption/recovery, account switching, accessibility and visual checks. The Mac remained locked during the attempted screen review.
- Install this native build to access local plan generation; an older client can still use manual editing but cannot gain a new native method through JavaScript sync alone.
- Gateway credits/access and live cloud-model evaluation remain pending; cloud conversation stays disabled. Cloud fitness summaries do not yet read manual strength logs or structured workout results.
- Evaluate requested-phase coverage, instructions, equipment, durations and corrections with consenting members. Valid typed output does not establish exercise suitability or general accuracy.
- Physical HealthKit, Watch pairing/sensors, background behavior and battery acceptance remain in the [device checklist](../INTELLIGENCE-ACCEPTANCE.md). Provider launch and operating work remain in the [roadmap](../VISION-ROADMAP.md).
