# Recovery and coach-entry acceptance — September 21, 2026

This follow-up starts from main `93e2324` (PR #36). The member confirmed that reloading the physical iPhone showed the new product Terms, and that accepting them returned to Home. This establishes that onboarding transition on that phone; it does not establish the remaining physical workout, HealthKit or model acceptance cases.

## Product changes

- Home starts its greeting 12 points higher, with 12-point rather than 16-point gaps between sections. The screen remains scrollable for longer content and larger text. The change is scoped to Home.
- The home coach entry no longer reports the entire assistant as off when buddy planning is disabled. It remains available if the separate matching service is unavailable. Active buddy requests still show their actual status and link directly to review.
- Buddy setup and its status hero appear in the Plans view, leaving Chat directly accessible without a planning activation step. Privacy choices and existing sharing/booking review requirements are unchanged.

## Repeatable recovery checks

Seven tests in `mobile/src/lib/workout-plans/offline-acceptance.test.mjs` compose the real Terms receipt store, workout store and sync engine with disposable storage and transport adapters. All seven passed:

1. Restart after a committed save loses its response, followed by later actual entries and partial completion: the original request is replayed exactly, then the later revision is saved once.
2. Unsubmitted fields survive restart without becoming completed exercise results.
3. An accepted Terms receipt does not extend the independent 24-hour offline workout lease; verified reconnect restores access to pending records.
4. Session replacement and sign-out isolate and clear account-bound data.
5. A fresh Terms refusal blocks cached app access without destroying an unsynced workout.
6. Failed storage writes leave the last durable state intact across restart.
7. A second device's correction and withdrawn progress sharing survive lost-response recovery; conflicting local changes require explicit review before private reapplication.

Two tests in `src/lib/billing/provider-recovery.test.ts` use the existing isolated database and synthetic provider. Both passed: membership retrieval outage followed by stale success/failure events reconciles against current provider state without creating another checkout; a lost pending-refund response recovers the same refund and completes without creating a duplicate. The 54 existing focused billing and Persona tests also passed during review. These checks make no real provider calls and do not replace the pending hosted-provider launch tests.

## Rendered entry checks

A read-only loopback API served synthetic records to the actual mobile web application at a compact 440 × 852 viewport. Both workout shortcut cards appeared above navigation. With buddy planning off, the home card opened the coach composer without a setup hero; the Plans view retained its setup and permission controls. With matching endpoints returning 404, the same home entry still opened the coach composer. This browser check is not native-device layout or sensor acceptance. Existing unrelated brand SVG warnings remain.

The new nine recovery tests, root/mobile type checks, changed-file lint, formatting and iOS JavaScript export passed. Native modules and build configuration are unchanged. The physical phone still needs live coaching, on-device drafting, actual offline interruption/reconnect and the broader HealthKit/paired-device acceptance pass.
