# Intelligence delivery checks — September 21, 2026

This release integrates private local/cloud conversation, editable photo/text drafts, App Shortcuts, workout recaps, HealthKit observation and selected automatic foreground import, separate RMSSD/source zones, native Watch recording/mirroring, and the assistant/fitness redesign. These are implementation checks, not evidence of general model accuracy or completed physical-device acceptance.

## Automated and deployment checks

| Check | Result |
| --- | --- |
| Full default test command | 699 passed, 0 failed; 11 optional PostgreSQL parents/tests skipped in this invocation. |
| New conversation concurrency acceptance on isolated Neon Preview schema | 9 passed: provider exclusivity, replacement lease fencing, source deletion/permission/fitness-consent withdrawal under both actual database lock orderings. Schema cleanup verified. |
| Four existing PostgreSQL suites on ephemeral local PostgreSQL 17 | 10 passed: billing, coordination, jobs and release/booking/Health migration behavior. No public tables or leftover schemas; temporary container removed. |
| Root and mobile TypeScript | Passed. |
| Root and mobile lint | Passed; root retains two pre-existing warnings. |
| Web build | Passed. |
| iOS JavaScript production export | Passed during assistant integration; the final subsequent RMSSD/UI additions pass types, lint and focused tests. |
| Watch config-plugin tests | 2 passed, including fresh target dependencies and repeated prebuild repair. |
| Native Apple intelligence checks | Actual synthetic Vision OCR, evidence parsing, missing values, local file isolation and cancellation checks passed; no local language-model inference was claimed. |
| Native Health/Watch checks | Actual framework RMSSD/zone serialization and deterministic offline cue checks passed; modern and guarded legacy SDK branches typechecked. |
| Aggregate unsigned Xcode 27 simulator build | Passed: phone, Watch, widgets, scene lifecycle and three extracted App Shortcut intents. App launched to onboarding. |
| Local authenticated HTTP | Passed unauthenticated rejection, explicit default-off consent, disabled provider response, CSRF rejection, history generation rotation and synthetic account deletion. |
| Protected Vercel Preview HTTP | Passed sign-in, private no-store history/default-off consent, settings update, provider-disabled response, history reset and synthetic account cleanup. |

Real PostgreSQL acceptance used synthetic identities and isolated disposable schemas. No real HealthKit store or member health data was needed. The provider-adapter tests use the actual AI SDK with a mock model, including private-error sanitization and interruption; they are not live model evaluations.

## Signed iPhone package

[Expo internal build 8594a56c-914d-47e4-8e8b-f5820e4f916a](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/8594a56c-914d-47e4-8e8b-f5820e4f916a) is finished and targets a physical iPhone. Built locally using Xcode 27, then uploaded with the official EAS internal-upload command. It contains the phone app and widget extension, HealthKit/background delivery, App Shortcuts, local intelligence and iOS 27 scene support. Existing signing profiles were reused; no App Store/TestFlight submission occurred.

The iPhone-first profile omits Watch because no physical Watch was registered/provisioned. The full Watch implementation remains compiled and checked separately. PCC has no entitlement and remains disabled.

IPA SHA-256: `661fa1563959061a8e7c2f55a71dc44aeacb280eaed83c70114d254688c01a6c`.

Archive inspection found no simulator session token, simulator API override or dotenv file. This is a development client with no embedded JavaScript bundle: connect it to the intended live-service Metro server. Later compatible JavaScript changes do not require another native build.

## Still pending

- Paid Gateway credits/access and a real model smoke/evaluation run. Cloud conversation remains disabled; no purchase was made. The [50 synthetic cases](conversation-v1.md) are available for explicit live evaluation, with human qualitative review kept separate from mechanical checks.
- The Mac locked during the simulator screen review after launch/onboarding. The new chat and fitness surfaces have types/lint/boundary coverage, but their final visual interaction pass remains pending unlock.
- Physical on-device model, camera, HealthKit permission/source deletion/background behavior, Siri/Shortcuts, Lock Screen and battery/thermal acceptance. The checklist is in [INTELLIGENCE-ACCEPTANCE.md](../INTELLIGENCE-ACCEPTANCE.md).
- Physical Watch registration, signing, pairing and actual recorder/sensor acceptance.
- Optional PCC eligibility/managed entitlement and live quota/model acceptance. There is no automatic fallback into PCC or cloud chat.
- Representative member outcomes and continuous camera exercise recognition remain separate evaluation/research work.
