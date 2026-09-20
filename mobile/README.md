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

## Sign-in

Sign in with Apple and Google only — no passwords. The OS / Google SDK hands the
app an identity token, the server verifies it (`/api/auth/sign-in/social`), and
the session token goes in the keychain. `GET /api/v1/auth-config` tells the app
which buttons to draw.

Both need a **development build**, not Expo Go (Expo Go has neither native
module, so the buttons hide themselves there):

```bash
npx eas build --profile development --platform ios
```

Then `npx expo start` opens the dev build; `npx expo start --go` still opens Expo Go.

What has to exist first (all public identifiers, no secrets):

| Where | What |
| --- | --- |
| Apple Developer | App ID `app.samepace` with the *Sign in with Apple* capability |
| Google Cloud | OAuth client ids: one **Web application**, one **iOS** (bundle `app.samepace`), one **Android** (package `app.samepace` + the signing SHA-1) |
| Server env | `APPLE_BUNDLE_ID`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID` |
| Build env | `GOOGLE_IOS_URL_SCHEME` = the iOS client id reversed (`com.googleusercontent.apps.…`) |

The email form is a development convenience: the server offers it outside
production, and in production only until a provider is configured.

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
