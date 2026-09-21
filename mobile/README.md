# SamePace — mobile

React Native (Expo SDK 57, expo-router) client for the SamePace API in the repo root, built to PRD v0.3
(membership: nobody pays anybody; levels, no-show fees, standing slots).
See `../docs/API.md` for the contract.

## Run it

Start the API first (repo root): `npm run dev` — serves `/api/v1` on port 8080.

```bash
npm install
npx expo start --ios --android
```

The app finds the API at the same host Metro is served from, on port 8080, so
simulators, emulators and phones on the LAN all work. Override with
`EXPO_PUBLIC_API_URL` if you start the API on a different port (for example,
`EXPO_PUBLIC_API_URL=http://192.168.1.10:8088`).

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

For a physical iPhone, install [build 279cd6e8](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/279cd6e8-01eb-4f63-a1bd-2ca453555125), built with the `device-phone` profile. It includes native HealthKit import, local Apple intelligence and workout-plan generation, Shortcuts, widgets and export sharing, uses the live SamePace API, and preserves Expo live reload. It excludes the unprovisioned Watch app. Use `device` only when building the combined phone/Watch package with registered hardware and signing profiles. See [the release checklist](../docs/RELEASE-CHECKLIST.md).

Then `npx expo start` opens the dev build; `npx expo start --go` still opens Expo Go.

Set up on 2026-09-20 (all public identifiers — no secrets in this flow):

| Where                                  | What                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Apple Developer (team `NZBE9W77FA`)    | App ID `app.samepace`, _Sign in with Apple_ enabled                              |
| Google Cloud project `samepace-509220` | OAuth clients "SamePace server (web)" and "SamePace iOS" (bundle `app.samepace`) |
| Vercel env                             | `APPLE_BUNDLE_ID`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`                |
| `eas.json` env                         | `GOOGLE_IOS_URL_SCHEME` (the iOS client id, reversed)                            |

Still to do: an **Android** OAuth client (package `app.samepace` + the signing
SHA-1 from the first EAS Android build), and moving the Google OAuth app from
_Testing_ to _In production_ — until then only listed test users can sign in
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
  a listing, a thread, the live check-in, posting, invite links, and training
  blocks (`training-block/[id]` the block page, `training-block/new` the goal form).
- `src/lib` — `api.ts` (fetch + bearer token), `auth.tsx` (keychain session),
  `queries.ts` (every server call), `format.ts` (Dallas-time + money).
- `src/components/ui.tsx` — primitives. `src/constants/theme.ts` — light/dark
  tokens following the phone's appearance, including the launch screen.

The server decides seats, money and check-in. The app only displays and asks.

## Push notifications

`expo-notifications`, delivered through Expo's push service — the server queues
and sends (see _Notifications_ in `docs/API.md`); `src/lib/push.ts` registers the
device and opens the screen a tapped notification points at. The app asks in its
own words first (Today, once there's a session coming up), then the system prompt.
Settings live under You → Notifications; Inbox → Activity lists everything sent,
push or not.

The app refreshes registration on sign-in and whenever it returns to the foreground,
including after permission changes in Settings. Notification settings distinguish
permission from successful device registration and offer a retry when registration fails.

Push needs a build that contains the native module, and a real phone — simulators
and Expo Go can't get a token, and there the app simply reports "not available".
iOS needs an APNs key (EAS creates it during the first device build); Android needs
a Firebase project's `google-services.json` and its FCM v1 service-account key
uploaded to EAS.

## Widget, Live Activity, haptics, motion

- **Widget** (`src/widgets/next-session.tsx`, iOS): my next session on the Home
  Screen (small, medium) and Lock Screen. `src/lib/widgets.ts` writes a _timeline_
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

## Verification

`src/app/verify.tsx` says what is asked for and who sees it, then opens Persona's
hosted flow in a browser sheet (`expo-web-browser`, so no native module and it
works in Expo Go). Persona hands back through `https://samepace.app/verified` →
`samepace://verified`, and the app asks the server how it came out. A post or a
join refused with `code: "verify_member"` / `"verify_government_id"` goes to that
screen instead of showing an error (`lib/verify-gate.ts`). With no Persona key on
the server, the screen shows a development stand-in with Approve and Decline.
Persona's native SDK (`react-native-persona`) captures better and reads NFC; it
needs a development build, and is the upgrade if pass rates disappoint.

## Training blocks

One to four standing slots aimed at a goal and a date — see _Training blocks_ in
`../docs/API.md`. In the app:

- **Start one** from a standing slot ("Give it a finish line", on Today and the
  live screen) or from Post ("Training block"). `post.tsx` is one form with three
  jobs: a session, a block's first slot, or — with `blockId` — another weekly slot.
  The goal pickers are `components/goal-picker.tsx`.
- **Find and join** from the Training blocks row on Sessions, or from one of a
  block's sessions, which sends you to the block. Joining is every slot, every
  week, and sits behind a confirmation that says so — never a tap on one session.
- **The block page** shows my sessions kept out of planned (`progress-ring.tsx`)
  and the planned miles of the sessions I kept. Nobody sees another member's count.
- **When it ends**, `components/block-ending.tsx` asks a finisher who helped them
  stick to it, then what happens to the slots. Today pins a card until it's
  answered. A track record (`lib/reputation.ts`) gains blocks finished and people
  helped, as counts, only when above zero.

Training-block progress is attendance-based, with no weight goal. Optional private Apple Health imports are a separate feature and do not change that progress.

## Apple Health

You → Apple Health opens `/health`: Apple Health import, manual or explicitly enabled automatic foreground sync, private history, export, removal and disconnect. It requires the rebuilt iOS client and `HEALTH_SYNC_ENABLED=true` on the API. Actual iPhone permissions and source changes still require acceptance. The companion Watch recorder saves its own workouts with separate write permission.

See [the integration guide](../docs/APPLE-HEALTH.md) for supported data, privacy boundaries, and device checks. Android/web/Expo Go cannot read HealthKit. `/workout/[id]` preserves corrections separately from source facts. `/fitness` provides manual logs and separately consented editable Jev suggestions; the provider key stays on the server. `/assistant` shares only entered planning preferences through mutually consented conversations, with separate human booking approval. Raw health records are never shared with delegated agents.

## Private assistant

`/assistant` separates private on-device/cloud conversation from planning and approvals. Local photo/text drafts open the editable exercise log; nothing is automatically completed or saved. Cloud conversation and workout-summary sharing require separate consent, and provider keys remain server-side. A new native binary is required for local intelligence, Shortcuts, background HealthKit observation and Watch recording. See [intelligence architecture](../docs/INTELLIGENCE.md) and [physical acceptance](../docs/INTELLIGENCE-ACCEPTANCE.md).

`/workout-plans` contains reusable private routines and structured workout history. Manual entry, reviewed photo/text extraction and on-device AI can supply a plan with instructions and per-set targets. Hosts attach a fixed copy to a session; each buddy reviews that exact version, starts a private workout record and enters actual results. Progress sharing is optional and exposes counts only. See [shared workout plans](../docs/WORKOUT-PLANS.md).

## Remaining acceptance

See the maintained [vision roadmap](../docs/VISION-ROADMAP.md) for provider, physical-device, store and operating acceptance. Implemented payment, verification and link software must not be confused with live enforcement or completed device testing.
