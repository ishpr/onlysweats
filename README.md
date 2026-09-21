# SamePace

A workout buddy who shows up. A member posts the workout they're doing anyway — a run, a ride, a gym session, a hike — with a time, a public place and a level. Someone at that level joins. SamePace confirms both people reached the pin.

("pace" stays the shorthand in code and paths; the product name is SamePace.)

## Product (PRD v0.3 — membership)

- **Nobody pays anybody.** No prices, holds or payouts. What costs money is not showing up: $5 for cancelling inside 12 hours (waived if a substitute takes the seat), $10 and a strike for a no-show, $5 of membership credit to whoever did show. The rules are the same for the poster and the joiner. Two strikes in 60 days pause public sessions for 14 days.
- **Level is required.** Every session carries an ability — a pace range, a speed range, gym experience, hike difficulty. Members set their own level per activity and see what fits.
- **Check-in.** Both people inside 150 m of the pin, 20 minutes before to 25 minutes after the start, or a four-digit code where GPS is weak.
- **Standing slots.** "Same time next week" turns a completed session into a weekly slot with a streak. A regular who skips a week opens a substitute seat and keeps their place.
- **Training blocks.** "Give it a finish line" aims one to four standing slots at a goal and a date, 4 to 20 weeks out — a marathon, a first 10k, twelve weeks of showing up. Progress is the sessions you kept out of the ones you had, counted from check-ins and seen only by you. When a block ends, the people who finished can say who helped them stick to it; a profile shows that as a count. No stars, no weight goal, and nothing about the workout is logged.
- **Push.** Seat and approval notices, reminders an hour out and when check-in opens, next week's occurrence, and substitute offers when a regular skips. Each kind can be switched off; safety and account notices always send.
- **Sessions, not faces.** No people search, no member directory, no "about me", no photos on session cards. Chat is scoped to a booking and closes a day after the session. Women-only sessions are enforced by the server.
- **Reputation.** Five yes/no answers after a completed session: showed up, on time, matched the listing, respectful, would join again. A track record is counts and rates the server worked out — never stars, never free text.
- **Safety and account.** Block, report (including "made it feel like a date"), suspension, in-app account deletion and an admin queue.

The v0.3 PRD is the spec: <https://claude.ai/code/artifact/dc7b8843-caec-496b-9bf5-ff4eef41a0af>. It supersedes `docs/Pace-PRD-v0.2-canonical.docx` wherever the two conflict; the docx is kept for what v0.3 leaves unsaid. `docs/API.md` is the source of truth for what is built, including the "Not built yet" list (charging, gym matching, verification, fee disputes). The training blocks spec is <https://claude.ai/code/artifact/76e347f2-9733-4129-afa6-a68188345d09>.

## Layout

| Path | What it is |
| --- | --- |
| `mobile/` | The app: React Native (Expo, expo-router), iOS and Android from one codebase. See `mobile/README.md`. |
| `src/routes/api/v1/$.ts` | The JSON API the app talks to, at `/api/v1`. Contract in `docs/API.md`. |
| `src/lib/pace/` | The product's behaviour: `rules.ts` (pure, tested), `service.server.ts` (SQL + transactions), `safety.server.ts` (block, report, delete, admin), `notify.server.ts` (the push outbox and delivery), `training-blocks.server.ts` (blocks, joining, goal credits), `http.server.ts` (routing), `types.ts`. |
| `src/routes/api/auth/$.ts` | Better Auth at `/api/auth/*`: Sign in with Apple and Google, bearer tokens. Email and password is a development convenience. |
| `src/routes/api/cron/settle.ts` | Every 10 minutes: settles overdue no-shows, closes training blocks past their goal date, sends reminders and whatever push is owed. |
| `migrations/` | Postgres schema. `npm run db:migrate` applies it. |
| `src/routes/` (public site) | `/`, `/privacy`, `/terms`, `/support`, `/invite/:code` (hands an invite code to the app) and `/admin` (the safety queue, `ADMIN_EMAILS` only). |
| `src/routes/prototype.tsx` and the `sessions`, `live`, `inbox`, `post`, `you`, `health` routes | The original web prototype, kept at `/prototype` as a **visual reference only**. It runs on seeded client state and still models the retired paid-seat product. New behaviour goes in the API, never in its store. |

The server decides seats, check-in and fees. The clients only display and ask.

## Stack

- API and site: TanStack Start (React 19), Tailwind v4, Better Auth, Postgres — PGLite in memory for local development
- App: Expo, expo-router, TanStack Query
- Hosting: Vercel + Neon; production is <https://samepace.app>

## Run it

```bash
npm install
```

The app defaults to the API on port **8080**. Start it with:

```bash
npm run dev
```

If you use another port, set the mobile app's `EXPO_PUBLIC_API_URL` to that server. With no `DATABASE_URL` the API runs an in-memory Postgres that resets on restart and seeds a demo cluster on the first call. Set `DATABASE_URL` for a real Postgres; demo data is never written there.

```bash
npm test
```

```bash
npm run typecheck
```

Then start the app from `mobile/` — see `mobile/README.md`.

## Cluster

Dallas first: Oak Lawn and the Katy Trail, then White Rock Lake, Trinity Forest and Turtle Creek. One activity per cluster at launch, running first; the code supports every activity from the start.
