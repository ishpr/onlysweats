# SamePace API (v1)

The contract the React Native client talks to, built to PRD v0.3 (membership).
Nobody pays anybody: there are no prices, holds or payouts. The server records
who showed up, and the fees, credits and strikes that follow when someone didn't.
The client never decides seats, check-in or fees.

- Base: `/api/v1` — JSON in, JSON out. Errors are `{ "error": "…" }`.
- Status codes: `400` bad input · `401` sign in again · `403` not yours ·
  `404` not found (also: unlisted without the link) · `409` rule says no (the
  message is user-facing copy).
- Code: rules in `src/lib/pace/rules.ts`, SQL + transactions in
  `src/lib/pace/service.server.ts`, routing in `src/lib/pace/http.server.ts`,
  types in `src/lib/pace/types.ts`, safety + admin in `src/lib/pace/safety.server.ts`,
  training blocks in
  `src/lib/pace/training-blocks.server.ts`, schema in `migrations/0002_pace.sql`,
  `0004_safety.sql`, `0007_training_blocks.sql` and `0008_training_block_requests.sql`.
  ("pace" stays the code shorthand; the product name is SamePace.)

## Auth

Better Auth at `/api/auth/*`. Members sign in with **Apple or Google** — the app
gets an identity token from the OS / Google's SDK and the server verifies its
signature, issuer, audience and nonce:

```
GET  /api/v1/auth-config        → { apple, google: { webClientId, iosClientId } | null, password }
POST /api/auth/sign-in/social   { provider: "apple" | "google",
                                  idToken: { token, nonce?, user?: { name: { firstName, lastName } } } }
POST /api/auth/sign-out
```

`auth-config` is the one endpoint that needs no session. Apple only shares a name
on first authorization, so the app forwards it in `idToken.user`; `PATCH /me`
covers the rest. The same verified email through either provider is one member.

A provider is on when its public identifier is set on the server —
`APPLE_BUNDLE_ID`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`. No client
secret is involved in the identity-token flow.

Email + password (`/api/auth/sign-up/email`, `/sign-in/email`) is a development
convenience: available outside production, and in production only until a
provider is configured. `AUTH_EMAIL_PASSWORD=on|off` overrides.

Every sign-in answers with a `set-auth-token` response header. Store it in the
device keychain and send it on every call:

```
Authorization: Bearer <token>
```

The first authenticated API call creates the caller's profile.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/me` | Profile + `abilities`, `creditCents`, `feesCents`, `strikes`, `frozenUntil`, `freeSessionsLeft`. |
| PATCH | `/me` | `{ name?, neighborhood?, gender?, abilities? }`. `abilities` merges per activity. No bio — by design. |
| GET | `/venues` | Cluster venues. No exact meeting spot here. |
| GET | `/sessions?womenOnly=1` | Public, open, upcoming (14 days). Each carries `abilityLabel` and `fitsMe`. Women-only sessions only appear to members they're open to. |
| POST | `/sessions` | Post a session. `ability` is required and must match the activity. |
| GET | `/sessions/:id?invite=` | `404` for an unlisted session unless you hold a seat, are a regular, or pass its invite code. |
| POST | `/sessions/:id/cancel` | Poster only. Free 12h+ ahead; inside 12h with someone confirmed, the poster pays the same $5 a joiner would. |
| POST | `/sessions/:id/bookings` | Join. `{ inviteCode? }` required for unlisted. On a standing slot you're not part of, this is a substitute seat. |
| POST | `/sessions/:id/code` | Poster only, inside the window. Rotates + reveals the 4-digit code (10 min). |
| GET | `/invites/:code` | Resolve an unlisted invite link: `{ session, people }`, or `{ trainingBlockId }` when the code opens a training block. |
| GET | `/bookings` | Everything I posted or joined: `{ bookings, sessions, series, trainingBlocks, people }`. Settles overdue no-shows first. A `series` entry carries `trainingBlockId` when it belongs to a block. |
| GET | `/bookings/:id` | |
| POST | `/bookings/:id/approve` · `/decline` | Poster only. |
| POST | `/bookings/:id/cancel` | Joiner. Also "skip this week" on a standing slot. 12h+: free. Inside 12h: `late_cancel`, $5 — waived (`covered`) if someone takes the seat. |
| POST | `/bookings/:id/checkin` | `{ lat, lng, accuracyM? }`. Server measures the 150 m fence. |
| POST | `/bookings/:id/checkin-code` | `{ code }`. Joiner types the poster's code; checks in both. |
| POST | `/bookings/:id/repeat` | "Same time next week": a completed session becomes a standing slot. |
| GET | `/series` | My standing slots: members, streak, next occurrence. |
| POST | `/series/:id/leave` | Leave a standing slot. Fewer than two regulars ends it. On a training block's slot this leaves the whole block. |
| POST | `/series/:id/training-block` | `{ goalKind, eventName?, goalDate }`. A standing slot I'm in gets a goal and a date; its regulars become the block's members. See *Training blocks*. |
| GET | `/training-blocks` | `{ blocks }`. Public, running, a regular seat open, four weeks or more to go, and not mine. No member ids, no faces. Hidden across a block and for women-only, as sessions are. |
| POST | `/training-blocks` | Post a block: `{ activity, goalKind, eventName?, goalDate, capacity, visibility, joinMode, womenOnly, slots: [1–4] }`. A slot is a session without the fields the block fixes. Starts `forming`. |
| GET | `/training-blocks/:id?invite=` | `{ block, people }`. `block.viewer` is `member`, `pending`, `declined` or `visitor`; only a member gets progress, requests and (if they started it) `inviteCode`. `404` for an unlisted block without the code. |
| POST | `/training-blocks/:id/join` | `{ inviteCode? }`. Takes a seat on every slot. With `joinMode: "approve"` it files a request instead. |
| POST | `/training-blocks/:id/requests/:memberId/approve` · `/decline` | Any member answers. |
| POST | `/training-blocks/:id/clone` | "Start one like it": same goal, date and slots, a week on, as a new `forming` block. `409` while the original still has a seat. |
| POST | `/training-blocks/:id/slots` | Add a weekly slot, up to 4. Whoever started the block only. Body is a session without `activity`, `capacity`, `visibility`, `joinMode`, `womenOnly` — the block fixes those. |
| POST | `/training-blocks/:id/leave` | Leave every slot in the block. |
| GET/POST | `/bookings/:id/messages` | Booking-scoped chat. Opens on join, closes 24h after the session. |
| POST | `/bookings/:id/rating` | Five booleans, once per side, after completion. `matchedListing` includes "level was as stated". |
| DELETE | `/me` | Delete my account, now. See *Safety and account*. |
| POST | `/me/apple-authorization` | `{ code }` — Apple's one-time authorization code, sent once after Sign in with Apple. The server trades it for a refresh token (stored encrypted) so `DELETE /me` can revoke the app's access, as the App Store requires. A no-op until `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` are set. |
| POST | `/devices` | `{ token, platform: "ios" \| "android" }` — this phone's Expo push token. A token belongs to one member at a time. |
| DELETE | `/devices/:token` | Called before sign-out. |
| GET | `/notifications` | `{ notifications, unread }` — the last 30 days, newest first. The same rows whether or not push is on. |
| POST | `/notifications/read` | Marks everything read. |
| GET | `/blocks` | Members I blocked: `{ people }`. Being blocked is never visible. |
| POST | `/blocks` | `{ memberId }`. Idempotent. |
| DELETE | `/blocks/:id` | Unblock. |
| POST | `/reports` | `{ reportedId, reason, detail?, sessionId? \| bookingId?, alsoBlock? }` → `{ id, blocked }`. |

`GET /me` also carries `suspended: { reason } \| null` and `isAdmin`.

## Notifications

Every notification is a row written **inside the transaction that caused it**
(`notify.enqueue`), so it exists exactly when the thing it describes does. After
any non-GET request the API pushes what is owed through Expo's push service
(`notify.deliverDue`); the 10-minute cron sweeps up anything missed, sends
reminders, and reads Expo's receipts to retire dead device tokens. Rows are
claimed with `for update skip locked`, so nothing is sent twice; a failed send is
retried up to three times within the hour.

| Kind | To | Category |
| --- | --- | --- |
| `seat_taken` · `seat_requested` · `seat_cancelled` | poster | sessions |
| `seat_approved` · `seat_declined` · `session_cancelled` | joiner | sessions |
| `next_occurrence` | every regular | sessions |
| `stood_up` ($5 credit) | whoever showed | sessions |
| `message` | the other person | messages |
| `starts_soon` (≤ 60 min) · `checkin_open` (20 min before) | both, once each | reminders |
| `substitute_offer` | up to 10 members at that level, best on-time record first | substitutes |
| `no_show` · `frozen` · `suspended` · `session_removed` · `admin_report` | the member / admins | account |

`PATCH /me { notify: { sessions?, messages?, reminders?, substitutes? } }` mutes a
category for push only — the activity list still gets the row. `account` notices
always send. The `url` on a notification is an in-app route (`/thread/:id`,
`/session/:id`, `/live/:id`, …) the app opens on tap.

Substitute offers only go to members who have completed a session, aren't frozen,
paused or blocked with anyone on the session, aren't already regulars, and whose
level fits. `EXPO_ACCESS_TOKEN` is only needed if the Expo project turns on
enhanced push security.

## Safety and account

**Block** is mutual in effect and covers everyone on a session — the poster and
anyone holding a seat, whichever side blocked. A blocked pair don't see each
other's sessions in `/sessions`, get `404` on the listing and on joining, and
can't message (`409`). Blocking releases any upcoming seat the two share, free,
and steps the blocker out of a standing slot they share. Nobody is notified.

**Report** needs a `sessionId` or `bookingId` — members only meet through
sessions. Anyone can report the poster of a public listing; reporting someone
else on a session takes being on it. Reasons: `date_framing` ("made it feel like
a date"), `harassment`, `unsafe`, `misrepresented`, `fake_or_spam`, `other`. One
open report per reporter, member and session; ten reports a day.

**Suspended** members get `403` on everything except `GET /me` and `DELETE /me`.
Suspending calls off their sessions and releases their seats, free.

**Delete** removes the auth user (and its sessions and linked Apple / Google
identities), scrubs the profile to "Deleted member" and keeps the row so other
people's history, ledger and reports still resolve. Upcoming sessions and seats
are released free. Messages go, except in a thread a report points at. A
suspended member who deletes can't sign up again with the same email — only a
SHA-256 of the address is kept.

## Admin

`/admin/*` answers `404` unless the caller's email is in `ADMIN_EMAILS`
(comma-separated) — and, in production, is an email the identity provider
verified, so a password sign-up never qualifies. The web page is `/admin`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/overview` | Counts: members, paused, upcoming sessions, open reports, fees assessed. |
| GET | `/admin/reports?status=open\|actioned\|dismissed` | The queue, with the booking's thread when the report points at one. |
| POST | `/admin/reports/:id/resolve` | `{ action: "dismiss" \| "suspend" \| "remove_session" \| "suspend_and_remove", note? }` |
| GET | `/admin/members?q=` · `/admin/members/:id` | Lookup by name or handle. Admin only — members never get a directory. |
| POST | `/admin/members/:id/suspend` · `/unsuspend` | `{ note }` — the member sees the note. |
| POST | `/admin/sessions/:id/remove` | `{ note }`. Seats released free. |
| GET | `/admin/actions` | Append-only audit log. |

## Ability

Required on every session — a number or a plain word about the workout, never
about a body, never rated by other members.

| Activity | `ability` |
| --- | --- |
| `run` | `{ kind: "run", paceMinSec, paceMaxSec, miles }` |
| `ride` | `{ kind: "ride", mphMin, mphMax, miles, surface: "road" \| "gravel" }` |
| `strength` (Gym) | `{ kind: "gym", experience: "new" \| "regular" \| "advanced", focus }` |
| `hike` | `{ kind: "hike", miles, gainFt, difficulty: "easy" \| "moderate" \| "hard" }` |
| `walk` | `{ kind: "walk", effort: "easy" \| "brisk", miles }` |
| `mobility` | `{ kind: "open" }` |

`abilityFlex: "flexible"` means the poster will adjust, so it fits everyone.
`fitsMe` is `true`/`false` against the level on my profile, or `null` when I
haven't set one for that activity (nothing is hidden from me then).

## What the server hides

- `session.code` — poster only. Joiners never receive it.
- `session.pinHint` (exact meeting spot) — poster and confirmed joiners only.
- `session.inviteCode` — poster only.
- Unlisted sessions — absent from `/sessions`; `404` without the link or a seat.
- Women-only sessions — absent from `/sessions` for members they aren't open to.
- There is no people search, member directory or "members near you" endpoint.

## Settlement

Both check in → `completed`. Nothing is charged.

After the window closes (`start + 25 min`), `settleDue` resolves the rest, the
same way for poster and joiner: whoever didn't come gets a **$10 fee and a
strike**; whoever did gets **$5 of membership credit**. Nobody came → `void`, no
fee (no one was stood up). An unanswered request → `declined`. Two strikes in 60
days pause posting and joining **public** sessions for 14 days; invites from
people you know still work. Fees carry `chargeable_at` = 24h after the session,
the dispute window. It runs on `GET /bookings` until a scheduler owns it.

## Standing slots

`POST /bookings/:id/repeat` on a completed booking creates a series of the people
who showed up and puts next week's occurrence on the calendar — same place, level
and wall-clock time (DST-safe) — with every regular already confirmed. Each
occurrence is a normal session. When one finishes, the next is created and the
streak moves (everyone checked in → +1, otherwise 0). A regular who cancels an
occurrence keeps their place; the open seat shows in discovery as
`substituteSeat`, and whoever takes it has `substituteFor` set and joins that
occurrence only.

## Training blocks

One to four standing slots tied to a goal and a date (PRD v0.3 §6). A block adds
no session mechanics: its slots are ordinary standing slots, and its progress is
read off the check-ins they already record. Nothing is logged by a member, and no
body metric is collected — there is no weight goal. (`/blocks` is blocked members;
these routes are `/training-blocks`.)

- **Goal.** `goalKind` is one of `race_5k`, `race_10k`, `race_half`,
  `race_marathon` (run or walk), `ride_century` (ride), `hike_trip` (hike),
  `event_other` or `consistency` (any activity). `eventName` (60 chars) is the only
  free text: required for `event_other`, optional for the other events, refused
  for `consistency`. `goalLabel` is what to show: "Dallas Marathon", "Marathon",
  or "3× a week for 12 weeks".
- **Dates.** `goalDate` is `YYYY-MM-DD` in the cluster, 28 to 140 days after the
  day the block starts. Slots stop at the goal date: no occurrence is created past
  it. `weeks` and `weekNumber` give "Week 6 of 16".
- **Progress** is per member and private: `my: { planned, kept, keptMiles,
  finished }`. Nobody receives another member's numbers; `group` is everyone's
  sessions added up.
  - *Kept*: I checked in, by fence or code — even if my buddy didn't show.
  - *Planned*: every occurrence since I joined whose check-in window has closed. A
    week someone else called off is left out; one I called off, or skipped with
    notice, counts and isn't kept. A week I posted and everyone else skipped is
    left out — there was nobody to check in with.
  - `keptMiles` is the stated distance of the sessions I kept. It is planned
    distance, never measured; show it as "mi of sessions kept".
- **Adding a slot** confirms every member into its first occurrence, the way a
  standing slot does, so that occurrence must start at least 48 hours out.
- **Closing.** The day after the goal date — once the last session has settled —
  the block moves to `closing`: each member's numbers are written down once,
  `finished` is set (kept ≥ 75% of planned), and `GET /bookings` keeps listing the
  block for 14 days. A block with fewer than two members ends (`too_few`).
- A week every regular skipped now closes on its own, so the slot rolls forward.
  This also fixes plain standing slots, which used to stall on such a week.

- **Posting one.** A posted block is `forming` until a second member joins, and
  keeps rolling its weekly sessions while it waits. Nobody within two weeks of its
  first session: it is called off (`too_few`) and whoever posted it is told.
- **Joining** is joining every slot, as a regular, and is only ever asked for at
  `/training-blocks/:id/join` — never by taking a seat on one session. Open while
  the block runs, has a seat, and has four weeks or more to go. The new regular
  gets a seat on each slot's next session where one is free.
- **A block's sessions in `/sessions`** carry `block: { id, goalLabel, goalDate,
  weeks, weekNumber, regularSeatsLeft, joinable }`. While `joinable`, a free seat
  is a regular's and `POST /sessions/:id/bookings` answers `409` pointing at the
  block — unless a regular is out that week, which is a `substituteSeat` as before.
  Once a block stops taking regulars, its spare seats are ordinary one-off seats.
- **Visibility.** Same as sessions: an unlisted block is a `404` without its
  invite code, and so is any block across a block between members, or a
  women-only one not open to the viewer. A visitor sees the members (they are on
  the block's sessions) but never anyone's progress.

Not built yet: goal credits ("helped me stick to it") and what happens to the
slots after `closing`.

## Words

Titles, details and event names go through one whole-word list (PRD v0.3 §8):
tinder, swipe, match, spark, date, crush, single, cute, chemistry, vibe.
"Update" and "singletrack" pass; "single-leg" and "single-arm" are let through.
A hit is a `400` naming the word. The list is `BANNED_WORDS` in `rules.ts`.

## Not built yet (PRD v0.3)

- **Charging.** Membership ($12/mo after two completed sessions, once a cluster
  passes its density gate), card on file, and actually collecting fees. The
  ledger records what is owed; nothing is charged.
- **Goal credits** and the end-of-block choices (training blocks themselves are
  built — see *Training blocks*), gym sessions matched on `gym_id`, `route_url` in
  the app.
- **Verification** (phone, selfie liveness, ID for women-only) and fee disputes.


## Local dev

`npm run dev` with no `DATABASE_URL` runs an in-memory Postgres (PGLite): data
resets on restart, and a demo cluster of members and sessions is seeded on the
first API call. Set `DATABASE_URL` for a real Postgres — `npm run db:migrate`
applies `migrations/*.sql`, and no demo data is ever written there.
