# Pace

Working name: **Pace**. A workout-buddy app for the session you’re already doing — a run, a ride, a gym session, a hike, a marathon training block.

A host posts a session — time, trail or park, seats, price. Others book a seat. Money + geofence make flaking expensive. Discovery is upcoming sessions, not faces.

This is the working web prototype (TanStack Start + React). Dallas / Oak Lawn cluster, seeded with live check-in, bookings, Health rings, and Siri-style intelligence.

## Product (v0.2)

- **Today** — activity rings, recovery-aware suggestion, next 48 hours
- **Sessions** — venue-first discovery, women-only filter, hold a seat
- **Live** — 150m geofence check-in window, 4-digit code fallback
- **Inbox** — booking-scoped threads
- **You / Health** — reputation binaries, Apple Health-style vitals
- **Post** — “you’re going anyway, open two seats”
- **Invite** — unlisted link for someone you already know

Locked model: host posts the run they were already doing. Money is hold-then-capture on dual check-in. Five yes/no ratings (showed up, on time, matched listing, respectful, would join again). No swipe, no dating copy.

See `docs/Pace-PRD-v0.2-canonical.docx` for the full spec.

## Stack

- React 19 + TanStack Start / Router
- Tailwind v4, Zustand
- Seeded client state (no accounts in this prototype)

## Scripts

```bash
npm install
npm run dev
```

Dev server binds `0.0.0.0:8080`. Production build:

```bash
npm run build
npm run typecheck
```

## Cluster

Dallas. Parks and trails first (Katy Trail, White Rock Lake, Trinity Forest, Turtle Creek). Gym lobbies only with host venue attest.
