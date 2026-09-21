# SamePace gap audit — September 20, 2026

Reviewed the mobile app, API, domain rules, safety, notifications, authentication, deployment setup, and product documentation at commit `2adb2f7`. This review found 17 actionable gaps: six high priority, ten medium priority, and one documentation discrepancy. The findings below preserve the original audit; the subsequent fixes are recorded here.

## Resolution on `codex/samepace-fixes-a2a`

All 17 findings now have repository fixes:

| Findings | Implemented change |
| --- | --- |
| 1–4 | Co-joiner blocking releases the blocker’s seat; session-level host attendance survives late joins; host penalties and completion counts settle once per session; repeats check every member’s current eligibility. |
| 5 | Setup requires distinct production/preview Neon branches and rejects the same resolved endpoint. Implicit account linking requires a verified local email. Existing cloud configuration was not changed or verified. |
| 6–9 | Mobile adds standing-slot leave controls, hosted sessions without bookings, completed-session rating/repeat access, and invite preservation through sign-in. |
| 10 | A skipped/empty recurring occurrence advances to the next week. |
| 11–13 | Mobile retries device registration; delivery persists per-device outcomes and receipt retries, caps each provider request at 100 messages, and fences stale workers/device reassignment between batches. |
| 14 | Apple revocation uses encrypted, bounded retry jobs that survive account deletion and scrub credentials at completion or expiry. |
| 15–16 | Mobile defaults to port 8080; the test command discovers all suites and obsolete template assumptions are removed or isolated. |
| 17 | Privacy copy no longer claims an adult confirmation that the app does not collect. |

Migrations `0011`–`0013` add attendance state, durable delivery/revocation jobs, and the [A2A foundation](./A2A.md). The agent feature defaults to off. The branch also includes regression tests and official A2A SDK interoperability tests against isolated embedded Postgres.

Initial branch validation: **376 tests passed, zero failures**, including 26 A2A lifecycle, protocol, listing, and quota tests. Web typecheck and build passed. Web lint has zero errors and two pre-existing warnings. Mobile typecheck, lint, and the 20-route web export passed. A local HTTP smoke verified discovery, signed-in delegation issuance, separation of member and agent credentials, immediate revocation, and disabled-feature `404` responses. The isolated dev server and build agreed that sign-in was enabled.

Integration validation on `codex/samepace-fixes-a2a-pr`, based on main `2ba3f3c`: **412 tests passed, zero failures**, including the current training-block suite and a regression for joining a block after the host arrives. Web typecheck, development build, and lint passed (the same two existing lint warnings). Mobile typecheck, lint, and the 22-route web export passed. Training-block recurrence, goal-date boundaries, credits, admin controls, and navigation are preserved. The development build does not run remote database migrations.

These changes prevent future incorrect host settlement. Existing duplicate fees, strikes, or counters need an explicit review using [the reconciliation guide](./settlement-reconciliation.md); no historical financial data was rewritten. No production migrations, deployments, or provider configuration changes were made. Mobile checks cover types, lint, and web export; physical-device acceptance and real Postgres concurrency stress remain unperformed.

P1 means fix before expanding the pilot. P2 means an important broken flow or reliability gap. P3 means a documentation discrepancy.

Evidence: backend findings 1–4 and 10 were reproduced with the shipped migrations in an isolated embedded Postgres database. Notification findings 12–13 were reproduced with an isolated database and simulated provider responses. Mobile findings were traced through the current navigation and API calls; they were not exercised on a physical device. The deployment finding describes what the checked-in setup script provisions; current cloud database isolation was not verified.

## High priority

### 1. [P1] Blocking another joiner leaves both people booked together

Location: [service.server.ts:1480](/Users/ishprasad/code/onlysweats/src/lib/pace/service.server.ts:1480).

The cancellation query handles only host–joiner relationships. In a three-person session, when one joiner blocks the other, both seats remain confirmed. The blocker can still retrieve the meeting pin through their booking. This contradicts the promise that blocking releases shared upcoming seats without charge.

Reproduction: host posts; Ann and Bob join; Ann blocks Bob. Both bookings remain `confirmed`.

Fix: release the blocker's seat when both members are joiners on the same session, without a fee, and cover group sessions in safety tests.

### 2. [P1] A late join can falsely mark a present host as absent

Locations: [host check-in propagation](/Users/ishprasad/code/onlysweats/src/lib/pace/service.server.ts:1157), [booking creation](/Users/ishprasad/code/onlysweats/src/lib/pace/service.server.ts:759).

Host check-in is stored on existing confirmed bookings rather than on the session. A booking created afterward never receives that arrival timestamp.

Reproduction: host checks in 19 minutes before start; a second joiner books 10 minutes before start; both joiners check in. The original booking completes, while the new booking settles as `host_no_show`. The present host receives a $10 ledger fee and a strike.

Fix: store host arrival on the session or reliably inherit it when a booking becomes confirmed, including approval flows.

### 3. [P1] One missed group session can give the host two strikes

Location: [service.server.ts:1065](/Users/ishprasad/code/onlysweats/src/lib/pace/service.server.ts:1065).

Settlement assesses the host once per booking. A single absence with two present joiners creates $20 in ledger fees, two strikes, and an immediate 14-day public-session freeze. The documented rule is $10 and one strike for a missed session. Successful group sessions also increment the host's completed-session count once per joiner.

Fix: account for a host's absence and completed-session count once per session. Preserve the appropriate credit for each joiner who attended.

### 4. [P1] Repeating a past session can rebook a deleted member

Location: [service.server.ts:1329](/Users/ishprasad/code/onlysweats/src/lib/pace/service.server.ts:1329).

Creating a standing slot collects historical completed participants without checking their current account eligibility. After a completed session's host deletes their account, the other participant can repeat the session and create an open future session hosted by “Deleted member.” The same eligibility check is absent for suspended members.

Fix: validate every proposed regular before creating a series and when generating later occurrences. A deleted or suspended member must not be automatically booked.

### 5. [P1] Deployment setup shares the production database with previews

Locations: [setup-vercel-env.sh:25](/Users/ishprasad/code/onlysweats/scripts/setup-vercel-env.sh:25), [build script](/Users/ishprasad/code/onlysweats/package.json:11), [preview password behavior](/Users/ishprasad/code/onlysweats/src/lib/auth/social.server.ts:48).

The setup script assigns the same database connection to production and preview. Builds apply migrations, so a preview deployment or test can change production schema or data. Preview also allows password signup by default, while account linking accepts unverified local accounts. If this setup is used on an accessible preview, it exposes production identities to weaker authentication paths.

This is a confirmed configuration defect in the repository, not confirmation that the current deployment is exposed.

Fix: use a separate preview database or database branch, isolate migrations, and require verified local email before automatic account linking.

### 6. [P1] Mobile members cannot leave a standing slot

Locations: [unused leave hook](/Users/ishprasad/code/onlysweats/mobile/src/lib/queries.ts:211), [standing-slot cards](/Users/ishprasad/code/onlysweats/mobile/src/app/(tabs)/index.tsx:110).

The API and client hook support leaving a series, but no mobile screen calls the hook. Cards only open the next session, where a joiner can skip that occurrence. There is no ordinary way to end the recurring commitment, leaving members automatically booked into future weeks.

Fix: add a “Leave standing slot” action with a clear explanation of the effect on future sessions.

## Other broken flows and reliability gaps

### 7. [P2] An empty invite-only session disappears from its host's navigation

Location: [Today booking list](/Users/ishprasad/code/onlysweats/mobile/src/app/(tabs)/index.tsx:27).

Today and Inbox enumerate bookings; discovery only lists public sessions. After posting an unlisted session and leaving its detail screen, a host cannot normally reopen it to recover the invite or cancel it until someone books. The API already returns these hosted sessions independently of bookings.

Fix: display hosted sessions even when no seats have been taken.

### 8. [P2] Ratings and “Same time next week” cannot be reopened after completion

Locations: [thread navigation](/Users/ishprasad/code/onlysweats/mobile/src/app/thread/[id].tsx:53), [session navigation](/Users/ishprasad/code/onlysweats/mobile/src/app/session/[id].tsx:73), [completion actions](/Users/ishprasad/code/onlysweats/mobile/src/app/live/[id].tsx:253).

Only confirmed bookings inside the check-in window link to the Live screen. Rating and repeat actions exist only on that screen. Closing it after completion, completing while elsewhere, or submitting a rating removes the normal route back to those actions.

Fix: expose completion actions from session history and each completed booking's thread, including every seat in a group session.

### 9. [P2] Signing in loses an incoming invite

Location: [protected navigation](/Users/ishprasad/code/onlysweats/mobile/src/app/_layout.tsx:145).

The invite screen is removed from navigation while signed out, and authentication does not preserve a requested destination. A new member following an invite signs in and lands at the default tabs instead of the invited session.

Fix: preserve the invite code or intended route through authentication and resume it afterward. Verify on a cold-start device deep link.

### 10. [P2] Skipping a week can stop a standing slot indefinitely

Location: [service.server.ts:1133](/Users/ishprasad/code/onlysweats/src/lib/pace/service.server.ts:1133).

Settlement only visits confirmed bookings, and creation of the following occurrence happens through booking settlement. When the only joiner in a two-person slot skips, no confirmed booking remains to advance it.

Reproduction: after that occurrence's check-in window closes, the old session is still `open`; the series remains active with `nextSessionId: null` and `nextStartAt: null`.

Fix: close overdue sessions and advance active series independently of whether any confirmed bookings remain.

### 11. [P2] Granting notifications in Settings does not register the phone

Locations: [permission refresh](/Users/ishprasad/code/onlysweats/mobile/src/hooks/use-push.ts:11), [launch registration](/Users/ishprasad/code/onlysweats/mobile/src/app/_layout.tsx:110).

Returning from Settings refreshes permission display but does not register the push token. Someone who first denies permission and later enables it sees notifications as enabled while delivery remains unavailable until relaunch. Initial registration errors are also swallowed and can leave no visible retry action.

Fix: register or retry on foreground when permission is granted, and distinguish permission from successful device registration.

### 12. [P2] Multiple devices can make push batches too large to send

Location: [notify.server.ts:232](/Users/ishprasad/code/onlysweats/src/lib/pace/notify.server.ts:232).

Delivery claims up to 100 notification rows, expands each into one message per device, then submits the entire expanded array. An isolated reproduction with 51 notifications and two devices produced a single 102-message request. Expo accepts at most 100 notifications per request, so this request will be rejected; retrying the same oversized batch does not resolve it. [Expo delivery limits](https://docs.expo.dev/push-notifications/sending-notifications/).

Fix: split the final device-message array into batches of at most 100 and track partial delivery outcomes.

### 13. [P2] Failed push receipts are discarded without retrying delivery

Location: [notify.server.ts:287](/Users/ishprasad/code/onlysweats/src/lib/pace/notify.server.ts:287).

Receipt processing handles only dead devices, then deletes all checked tickets. It discards retryable provider errors, missing receipts, and tickets whose receipt request failed. The original notification remains marked sent.

Reproduction: successful ticket, then a simulated `MessageRateExceeded` receipt. The ticket was deleted, the notification remained marked sent with one attempt, and a later delivery pass made zero retry calls. Expo specifies retrying this error with backoff. [Expo error handling](https://docs.expo.dev/push-notifications/sending-notifications/).

Fix: retain unresolved receipts, associate each ticket with its notification and device, and retry recoverable failures with backoff.

### 14. [P2] Failed Apple authorization revocation cannot be retried

Location: [apple-revoke.server.ts:144](/Users/ishprasad/code/onlysweats/src/lib/auth/apple-revoke.server.ts:144).

A failed revoke request is logged, but the stored encrypted refresh token is deleted unconditionally. A temporary network or provider failure during account deletion permanently removes the credential needed to retry.

Fix: let account deletion finish while retaining an encrypted, bounded revocation job until it succeeds.

### 15. [P2] The documented local mobile setup targets the wrong API port

Locations: [mobile default](/Users/ishprasad/code/onlysweats/mobile/src/lib/config.ts:3), [server command](/Users/ishprasad/code/onlysweats/package.json:10).

Mobile defaults to port 8088; the documented `npm run dev` command starts the API on port 8080. A fresh setup without an explicit API URL cannot connect.

Fix: align the defaults and update the setup instructions.

### 16. [P2] The default test command never reaches the domain suite

Location: [package.json:19](/Users/ishprasad/code/onlysweats/package.json:19).

The script suite has 18 failures, including missing template-only files, outdated branding expectations, and obsolete assumptions about authentication and migrations. Because `npm test` joins the script and domain suites with `&&`, those failures prevent the domain tests from running.

Fix: update or remove obsolete template assertions, then add targeted regressions for the confirmed behavior gaps. Keep a reliable command that runs all relevant suites.

## Documentation discrepancy

### 17. [P3] Privacy copy says adult status is confirmed, but no confirmation exists

Locations: [privacy statement](/Users/ishprasad/code/onlysweats/src/routes/privacy.tsx:35), [sign-in consent](/Users/ishprasad/code/onlysweats/mobile/src/app/sign-in.tsx:122).

The privacy page says the app confirms users are 18 or older. The sign-in screen presents Terms/Privacy agreement, but there is no explicit adult confirmation or corresponding profile field/enforcement.

Fix: implement the stated confirmation or revise the description to match the actual behavior. This is a product/copy discrepancy, not a legal compliance determination.

## Unfinished work recorded by the original audit

These are already acknowledged in [the API contract](/Users/ishprasad/code/onlysweats/docs/API.md:210) and [mobile README](/Users/ishprasad/code/onlysweats/mobile/README.md:111), rather than newly discovered defects:

- Membership billing, card collection, and collection of recorded no-show fees.
- Phone/selfie/ID verification and fee-dispute tooling. Email dispute instructions exist, but the complete workflow is unfinished.
- Training blocks, gym matching, maps, and route links in the app. **Update:** training blocks, public joining, goal credits, and admin controls are now implemented on main and preserved by this integration.
- Universal-link association files and server-driven Live Activity updates while the app is closed.
- Android OAuth setup and Google OAuth production publishing are still marked unfinished in the README. Their current console state was not verified.
- Android push credential setup needs confirmation on a real build; current cloud credentials were not inspected.

The [vision roadmap](./VISION-ROADMAP.md) is the current pending-work checklist, including the selected Apple Health sync approach. This section and the validation below preserve the earlier audit snapshot.

## Validation and limits

- Web TypeScript check: passed.
- Mobile TypeScript check: passed.
- Mobile lint: passed.
- Domain/auth/application tests run directly: **122 passed, 0 failed**.
- Script tests: **178 passed, 18 failed** out of 196.
- Five additional backend scenarios reproduced in an isolated database; two notification scenarios reproduced with simulated delivery responses.
- No production accounts, data, or provider settings were changed. No physical-device acceptance test was performed.

Recommended order: fix safety and attendance/penalty correctness, isolate preview data, complete standing-slot controls and invite/history navigation, then address notification reliability and the test runner before expanding the pilot.
