# SamePace — mobile

React Native (Expo SDK 57, expo-router) client for the SamePace API in the repo root, built to PRD v0.3
(membership: nobody pays anybody; levels, no-show fees, standing slots).
See `../docs/API.md` for the contract.

## Run it

Start the API first (repo root): `npm run dev` — serves `/api/v1` on port 8088
(`.claude/launch.json`; 8080 is often taken locally).

```bash
npm install
npx expo start --ios --android
```

The app finds the API at the same host Metro is served from, on port 8088, so
simulators, emulators and phones on the LAN all work. Override with
`EXPO_PUBLIC_API_URL`.

### Skipping sign-in in a simulator

Put a session token in the gitignored `.env.local` and dev builds sign in with it:

```bash
EXPO_PUBLIC_DEV_TOKEN=<value of the set-auth-token header from POST /api/auth/sign-in/email>
```

Ignored outside `__DEV__`. The dev database is in-memory, so the token dies when
the API restarts — mint a new one.

## Layout

- `src/app` — routes. `(tabs)` = Today · Sessions · Inbox · You; stack screens for
  a listing, a thread, the live check-in, posting, and invite links.
- `src/lib` — `api.ts` (fetch + bearer token), `auth.tsx` (keychain session),
  `queries.ts` (every server call), `format.ts` (Dallas-time + money).
- `src/components/ui.tsx` — primitives. `src/constants/theme.ts` — tokens, the same
  values as the web's `src/styles.css`. Dark-only, like the web.

The server decides seats, money and check-in. The app only displays and asks.

## Not done

Membership billing and fee collection (the server only keeps a ledger), push
notifications and substitute offers, training blocks, gym matching, a map, Sign in
with Apple / phone verification, report/block. Invite links are app deep links
until there is a domain for universal links. The bundle id `app.samepace` assumes
the samepace.app domain — confirm it before the first store build.
