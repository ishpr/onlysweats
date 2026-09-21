# Fitness and assistant release

This release combines the redesigned mobile navigation with Apple Health imports,
private exercise logs, editable Jev suggestions, and member-approved assistant
planning. Use one iPhone development-client build, then keep receiving JavaScript
updates through Expo. The device profile uses `https://samepace.app` for its API.

The design branch was integrated through `09fa889`, with the themed launch-screen
commit `d00de41` applied separately. The later Home health card was adapted to the
existing account-bound sync. Its second native reader and readiness heuristics
were not included. Rebase subsequent design work on this release before merging
so it does not reintroduce duplicate connection controls or conflicting privacy
copy.

## Server configuration

- Production and preview have `HEALTH_SYNC_ENABLED`, `A2A_ENABLED`, and
  `JEV_ENABLED` enabled. New deployments must complete before changed environment
  settings take effect.
- `TYPESAFE_API_KEY` is a Vercel Secret in both environments. Local server
  development reads an ignored, owner-only root `.env.local`. The key must never
  be placed in mobile configuration or a `VITE_` / `EXPO_PUBLIC_` variable.
- Vercel preview uses a separate schema-only Neon branch and separate auth secret.
  It contains no copied production accounts or health records. Release migrations
  were rehearsed there and on disposable PostgreSQL 17.
- Migrations serialize with a PostgreSQL advisory lock. Production applies pending
  migrations during the deployment build.

## Release verification

Final local verification on September 21: 503 tests passed, with the optional
PostgreSQL test skipped in the ordinary suite and passed separately against real
PostgreSQL 17. Root and mobile type checks/lint passed (two existing root lint
warnings), as did the web build, iOS/web exports, disposable-account HTTP smoke,
and interactive light/dark mobile checks. Exact-key scans found no provider key
in source or generated bundles; mobile exports also exclude the synthetic login.

Run the root test suite, root/mobile type checks and lint, the production web
build, and the mobile export. Run the optional PostgreSQL acceptance test with a
disposable loopback database via `SAMEPACE_TEST_DATABASE_URL`.

`node scripts/release-http-smoke.mjs` checks a local server (default port 8091) with
its own disposable member and deletes that member afterward. It never calls Jev.
See [Jev fitness](JEV-FITNESS.md) for the separate live synthetic evaluations,
including the initial failures and held-out results.

Before a device build, remove `EXPO_PUBLIC_DEV_TOKEN` and synthetic test accounts
from the mobile environment. Build the `device` profile once. Connect the installed
development client to the combined release worktree's Metro server; an existing
server in another checkout serves that checkout's JavaScript, not this release.

## Physical iPhone acceptance

1. Sign in as the intended member and open You → Apple Health. Allow the desired
   read permissions. Import a known workout with available heart-rate data and
   compare the displayed source, time, distance, duration, and units with Health.
2. Resync, change or delete a source record, and confirm no duplicates. Try locked
   phone / interrupted sync and retry. Missing or withheld data must remain absent.
3. Save a title or note correction, resync, and confirm the correction survives.
   Export records through the iOS share sheet and inspect the resulting JSON.
4. Create, edit, and delete a manual exercise. Opt into Jev separately, request a
   draft, review it, and save explicitly. Revoke consent and check manual logging
   remains available. A draft never creates a record by itself.
5. Sign out or switch accounts and confirm no private cached records remain.
   Verify disconnect, purge, and account deletion on a disposable account.
6. With a consenting eligible partner, share entered availability, review a
   proposal, confirm the plan, then separately approve the displayed booking terms
   on both accounts. Confirm one session/booking and the expected notifications.

## Remaining acceptance and product decisions

The code is not a claim that physical-device behavior or external-provider setup
has already been accepted. Complete sign-in/deep links, APNs, actual HealthKit
source changes, real-user Jev correction/time-saved measurement, and a database
restore rehearsal. Neon currently retains six hours of history; agree the required
retention policy before broad rollout.

The assistant is member-initiated and bounded. Autonomous negotiation, new-person
matching, external federation, calendar connections, Watch live recording, Android
Health Connect, payment collection, and identity verification remain separate
deliverables. The full list and decision points are in the
[vision roadmap](VISION-ROADMAP.md).
