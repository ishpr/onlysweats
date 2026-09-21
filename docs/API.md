# SamePace API (v1)

The contract the React Native client talks to, built from PRD v0.3 (membership).
The server records attendance, fees, credits and strikes. Hosted Stripe membership
and individual fee checkout are implemented behind explicit activation gates;
there are no member-to-member payouts or automatic off-session fee charges.
The client never decides seats, check-in, fees or payment status.

- Base: `/api/v1` — JSON in, JSON out. Errors are `{ "error": "…" }`.
- Status codes: `400` bad input · `401` sign in again · `403` not yours ·
  `404` not found (also: unlisted without the link) · `409` rule says no (the
  message is user-facing copy).
- Code: rules in `src/lib/pace/rules.ts`, SQL + transactions in
  `src/lib/pace/service.server.ts`, routing in `src/lib/pace/http.server.ts`,
  types in `src/lib/pace/types.ts`, safety + admin in `src/lib/pace/safety.server.ts`,
  training blocks in
  `src/lib/pace/training-blocks.server.ts`, schema in `migrations/0002_pace.sql`,
  `0004_safety.sql`, `0007_training_blocks.sql`, `0008_training_block_requests.sql`,
  `0009_goal_credits.sql`, `0010_admin_training_blocks.sql`,
  `0011_session_attendance.sql`, `0012_delivery_retries.sql`, `0013_agent_negotiations.sql`,
  and later migrations through `0023_discovery.sql`. Apply the complete migration set.
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

| Method   | Path                                                           | Notes                                                                                                                                                                                                                                                                                                    |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/me`                                                          | Profile + `blocksFinished`, `helpedCount`, `abilities`, `creditCents`, `feesCents`, `strikes`, `frozenUntil`, `freeSessionsLeft`.                                                                                                                                                                        |
| PATCH    | `/me`                                                          | `{ name?, neighborhood?, gender?, abilities? }`. `abilities` merges per activity. No bio — by design.                                                                                                                                                                                                    |
| GET      | `/venues`                                                      | Cluster venues. No exact meeting spot here.                                                                                                                                                                                                                                                              |
| GET      | `/sessions?womenOnly=1`                                        | Public, open, upcoming (14 days). Each carries `abilityLabel` and `fitsMe`. Women-only sessions only appear to members they're open to.                                                                                                                                                                  |
| POST     | `/sessions`                                                    | Post a session. `ability` is required and must match the activity.                                                                                                                                                                                                                                       |
| GET      | `/sessions/:id?invite=`                                        | `404` for an unlisted session unless you hold a seat, are a regular, or pass its invite code.                                                                                                                                                                                                            |
| POST     | `/sessions/:id/cancel`                                         | Poster only. Free 12h+ ahead; inside 12h with someone confirmed, the poster pays the same $5 a joiner would.                                                                                                                                                                                             |
| POST     | `/sessions/:id/bookings`                                       | Join. `{ inviteCode? }` required for unlisted. On a standing slot you're not part of, this is a substitute seat.                                                                                                                                                                                         |
| POST     | `/sessions/:id/code`                                           | Poster only, inside the window. Rotates + reveals the 4-digit code (10 min).                                                                                                                                                                                                                             |
| GET      | `/invites/:code`                                               | Resolve an unlisted invite link: `{ session, people }`, or `{ trainingBlockId }` when the code opens a training block.                                                                                                                                                                                   |
| GET      | `/bookings`                                                    | Everything I posted or joined: `{ bookings, sessions, series, trainingBlocks, people }`. Settles overdue no-shows first. A `series` entry carries `trainingBlockId` when it belongs to a block.                                                                                                          |
| GET      | `/bookings/:id`                                                |                                                                                                                                                                                                                                                                                                          |
| POST     | `/bookings/:id/approve` · `/decline`                           | Poster only.                                                                                                                                                                                                                                                                                             |
| POST     | `/bookings/:id/cancel`                                         | Joiner. Also "skip this week" on a standing slot. 12h+: free. Inside 12h: `late_cancel`, $5 — waived (`covered`) if someone takes the seat.                                                                                                                                                              |
| POST     | `/bookings/:id/checkin`                                        | `{ lat, lng, accuracyM? }`. Server measures the 150 m fence.                                                                                                                                                                                                                                             |
| POST     | `/bookings/:id/checkin-code`                                   | `{ code }`. Joiner types the poster's code; checks in both.                                                                                                                                                                                                                                              |
| POST     | `/bookings/:id/repeat`                                         | "Same time next week": a completed session becomes a standing slot.                                                                                                                                                                                                                                      |
| GET      | `/series`                                                      | My standing slots: members, streak, next occurrence.                                                                                                                                                                                                                                                     |
| POST     | `/series/:id/leave`                                            | Leave a standing slot. Fewer than two regulars ends it. On a training block's slot this leaves the whole block.                                                                                                                                                                                          |
| POST     | `/series/:id/training-block`                                   | `{ goalKind, eventName?, goalDate }`. A standing slot I'm in gets a goal and a date; its regulars become the block's members. See _Training blocks_.                                                                                                                                                     |
| GET      | `/training-blocks`                                             | `{ blocks }`. Public, running, a regular seat open, four weeks or more to go, and not mine. No member ids, no faces. Hidden across a block and for women-only, as sessions are.                                                                                                                          |
| POST     | `/training-blocks`                                             | Post a block: `{ activity, goalKind, eventName?, goalDate, capacity, visibility, joinMode, womenOnly, slots: [1–4] }`. A slot is a session without the fields the block fixes. Starts `forming`.                                                                                                         |
| GET      | `/training-blocks/:id?invite=`                                 | `{ block, people }`. `block.viewer` is `member`, `pending`, `declined` or `visitor`; only a member gets progress, requests and (if they started it) `inviteCode`. `404` for an unlisted block without the code.                                                                                          |
| POST     | `/training-blocks/:id/join`                                    | `{ inviteCode? }`. Takes a seat on every slot. With `joinMode: "approve"` it files a request instead.                                                                                                                                                                                                    |
| POST     | `/training-blocks/:id/requests/:memberId/approve` · `/decline` | Any member answers.                                                                                                                                                                                                                                                                                      |
| POST     | `/training-blocks/:id/credits`                                 | `{ toIds: [] }`. A finisher's one answer to "helped me stick to it?", in the week after the goal date. An empty list is an answer.                                                                                                                                                                       |
| POST     | `/training-blocks/:id/next`                                    | `{ action: "keep_slots" }`, or `{ action: "next_block", goalKind, eventName?, goalDate }`. Any member, for two weeks after the goal date.                                                                                                                                                                |
| POST     | `/training-blocks/:id/clone`                                   | "Start one like it": same goal, date and slots, a week on, as a new `forming` block. `409` while the original still has a seat.                                                                                                                                                                          |
| POST     | `/training-blocks/:id/slots`                                   | Add a weekly slot, up to 4. Whoever started the block only. Body is a session without `activity`, `capacity`, `visibility`, `joinMode`, `womenOnly` — the block fixes those.                                                                                                                             |
| POST     | `/training-blocks/:id/leave`                                   | Leave every slot in the block.                                                                                                                                                                                                                                                                           |
| GET/POST | `/bookings/:id/messages`                                       | Booking-scoped chat. Opens on join, closes 24h after the session.                                                                                                                                                                                                                                        |
| POST     | `/bookings/:id/rating`                                         | Five booleans, once per side, after completion. `matchedListing` includes "level was as stated".                                                                                                                                                                                                         |
| DELETE   | `/me`                                                          | Delete my account, now. See _Safety and account_.                                                                                                                                                                                                                                                        |
| POST     | `/me/apple-authorization`                                      | `{ code }` — Apple's one-time authorization code, sent once after Sign in with Apple. The server trades it for a refresh token (stored encrypted) so `DELETE /me` can revoke the app's access, as the App Store requires. A no-op until `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` are set. |
| POST     | `/devices`                                                     | `{ token, platform: "ios" \| "android" }` — this phone's Expo push token. A token belongs to one member at a time.                                                                                                                                                                                       |
| DELETE   | `/devices/:token`                                              | Called before sign-out.                                                                                                                                                                                                                                                                                  |
| GET      | `/notifications`                                               | `{ notifications, unread }` — the last 30 days, newest first. The same rows whether or not push is on.                                                                                                                                                                                                   |
| POST     | `/notifications/read`                                          | Marks everything read.                                                                                                                                                                                                                                                                                   |
| GET      | `/blocks`                                                      | Members I blocked: `{ people }`. Being blocked is never visible.                                                                                                                                                                                                                                         |
| POST     | `/blocks`                                                      | `{ memberId }`. Idempotent.                                                                                                                                                                                                                                                                              |
| DELETE   | `/blocks/:id`                                                  | Unblock.                                                                                                                                                                                                                                                                                                 |
| POST     | `/reports`                                                     | `{ reportedId, reason, detail?, sessionId? \| bookingId? \| negotiationId?, alsoBlock? }` → `{ id, blocked }`. Supply one valid context.                                                                                                                                                                 |

`GET /me` also carries `suspended: { reason } \| null` and `isAdmin`.

## Agent negotiation and booking

These routes are available only when `A2A_ENABLED=true`; otherwise they return
`404`. They require a normal Better Auth **member session**. Scoped agent tokens
cannot issue credentials, consent for a person, or confirm a proposal here.

| Method | Path                               | Body / response                                                                                                                                                                   |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/agents/delegations`              | `{ delegations: [{ id, label, expiresAt, revokedAt }] }`; never returns existing tokens.                                                                                          |
| POST   | `/agents/delegations`              | `{ label, expiresInHours? }` → `{ delegation: { id, label, token, expiresAt, scope } }`. Label 1–80 characters; integer expiry 1–24 hours, default 24; scope `workout:negotiate`. |
| DELETE | `/agents/delegations/:id`          | Empty body or `{}` → `{ ok: true }`; revoke only your own credential.                                                                                                             |
| GET    | `/agents/negotiations`             | `{ negotiations }`; latest 100 accessible conversations.                                                                                                                          |
| POST   | `/agents/negotiations`             | `{ bookingId }` → `{ negotiation }`; starts from a completed shared booking and opts in only the caller.                                                                          |
| GET    | `/agents/negotiations/:id`         | `{ negotiation }`.                                                                                                                                                                |
| POST   | `/agents/negotiations/:id/consent` | `{ allow: boolean }` → `{ negotiation }`; withdrawing consent cancels the conversation.                                                                                           |
| POST   | `/agents/negotiations/:id/confirm` | `{ revision: integer >= 1 }` → `{ negotiation }`; invoke only after the signed-in person explicitly approves that revision.                                                       |
| POST   | `/agents/negotiations/:id/cancel`  | Empty body or `{}` → `{ negotiation }`; cancels the negotiation only.                                                                                                             |

A negotiation contains `{ id, bookingId, memberIds, consentedIds, state, revision,
plan, confirmedIds, expiresAt, booked, sessionId, resultBookingId }`. `bookingId`
is null for first-time discovery invitations; `booked` reflects actual execution.
`state` is `open`, `approved`,
`cancelled`, or `expired`. Each changed proposal increments the revision and
clears previous confirmations. Both people must consent before agents can access
the conversation, then confirm the same current revision for it to be approved.
**Plan confirmation does not create or cancel a session, seat, standing slot, or fee.**
After confirmation, each person separately reviews `GET /agents/negotiations/:id/booking-terms`
and accepts its `{revision, termsHash}` through `POST /agents/negotiations/:id/book`.
The second matching acceptance creates one ordinary workout atomically. Preference,
candidate, proposal and history routes are documented in the [A2A guide](./A2A.md).
Request bodies reject unknown properties; delegation and negotiation IDs are UUIDs.

The separate A2A 1.0 JSON-RPC endpoint is `POST /api/a2a`, discovered at
`GET /.well-known/agent-card.json`. It uses official `@a2a-js/sdk` 1.2.0 and
requires a scoped delegation token plus `A2A-Version: 1.0`. It supports structured
proposal/counteroffer messages, task reads/listing, and cancellation of open
negotiations. The mobile assistant supports entered preferences, bounded automatic
planning, first-time introductions and separate human booking acceptance. The
internal planner makes no model calls. Outbound federation and connected calendars
remain future scope.
See [the A2A framework guide](./A2A.md) for schemas, limits, authorization rules,
and a complete two-member example.

## Notifications

Every notification is a row written **inside the transaction that caused it**
(`notify.enqueue`), so it exists exactly when the thing it describes does. After
any non-GET request the API pushes what is owed through Expo's push service
(`notify.deliverDue`); the 10-minute cron sweeps up anything missed, sends
reminders, and reads Expo's receipts to retire dead device tokens. Rows are
claimed with `for update skip locked` and leased to one worker at a time; stale
worker replies cannot overwrite recovered jobs. Sending is attempted at most
three times. A lost provider response can still cause duplicate external delivery;
the database claim is not an exactly-once push guarantee.

| Kind                                                                    | To                                                        | Category    |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | ----------- |
| `seat_taken` · `seat_requested` · `seat_cancelled`                      | poster                                                    | sessions    |
| `seat_approved` · `seat_declined` · `session_cancelled`                 | joiner                                                    | sessions    |
| `next_occurrence`                                                       | every regular                                             | sessions    |
| `stood_up` ($5 credit)                                                  | whoever showed                                            | sessions    |
| `message`                                                               | the other person                                          | messages    |
| `starts_soon` (≤ 60 min) · `checkin_open` (20 min before)               | both, once each                                           | reminders   |
| `substitute_offer`                                                      | up to 10 members at that level, best on-time record first | substitutes |
| `no_show` · `frozen` · `suspended` · `session_removed` · `admin_report` | the member / admins                                       | account     |

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

**Report** needs a `sessionId`, `bookingId` or `negotiationId`. Either participant
may report a first-time invitation before accepting it or after blocking.
Anyone can report the poster of a public listing; reporting someone
else on a session takes being on it. Reasons: `date_framing` ("made it feel like
a date"), `harassment`, `unsafe`, `misrepresented`, `fake_or_spam`, `other`. One
open report per reporter, member and context; ten reports a day.

**Suspended** members cannot create ordinary workout commitments or enable new
fitness/agent permissions. They can still read their account, delete it, manage
notifications/devices, inspect/export/remove private records, revoke permissions,
and access billing management or fee disputes. The exact route allowlist is
`OPEN_WHEN_SUSPENDED` in `http.server.ts`; each service still checks ownership and
eligibility. Suspending calls off their sessions and releases their seats, free.

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

| Method | Path                                              | Notes                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/overview`                                 | Counts: members, paused, upcoming sessions, running training blocks, open reports, fees assessed.                                                                                                                           |
| GET    | `/admin/reports?status=open\|actioned\|dismissed` | The queue, with the booking's thread when the report points at one.                                                                                                                                                         |
| POST   | `/admin/reports/:id/resolve`                      | `{ action: "dismiss" \| "suspend" \| "remove_session" \| "suspend_and_remove", note? }`                                                                                                                                     |
| GET    | `/admin/members?q=` · `/admin/members/:id`        | Lookup by name or handle, with the blocks they have been in. Admin only — members never get a directory.                                                                                                                    |
| POST   | `/admin/members/:id/suspend` · `/unsuspend`       | `{ note }` — the member sees the note.                                                                                                                                                                                      |
| POST   | `/admin/sessions/:id/remove`                      | `{ note }`. Seats released free. One week of a running training block takes the whole block down: its listing comes back every week with the same words.                                                                    |
| POST   | `/admin/training-blocks/:id/remove`               | `{ note }`. Slots end, every session still on the calendar is called off, seats released free. Whoever started it is told why; the others that their seats are gone. Check-ins, progress and credits already recorded stay. |
| GET    | `/admin/actions`                                  | Append-only audit log.                                                                                                                                                                                                      |

## Ability

Required on every session — a number or a plain word about the workout, never
about a body, never rated by other members.

| Activity         | `ability`                                                                     |
| ---------------- | ----------------------------------------------------------------------------- |
| `run`            | `{ kind: "run", paceMinSec, paceMaxSec, miles }`                              |
| `ride`           | `{ kind: "ride", mphMin, mphMax, miles, surface: "road" \| "gravel" }`        |
| `strength` (Gym) | `{ kind: "gym", experience: "new" \| "regular" \| "advanced", focus }`        |
| `hike`           | `{ kind: "hike", miles, gainFt, difficulty: "easy" \| "moderate" \| "hard" }` |
| `walk`           | `{ kind: "walk", effort: "easy" \| "brisk", miles }`                          |
| `mobility`       | `{ kind: "open" }`                                                            |

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

## Private Apple Health import

The authenticated `/health/connection`, `/health/sync`, `/health/workouts`,
`/health/workouts/:id`, and `/health/export` endpoints store owner-only source
records. They are available only when `HEALTH_SYNC_ENABLED=true`; agent
delegation tokens cannot access them. See [Apple Health](./APPLE-HEALTH.md) for
methods, contracts, pagination, consent, deletion, and native setup. Private
exercise records do not change attendance, training-block progress, or fees.

Private manual logs, AI consent, exercise drafts, imported-workout corrections,
saved note interpretation and fitness export use `/fitness/*`, independently of
the Health import rollout flag. Manual logging does not require inference.
Inference requires separate member consent, `JEV_ENABLED=true` and a server-side
TypeSafe credential. See [fitness contracts and behavior](JEV-FITNESS.md) and
`shared/fitness.ts`; optional pilot endpoints are listed below.

## Settlement

Both check in → `completed`. Nothing is charged.

After the window closes (`start + 25 min`), `settleDue` resolves the rest, the
same way for poster and joiner: whoever didn't come gets a **$10 fee and a
strike**; whoever did gets **$5 of membership credit**. Nobody came → `void`, no
fee (no one was stood up). An unanswered request → `declined`. Two strikes in 60
days pause posting and joining **public** sessions for 14 days; invites from
people you know still work. Fees carry `chargeable_at` = 24h after the session,
the dispute window. Settlement runs on `GET /bookings` and the ten-minute
`/api/cron/settle` sweep. Host attendance and settlement are tracked once per
session, including when another participant joins after the host arrives.

## Standing slots

`POST /bookings/:id/repeat` on a completed booking creates a series of the people
who showed up and puts next week's occurrence on the calendar — same place, level
and wall-clock time (DST-safe) — with every regular already confirmed. Each
occurrence is a normal session. When one finishes, the next is created and the
streak moves (everyone checked in → +1, otherwise 0). A regular who cancels an
occurrence keeps their place; the open seat shows in discovery as
`substituteSeat`, and whoever takes it has `substituteFor` set and joins that
occurrence only.

## Verification

PRD v0.3 §8. Persona runs the checks and is the one that receives the phone
number, the selfie and the ID. SamePace stores which check it was, Persona's
inquiry id, and how it came out — never an image, a number or a document.

| Method | Path                             | Notes                                                                                                                                                                                                                                                 |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/verification`                  | `{ tier: "member" \| "government_id" }` → `{ id, tier, provider, url }`. Open `url` in a browser sheet. An open check is resumed, not started again. `409` when already verified, under human review, after three declines in 30 days, or not set up. |
| POST   | `/verification/:id/refresh`      | Back from the sheet: the server re-reads the inquiry rather than wait on the webhook. Returns `me.verification`.                                                                                                                                      |
| POST   | `/verification/:id/dev-complete` | `{ outcome }`. The stand-in's whole flow. `404` in production and wherever Persona is configured.                                                                                                                                                     |
| POST   | `/api/webhooks/persona`          | Not under `/api/v1`. No session: authenticated by `Persona-Signature` (HMAC-SHA256 of `t.body`, five-minute window, one or two secrets). `401` otherwise.                                                                                             |

`GET /me` carries `verification: { available, enforced, provider, member,
governmentId, idRequired }`; each tier is `none`, `pending`, `needs_review`,
`approved` or `declined`. `Person.identityVerified` is what other members see.

- **`member`** — a phone number and selfie liveness. Needed to post or join
  anything **public** (sessions and training blocks).
- **`government_id`** — needed for **women-only**, and for anything public once a
  report about the member has been acted on (`idRequired`). For women-only it
  makes a member accountable; it is not a test of who is a woman, which stays
  what the member says.
- **An invite from someone you know takes nothing**, the way a freeze doesn't
  reach it.
- A refusal is `403` with `code: "verify_member"` or `"verify_government_id"`:
  send the member to verify, don't show it as an error.
- **Nothing is enforced until `VERIFICATION_ENFORCED=1`.** Switching it on before
  members can verify would lock everyone out.
- A webhook can only move a check we created, for the member we created it for,
  once per event id. A stray late event can't undo a decision; a reviewer's later
  decline can, and clears the badge.
- Deleting an account atomically queues Persona redaction before removing local checks and badges. Leased retries retain the provider reference until deletion is confirmed; missing credentials or provider failures do not discard the obligation. Timestamp-ordered webhooks cannot revive deleted members or superseded checks.
- New accountless checks use a versioned local binding from inquiry ID to member,
  tier, template and environment. A provider reference may be absent on these
  checks only; a supplied mismatch, unknown/old inquiry, wrong template,
  mismatched/unknown environment, or any Account relationship is rejected.
  Dynamic Flow `inquiry-template` and explicit null `account` relationships must
  be retained in webhook payloads. Legacy rows keep strict reference matching.
- Creation intent and idempotency data are committed before the provider call.
  Lost responses survive account deletion without retaining a member identifier
  in the replay body. Unknown creates older than 23 hours and unexpected Accounts
  remain operator review obligations. Unknown-environment legacy deletion jobs
  stay pending rather than being discarded on a wrong-environment `404`.

**Setting it up.** In Persona: two inquiry templates — phone + selfie, and
government ID + selfie — each with a workflow that approves or declines the
inquiry; a webhook to `https://samepace.app/api/webhooks/persona` for the
`inquiry.*` events; `https://samepace.app/verified` allowed as a redirect. On
Vercel: `PERSONA_API_KEY`, `PERSONA_TEMPLATE_MEMBER`,
`PERSONA_TEMPLATE_GOVERNMENT_ID`, `PERSONA_WEBHOOK_SECRET` (comma-separate two
while rotating), then `VERIFICATION_ENFORCED=1` once members have had time to
verify. With no key, outside production, a `dev` provider stands in.

Sandbox Persona keys are refused in production, including signed webhook
updates and refreshes: simulated results cannot award a production badge. An
explicit `VERCEL_ENV=preview` permits a sandbox key even though Vercel sets
`NODE_ENV=production` for preview builds. Without that explicit preview setting,
`NODE_ENV=production` refuses sandbox keys; `VERCEL_ENV=production` always does.
Production requires Persona's documented `persona_production_` key prefix;
placeholder or unrecognized keys cannot enable signed webhook writes either.
Use a separate preview database and webhook secret. The development approval
endpoint remains disabled in all production builds, including previews. Missing
or rejected provider configuration preserves queued redaction obligations.
See [Persona setup and acceptance](PERSONA.md) before enabling enforcement.

**Background checks are not built.** The `background` tier is reserved in the
schema and nothing starts one. In the US a criminal-record check is a consumer
report under the FCRA: it takes a standalone disclosure and written
authorisation, written criteria for what disqualifies someone, and a pre-adverse
and adverse-action process with a copy of the report before anyone is turned
away. That is a legal and policy decision before it is an integration, and the
PRD leaves it out of v1.

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
  - _Kept_: I checked in, by fence or code — even if my buddy didn't show.
  - _Planned_: every occurrence since I joined whose check-in window has closed. A
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

- **Goal credits.** For the 7 days after the goal date a member who finished can
  say "helped me stick to it" about anyone they shared 3 or more check-ins with in
  the block — regulars and substitutes alike, finished or not. One answer per
  finisher per block; `block.ending.creditable` is who they may name. A profile
  shows counts only: `blocksFinished` and `helpedCount`, the number of _distinct_
  people who have said it, so a pair repeating blocks adds one. Credits never feed
  ranking. The receiver gets a push that doesn't say who. A credit is taken back,
  silently, when the giver blocks the receiver or a report the giver made about
  them is acted on. After 7 days the block is `ended` (`goal_date`).
- **The slots afterwards.** They stop at the goal date. For 14 days any member can
  keep them (`keep_slots`: they go back to being plain standing slots, next week
  on the calendar) or start the next block (`next_block`: same people, same slots
  and streaks, a new goal and date). After that they end. `block.ending`
  (`creditsOpen`, `creditable`, `slotsUndecided`) says what is still open to me.
- A session records which block it belonged to (`sessions.training_block_id`), so
  a block's history stays put when its slots move on.

## Words

Titles, details and event names go through one whole-word list (PRD v0.3 §8):
tinder, swipe, spark, crush, single, cute, chemistry, vibe. The PRD's "match" and
"date" are left off on purpose — "match my pace" and "race date" are what people
write here, and the `date_framing` report covers the other meaning.
"Singletrack" passes; "single-leg" and "single-arm" are let through.
A hit is a `400` naming the word. The list is `BANNED_WORDS` in `rules.ts`.

## Billing, optional measurement, and planning additions

All routes below use the signed-in member's session. Delegated A2A credentials cannot use them. JSON inputs are bounded; browser return URLs never prove payment or identity verification.

| Route                                          | Body / result                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /billing`                                 | Owner's `BillingSummary`, including disabled/unconfigured state, membership, credits and fees.                                                                                       |
| `POST /billing/refresh`                        | `{}` → `BillingSummary`, with throttled owner-only provider reconciliation after a hosted return. It creates no payment.                                                             |
| `POST /billing/membership/checkout`            | `{requestId, termsHash}` → `{url}` for hosted Stripe Checkout.                                                                                                                       |
| `POST /billing/fees/:id/checkout`              | Same input, only an owned, chargeable ledger fee; amount comes from the ledger.                                                                                                      |
| `POST /billing/portal`                         | `{requestId}` → `{url}` for existing membership/payment management.                                                                                                                  |
| `POST /billing/fees/:id/dispute`               | `{reason}` → updated `BillingSummary`. Remains available when collection is disabled or the member is suspended.                                                                     |
| `GET /admin/billing/disputes`                  | Admin only, `{disputes}`.                                                                                                                                                            |
| `POST /admin/billing/disputes/:id/resolve`     | Admin only, `{resolution: "waive" \| "uphold", note}` → `{disputes}`. A paid-fee waiver queues a refund.                                                                             |
| `GET /fitness/pilot-consent`                   | `{consent}` for the separate, optional feedback pilot.                                                                                                                               |
| `PUT /fitness/pilot-consent`                   | `{enabled}` → `{consent}`. Enabling requires current AI consent; revoking purges measurements.                                                                                       |
| `POST /fitness/logging-sessions`               | `{}` → `{measurement: {id, expiresAt} \| null}`. Server timestamps; expires in two hours.                                                                                            |
| `GET /fitness/logging-sessions/:id`            | Owner-only `{outcome}`.                                                                                                                                                              |
| `POST /fitness/logging-sessions/:id/feedback`  | `{helpfulness: "helpful" \| "neutral" \| "not_helpful" \| "unknown", timeSaved: "yes" \| "no" \| "unsure"}` → `{outcome}`.                                                           |
| `GET /agents/discovery`                        | `{discovery}` with at most five compatible opted-in members. No raw preferences, schedules or health data.                                                                           |
| `PUT /agents/discovery`                        | `{enabled:false}` or `{enabled:true, preferenceRevision}` → `{discovery}`. Seven-day consent; preference edits pause it.                                                             |
| `POST /agents/discovery/invitations`           | `{memberId, preferenceRevision}` → `{negotiation}`. Recipient has not consented; first-time rooms have `bookingId:null`.                                                             |
| `GET /agents/negotiations/:id/coordination`    | `{coordination}`: permissions, latest durable run and bounded step history.                                                                                                          |
| `PUT /agents/negotiations/:id/coordination`    | `{enabled:false}` or `{enabled:true, preferenceRevision, expectedRevision}` → `{coordination}`. Permission expires after 24 hours.                                                   |
| `DELETE /agents/negotiations/:id/coordination` | Revoke permission → `{coordination}`.                                                                                                                                                |
| `POST /agents/negotiations/:id/coordinate`     | `{requestId, expectedRevision}` → `{coordination}`; at most three steps, ten-minute deadline, four runs/day/conversation. Human confirmations and booking approvals remain separate. |

`POST /fitness/draft` may include `loggingSessionId`. A returned draft may carry `measurement:{sessionId,draftId}`; a subsequent log save can link that receipt. Exact suggested-field comparisons and elapsed time are computed on the server; the client cannot submit accuracy or duration totals. Manual saves still work without measurements. Fitness exports include pilot consent and paginated `pilot_outcome` records. Retention is 30 days, with member and per-group minimums of five for admin aggregates.

`POST /reports` also accepts `negotiationId` instead of session/booking context. Either participant may report an invitation before acceptance or after blocking; outsiders cannot use its ID. Human negotiation responses may include `memberNames` so recipients can recognize the sender. Added names are excluded from delegated-agent responses.

Discovery compares a bounded pool of 30 candidates, rotated hourly. Both members must be currently opted in with fresh preferences. Invitation quotas, a seven-day pair cooldown, bilateral blocks, suspension and deletion are checked again while holding ordered profile locks. Turning discovery off cancels unanswered invitations and retains independently joined conversations.

`POST /api/webhooks/stripe` verifies the raw-body signature, persists event identifiers and reconciles current provider state. `POST /api/webhooks/persona` verifies signatures, rejects stale status events and cannot restore a deleted member. Scheduled settlement also recovers interrupted agent runs, retries provider deletion/refunds, and prunes measurements. See [billing configuration](BILLING.md) and [app links](APP-LINKS.md).

## Provider activation and later work

- **Stripe activation.** Hosted membership ($12/month after two completed sessions), explicit fee checkout, disputes, refunds and deletion retries are implemented. The isolated Preview has test credentials, a price, a restricted portal and signed webhooks. Hosted test payment, membership activation, portal cancellation and account/provider cleanup passed. Production collection and enforcement remain off; 3DS, failure/recovery cases, physical-device returns and the launch cluster-density gate remain pending. Existing commitments can still be attended or cancelled; new recurrence waits if enforcement is enabled and membership is missing. See [billing setup and acceptance](BILLING.md).
- **Persona activation.** Shared templates, Sandbox workflows, an inquiry-only API key and a filtered Preview webhook are configured. Actual signed Sandbox lifecycle events passed both template bindings and member review/decline/approval, with the government-ID completion simulation triggering workflow approval. Account deletion and both inquiry redactions passed. Phone/selfie/ID checks, hosted returns, approval revocation, duplicate/out-of-order events and Case retention remain pending. Production application credentials remain unconfigured and enforcement stays off. See [Persona setup and acceptance](PERSONA.md).
- Gym sessions matched on `gym_id`, `route_url` in the app.
- Background checks — see _Verification_ for scope.

## Local dev

`npm run dev` with no `DATABASE_URL` runs an in-memory Postgres (PGLite): data
resets on restart, and a demo cluster of members and sessions is seeded on the
first API call. Set `DATABASE_URL` for a real Postgres — `npm run db:migrate`
applies `migrations/*.sql`, and no demo data is ever written there.
