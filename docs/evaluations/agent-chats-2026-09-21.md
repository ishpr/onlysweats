# Agent Chats acceptance — September 21, 2026

SamePace now initiates agent-to-agent contact from saved planning preferences under current product Terms. Chats shows the recorded exchanges and keeps human plan/booking approvals separate. Direct member messaging, manual first-contact invitations and fabricated host greetings have been removed; historical member messages retain their authors and remain read-only. Private coaching stays conversational and uses the backend-selected `zai/glm-5.3-flash` model.

## Scope and evidence

All acceptance accounts, preferences, workouts and messages in this pass were synthetic. No real members were contacted, no provider requests were made, and no production privacy choice was accepted on a member’s behalf.

- Embedded and real PostgreSQL service tests cover contact authority, old discovery opt-outs, current Terms, blocks, verification/audience boundaries, expiry, quotas, cooldowns, duplicate workers, rollback/recovery, delegated access, proposal provenance and exactly one booking after both people approve.
- Real PostgreSQL races verify opposite member scans create one room/run and that a privacy withdrawal either prevents contact or cancels unbooked work before another agent action commits.
- **47 actual HTTP requests passed** through isolated Vite and real Better Auth bearer sessions on disposable PostgreSQL. These cover anonymous/invalid sessions, Terms/preference/matching contracts, automatic contact through review, bilateral history, strict payloads, duplicate checks, disabled invitation/proposal/message writes, no synthetic greeting on booking, pause/replay and suspended-account privacy access.
- **Nine rendered Expo web checks passed**: agent inbox, pause/resume, truthful actor attribution, no DM composer, explicit plan confirmation, exact booking-term approval, report entry, read-only historical messages and old assistant-link redirect. No page errors occurred; existing development-only React Native SVG warnings were visible.
- Root and mobile TypeScript, focused lint, web production bundling and the iOS JavaScript export passed. No native dependency or entitlement changed.

The initial whole-suite pass found one obsolete test expecting a fabricated booking greeting. It was corrected to require no message. The final suite passed **983 tests, zero failures and zero skips** with disposable PostgreSQL enabled.

A final review identified a continuation gap after saving changed availability. The implementation now revisits existing automatic rooms, clears obsolete plans/approvals, preserves explicit stops and completed bookings, and shows no-match or planning-limit reasons. An additional **36 real HTTP requests** verified same-room replanning, invalidation of old approvals/terms, no-match recovery and duplicate-save/check stability. Four focused rendered checks covered awaiting-review, no-match, planning-limit messaging and the preferences link. These complement the 47-request baseline for **83 actual HTTP requests** total. Four contact-specific real PostgreSQL races include concurrent preference saves and opposite-side replanning; identical saves preserve the preference revision. The stricter women-only verification candidate case now skips an ineligible candidate without aborting ordinary matching. Final root/mobile types, scoped lint, web build and iOS export all passed.

## Product and permission boundaries

Migration `0034_agent_contacts.sql` creates no initial member authority. The new `samepace-2026-09-21-agent-chats` Terms receipt initializes it atomically, preserving previous opt-outs. Agents receive entered planning information only; private coaching, HealthKit records and private workout results are excluded. First contact and continuation use bounded deterministic planning rather than invented conversational prose. The A2A endpoint remains available to scoped delegated clients; outbound federation is still separate future work.

Members can pause matching, stop a conversation, report or block a member. Agents cannot perform member plan confirmation, accept booking terms, authorize payments or fabricate completed exercise. Existing booked workouts require the normal cancellation flow.

## Remaining acceptance

This does not certify physical iPhone notification delivery, a real two-member experience, provider enforcement, outbound agent federation or general matching quality. Install the latest signed development client if needed, reload the app after deployment and review the updated Terms yourself. No new native build is required for this change. Claude continues to own visual design.

Ignored local evidence lives in `.vercel/agent-chats-acceptance`: HTTP scripts and results, rendered screenshots and request trace, PostgreSQL/full-suite logs, types/lint and bundle outputs. The release handoff preserves this directory alongside the live main checkout.
