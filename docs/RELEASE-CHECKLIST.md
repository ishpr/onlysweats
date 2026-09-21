# Fitness and assistant release

SamePace includes Apple Health imports, private exercise logs, reviewed Jev assistance, local/cloud conversation, member-approved A2A coordination, reusable workout plans and separate actual results for each buddy. The maintained [vision roadmap](VISION-ROADMAP.md) distinguishes implemented software from launch acceptance.

## Install and connect

Install the signed physical-iPhone [build 279cd6e8](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/279cd6e8-01eb-4f63-a1bd-2ca453555125). This `device-phone` client includes native workout-plan generation, HealthKit/background delivery, App Shortcuts and widgets. It excludes the unprovisioned Watch app and unentitled PCC integration. This release also includes the inclusive HealthKit import-boundary fix. Existing anchors are not automatically backfilled. Earlier client 8594a56c lacks native workout-plan generation.

Connect the installed development client to the intended release checkout's Metro server with `EXPO_PUBLIC_API_URL=https://samepace.app`. Compatible JavaScript changes continue through Expo; a server running in another checkout serves that checkout's code. For the current handoff, the release server uses port 8098. Remove `EXPO_PUBLIC_DEV_TOKEN` and disable dotenv loading for the physical-phone server. Do not use a simulator's synthetic session on a real member's phone.

The normal `device` build profile includes Watch and requires registered, provisioned paired hardware. Follow [physical iPhone and Watch acceptance](INTELLIGENCE-ACCEPTANCE.md) before claiming recording, pairing, sensor or battery acceptance.

## Server configuration

- Production has `HEALTH_SYNC_ENABLED`, `A2A_ENABLED` and `JEV_ENABLED` enabled. Environment changes take effect on a subsequent deployment.
- TypeSafe credentials remain server-only Vercel secrets and protected, ignored local files. Never put them in mobile configuration or a `VITE_` / `EXPO_PUBLIC_` variable.
- Preview has an isolated schema-only database and separate authentication secret. Rehearse migrations and synthetic member flows there; do not copy production accounts or health records.
- Migrations serialize with a PostgreSQL advisory lock and run during deployment. Structured workouts require `0029_workout_plans.sql`; optional manual coaching context and retry receipts require `0030_manual_workout_context.sql` and `0031_workout_run_retry_receipt.sql`. Built-in coaching and product Terms require `0032_conversation_history_use.sql` and `0033_app_terms.sql`.
- Funded Gateway access and live synthetic conversation/Preview checks pass. Built-in coaching uses `zai/glm-5.3-flash` and the standard required product Terms acceptance. Relevant-history use requires its current notice; existing opt-outs remain unchanged. New-member Terms acceptance initializes bounded manual and imported-workout context; HealthKit/device sync authorization remains required. Existing privacy choices remain authoritative. Its configured provider requires zero data retention and no prompt training; do not weaken those settings to make a probe pass.
- Stripe collection and billing/Persona enforcement remain off in production. Sandbox setup and provider tests do not constitute a live launch decision.

## Release verification

Use the dated evidence for the current implementation: [intelligence checks](evaluations/intelligence-release-2026-09-21.md), [shared workout checks and package audit](evaluations/shared-workouts-release-2026-09-21.md), and [actual local model examples and limitations](evaluations/workout-plan-local-v1-2026-09-21.md). Historical checks apply to the versions they name; they do not prove later screens have been exercised on hardware.

The [weekly activity follow-up and goal audit](evaluations/fitness-summary-release-2026-09-21.md) record the subsequent totals fix and remaining external acceptance.

The [recovery and coach-entry follow-up](evaluations/recovery-and-entry-2026-09-21.md) records physical Terms acceptance, combined restart/payment recovery tests and rendered coaching access with matching disabled or unavailable.

The [workout reliability evaluation](evaluations/2026-09-21-workout-reliability.md) records durable timer recovery, offline save/reconnect, real database checks and the A2A-to-shared-workout flow. Physical process-kill/data-protection behavior, real HealthKit permission/source changes and a genuine two-member workout remain acceptance checks.

For code changes, run relevant tests, root/mobile types and lint, web build and mobile export. Exercise database races on an explicitly disposable PostgreSQL database. `scripts/check-workout-plans-http.mjs` runs the structured-workout flow against its own loopback server and in-memory database, creates synthetic members and deletes them afterward. Its passing result does not prove the physical interface works.

## Physical member flow

Use disposable accounts and consenting participants. Record the installed build, server commit, device/OS and observed outcomes.

1. Sign in and select Apple Health permissions. Import a known source workout; compare its time, distance, duration, readings and units with Health. Resync and verify source changes/deletions, interrupted sync and denied readings without duplicates or invented values.
2. Correct a title/note, resync and verify the correction survives. Export through the iOS share sheet. Separately create, correct and delete a manual exercise. With the current Terms-established Jev permission (or a previously reviewed choice), review a draft and save explicitly; revoke that permission and confirm manual logging remains available.
3. Create a private routine with multiple exercises, instructions, varying sets, repetition/time targets and rest. Review an on-device suggestion and a photographed prescription. Check every requested phase and numeric target; neither path proves exercise happened.
4. Coordinate a meetup through A2A using mutual proposal confirmation and separate booking-term approval. Confirm exactly one booking. As host, attach the first reviewed routine before the session begins, including when a buddy has already booked.
5. On both devices, review the same fixed plan and revision. Start each member's private record. Enter different actual quantities, skip a set and leave one unrecorded. Finish a partial workout and confirm no planned values became actual results or attendance credit.
6. Turn progress sharing on and off. The other member should see only the chosen status/set counts; private quantities, notes and health readings stay hidden. Saving a private plan copy is explicit; changing the original template must not rewrite a shared snapshot.
7. Open a started workout online, disconnect and enter several actual sets, a note and a partial finish. Terminate/reopen the app offline and use **Saved workouts on this iPhone**. Confirm every protected entry survives; reconnect and verify exactly one set result and correct server totals after sync. Repeat with a lost save response, a second-device correction and revoked progress sharing; compare local/server values before explicit reconciliation. Test account switching, 24-hour offline access expiry, seven-day device-copy expiry and unavailable protected storage. New workouts still start online. Correct or delete the saved result and verify the fitness summary/export reflects the change.
8. Sign in as a new member and accept SamePace’s Terms and Privacy Policy, including the displayed coaching disclosure; declining signs out. Then open the coach without a separate activation step. Ask a relevant planning question without explicitly requesting history; verify the coach uses only authorized recent records and leaves absent values unknown. Check a general question, an existing cloud opt-out, existing history opt-outs, the legacy on-request choice, a failed/lost Terms or permission response and a privacy change on another device. Confirm no automatic transfer from on-device help.
9. Sign out/switch accounts, exercise accessibility and confirm private history, pending fields and AI output do not appear under another member. Test disconnect/purge/account deletion with disposable accounts.

## Remaining launch work

Representative model quality, iPhone/Watch behavior, provider edge cases, store configuration and operating ownership remain in the [vision roadmap](VISION-ROADMAP.md). A synthetic cloud restore rehearsal passed; production-scale recovery, retention policy and responsibility still require acceptance. No fixture result establishes general accuracy, physiological suitability or public-launch readiness.
