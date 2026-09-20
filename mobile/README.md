# SamePace — mobile

React Native (Expo SDK 57, expo-router) client for the SamePace API in the repo root, built to PRD v0.3
(membership: nobody pays anybody; levels, no-show fees, standing slots).
See `../docs/API.md` for the contract.

## Run it

Start the API first (repo root) on port 8088 — `.claude/launch.json` does that;
`npm run dev` alone binds 8080, which is often taken locally. By hand:
`node scripts/with-app-env.mjs node_modules/.bin/vite dev --host 0.0.0.0 --port 8088`.

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

Set up on 2026-09-20 (all public identifiers — no secrets in this flow):

| Where | What |
| --- | --- |
| Apple Developer (team `NZBE9W77FA`) | App ID `app.samepace`, *Sign in with Apple* enabled |
| Google Cloud project `samepace-509220` | OAuth clients "SamePace server (web)" and "SamePace iOS" (bundle `app.samepace`) |
| Vercel env | `APPLE_BUNDLE_ID`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID` |
| `eas.json` env | `GOOGLE_IOS_URL_SCHEME` (the iOS client id, reversed) |

Still to do: an **Android** OAuth client (package `app.samepace` + the signing
SHA-1 from the first EAS Android build), and moving the Google OAuth app from
*Testing* to *In production* — until then only listed test users can sign in
with Google.

The app has no password form. The server still accepts passwords outside
production, which is what the simulator token below relies on.

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

## Push notifications

`expo-notifications`, delivered through Expo's push service — the server queues
and sends (see *Notifications* in `docs/API.md`); `src/lib/push.ts` registers the
device and opens the screen a tapped notification points at. The app asks in its
own words first (Today, once there's a session coming up), then the system prompt.
Settings live under You → Notifications; Inbox → Activity lists everything sent,
push or not.

Push needs a build that contains the native module, and a real phone — simulators
and Expo Go can't get a token, and there the app simply reports "not available".
iOS needs an APNs key (EAS creates it during the first device build); Android needs
a Firebase project's `google-services.json` and its FCM v1 service-account key
uploaded to EAS.

## Widget, Live Activity, haptics, motion

- **Widget** (`src/widgets/next-session.tsx`, iOS): my next session on the Home
  Screen (small, medium) and Lock Screen. `src/lib/widgets.ts` writes a *timeline*
  from `/bookings`, so it moves on to the following session — or "nothing booked" —
  by itself. Tapping opens the session.
- **Live Activity** (`src/widgets/live-session.tsx`): Lock Screen banner and
  Dynamic Island while a seat is inside its check-in window — countdown, and who
  has checked in. It starts and updates while the app is open; updating it from the
  server with the app closed needs ActivityKit push tokens, which isn't built.
- Both are `expo-widgets`: the `'widget'` functions run inside the extension and can
  only see their props. They need a new native build, and the App Group
  `group.app.samepace` (EAS registers it during a device build). Android home-screen
  widgets aren't available through `expo-widgets` yet.
- **Haptics** (`src/lib/haptics.ts`) are named by meaning; mutations declare
  `meta: { haptic }` and the query client plays success / warning, and an error buzz
  for any refusal. **Motion** lives in `src/components/motion.tsx` (press scale, list
  entrance, skeletons, the check-in success mark) and
  `src/components/animated-splash.tsx` (launch). All of it honours Reduce Motion.

## Not done

Membership billing and fee collection (the server only keeps a ledger), training
blocks, gym matching, a map, phone verification, fee disputes. Invite links open
`https://samepace.app/invite/<code>`, which hands off to the app; universal links
(no hand-off page) still need the associated-domains files.
