# Journey and product-logic audit — 2026-09-20 (condensed)

Verdict: the app is a listings board with a check-in gate, not a buddy finder. The
structural problems are information architecture, first-run, and the post-session
loop — not the styling of You or Post.

## Ten most damaging
1. **P0** "Same time next week" auto-confirms the OTHER person into a weekly session with fees, no consent; no screen can leave a weekly session (`useLeaveSeries` unused).
2. **P0** Rating and "make it weekly" appear the instant both check in — before the workout. Submit calls `router.back()`; once `completed`, nothing links back to `/live/[id]`; no post-session nudge. Reputation + retention loops are unreachable.
3. **P0** No onboarding; level is never asked; Today isn't filtered by level; cards don't show fit; the "set your level" prompt isn't a link.
4. **P0** You can't see who you're meeting. Approve card shows a name only (server already returns level + record); co-joiners invisible; no profile view; `identityVerified` never shown.
5. **P0** A post with no joiner appears nowhere (Today, Inbox, widget iterate bookings). An invite-only post is unreachable — can't re-share the link.
6. **P0** Push prompt renders only when a booking exists, so a fresh poster is never asked and misses "asked to join".
7. **P0** Block copy says "released at no charge" but the server only releases seats with `start_at > now` — blocking at the meeting point after start still yields $10 + strike; `severTies` cancels silently (no notification); co-joiners aren't covered although docs say they are.
8. **P0** No way to keep a buddy: chat closes after 24h, no list of people you trained with, no "go again".
9. **P1** Host no-show with N joiners = N × $10 and N strikes (instant freeze with two joiners). UI says "$10 and a strike".
10. **P1** Supply vs promise: four outdoor venues, no gym; meeting point is a fixed per-venue string the host can't see or set; 150 m fence around one coordinate on a multi-mile trail; no map or directions anywhere.

## Other P1s by journey
- New member: name can be "Member"; everyone is "Oak Lawn"; fit ignores distance (3-mile runner "fits" a 13-mile run) and gym needs exact match; no day/area filter, no Walk/Mobility chips, men see an always-empty Women-only chip; empty feed offers only "post" — no "alert me when…"; join inside 12h is instantly fee-liable with no confirmation; no add-to-calendar/directions; lapsed request silently becomes "Declined".
- Posting: defaults pollute the feed; wrong field order, 17 hour chips with PM off-screen, five unlabelled toggle chips; duration hardcoded; past hours selectable; frozen member fills the whole form then gets a 400; public posts can't be shared; posts can't be edited; host Today shows one card per booking; requests link to a chat with no Approve button; Inbox badge counts my own requests.
- Day-of: text-only meeting hint; location prompt fires cold at the trailhead; no signal ⇒ no-show fee (code path needs the joiner's network; only joiner→host direction works); no link from check-in to chat; arrive at minute 26 and do the workout ⇒ $10 + strike, no mutual override; raw status strings; host check-in shows one joiner; number pad covers "Enter code" (auto-submit on 4th digit); substitute told "already on the calendar" when they aren't in the group; no mutual free call-off for weather.
- Fees: approval inside 12h creates instant liability; no fee ledger, `myFeeCents` never rendered, no dispute action (only an email in a push); frozen members still see live Join/Post buttons; `covered` fires no notification.
- Weekly: host can't skip a week (only cancel for everyone); only one future occurrence exists; no manage screen.
- Invite: web invite page shows no name/time/place and no store link; no universal/app links; invite code is lost at sign-in; in-app invite screen is a pointless hop with a dead-end error.

## Proposed structure
1. **Find** (home) — level-matched feed with "fits you"/"stretch", filters (activity, day, area), map toggle, empty state = "Alert me" + "Post your plan".
2. **Plans** — live card; requests to approve (with level + record); upcoming joined AND posted (incl. zero joiners) with Share; weekly sessions with Skip/Leave; past with Rate / Go again / Dispute.
3. **Buddies** — people you've completed sessions with, "Go again"; chats live here with unread + last message.
4. **You** — levels, record, fees/credits/strikes ledger; settings behind a gear; a bell for notifications in every header.
Post becomes a secondary "Post your plan" action.

First run: activities → level per activity ("not sure" allowed) → area + usual times → first name (+ women-only opt-in) → one screen explaining check-in, the 12-hour rule and no-show fees with explicit accept → Find (or alert setup). Location pre-prompt at first confirmed spot; push pre-prompt at first join or post.

## Accessibility / platform
Live banner + tab badge contrast (3.9:1 at small sizes); no keyboard avoidance outside chat; check-in success not announced; bubbles lack sender/time for VoiceOver; cold deep links lack a back affordance and bypass the suspended gate; small targets (All listings, Terms/Privacy links); chips should be radio/checkbox; no `maxFontSizeMultiplier`; Android back discards Post/Report input; sign out has no confirmation.
