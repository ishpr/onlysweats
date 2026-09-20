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
  schema in `migrations/0002_pace.sql` and `0004_safety.sql`.
  ("pace" stays the code shorthand; the product name is SamePace.)

## Auth

Better Auth at `/api/auth/*`, email + password for now.

```
POST /api/auth/sign-up/email   { name, email, password }
POST /api/auth/sign-in/email   { email, password }
POST /api/auth/sign-out
```

Both sign-up and sign-in answer with a `set-auth-token` response header. Store it
in the device keychain and send it on every call:

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
| GET | `/invites/:code` | Resolve an unlisted invite link. |
| GET | `/bookings` | Everything I posted or joined: `{ bookings, sessions, series, people }`. Settles overdue no-shows first. |
| GET | `/bookings/:id` | |
| POST | `/bookings/:id/approve` · `/decline` | Poster only. |
| POST | `/bookings/:id/cancel` | Joiner. Also "skip this week" on a standing slot. 12h+: free. Inside 12h: `late_cancel`, $5 — waived (`covered`) if someone takes the seat. |
| POST | `/bookings/:id/checkin` | `{ lat, lng, accuracyM? }`. Server measures the 150 m fence. |
| POST | `/bookings/:id/checkin-code` | `{ code }`. Joiner types the poster's code; checks in both. |
| POST | `/bookings/:id/repeat` | "Same time next week": a completed session becomes a standing slot. |
| GET | `/series` | My standing slots: members, streak, next occurrence. |
| POST | `/series/:id/leave` | Leave a standing slot. Fewer than two regulars ends it. |
| GET/POST | `/bookings/:id/messages` | Booking-scoped chat. Opens on join, closes 24h after the session. |
| POST | `/bookings/:id/rating` | Five booleans, once per side, after completion. `matchedListing` includes "level was as stated". |
| DELETE | `/me` | Delete my account, now. See *Safety and account*. |
| GET | `/blocks` | Members I blocked: `{ people }`. Being blocked is never visible. |
| POST | `/blocks` | `{ memberId }`. Idempotent. |
| DELETE | `/blocks/:id` | Unblock. |
| POST | `/reports` | `{ reportedId, reason, detail?, sessionId? \| bookingId?, alsoBlock? }` → `{ id, blocked }`. |

`GET /me` also carries `suspended: { reason } \| null` and `isAdmin`.

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

## Not built yet (PRD v0.3)

- **Charging.** Membership ($12/mo after two completed sessions, once a cluster
  passes its density gate), card on file, and actually collecting fees. The
  ledger records what is owed; nothing is charged.
- **Substitute offers by push**, ranked by reliability — today a substitute finds
  the seat in discovery. Push notifications in general.
- **Training blocks**, gym sessions matched on `gym_id`, `route_url` in the app.
- **Verification** (phone, selfie liveness, ID for women-only) and fee disputes.
- **Apple token revocation on delete.** Apple asks apps using Sign in with Apple
  to revoke the user's token when the account is deleted; that needs a Sign in
  with Apple key on the server.

## Local dev

`npm run dev` with no `DATABASE_URL` runs an in-memory Postgres (PGLite): data
resets on restart, and a demo cluster of members and sessions is seeded on the
first API call. Set `DATABASE_URL` for a real Postgres — `npm run db:migrate`
applies `migrations/*.sql`, and no demo data is ever written there.
