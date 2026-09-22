# SamePace PRD v0.4 — Your agent finds your partner

**Status:** draft for the owner's approval. Supersedes v0.3 on the *surface* and re-opens one
v0.3 decision (money between members). Keeps the v0.3 engine — sessions, check-in, fees, strikes,
weekly slots, goals, reputation — unchanged.

## The promise, in one sentence

**A partner at your level who keeps you accountable until you reach your goal — found and
arranged for you, discreetly, by your own agent.**

## The four pillars (all in scope)

1. **Find a partner.** A buddy at your level, or a mentor who's further along.
2. **Track your health.** Apple Health sync gives your agent — and only your agent — where
   you actually are.
3. **Follow a plan.** Workout plans you tick off: sets, reps, time, distance. Progress toward
   the goal is what you kept out of what you planned.
4. **A marketplace for personal fitness.** Like DoorDash for food: you say what you want, the
   right person nearby is matched, it's delivered in person, you rate it, they're paid.

The agent is the spine that runs all four. Without it they are four products.

## How it works

Every member has an agent. It works for one person only, and it is discreet: nobody browses
anybody. Introductions happen because two agents agreed their owners fit.

1. **You tell your agent what you're working toward** — typing or voice. A race, a habit, a
   number, a date; what you do, at what level, when you're free, and whether you want a buddy
   or a mentor.
2. **Your agent talks to other members' agents.** It shares only what you allowed: first name,
   level, activity, times, places, and — for mentors — their record and rate. Never health
   data, never chat history.
3. **Your agent talks to you.** One person at a time: "Maya, 9:30 pace, wants a 10K in
   November, free Tuesday and Thursday mornings." Or: "Dev has coached 40 first-10Ks, $30 an
   hour at your gym." You say yes or no.
4. **You describe, it creates.** "Post a run Tuesday 6 AM at Katy Trail, two spots" becomes a
   session card others' agents can bring to them. "Set me a 10K for November" becomes a goal.
   "Make me an 8-week plan" becomes a plan you tick off. It fills in what you said, asks for
   what's missing, shows the card. The button is yours.
5. **The two agents coordinate; the two people approve.** Time, meeting point, weekly until the
   goal date. The agents handle the back-and-forth so the people don't have to message. Nothing
   is booked until both owners tap Approve.
6. **You show up.** Both check in at the meeting point. Missing it costs money and a strike, and
   your partner sees it.
7. **Your agent keeps score and keeps you going.** Sessions kept, sets ticked, Health trend.
   At the goal date: "You kept 14 of 16. Same partner for the next one?"

## Money

- **Everyone pays a subscription.** $12 a month after two free sessions, once your area is busy
  enough (v0.3, unchanged). That's how the agent, matching and coordination are paid for.
- **Nobody pays a buddy.** Buddy sessions stay free between members. Fees are only for flaking.
- **Mentors can charge.** A mentor is a member further along who chooses to offer one-on-one
  sessions at a rate — by the hour, at a gym or park where both already have access. The
  mentee's agent books it; payment is held at booking and released on dual check-in; the mentor
  is paid out. SamePace takes a cut. **[Decision — owner]**
- **Tips.** After any session, "Send a thank-you" — optional, to a buddy or a mentor. **[Decision —
  owner]**
- Anyone who earns is verified (phone, face, government ID) before their first paid session.
  Background checks above a threshold, as v0.2 set out. Off-platform payment is a ban.

## The surface

**The app is the conversation.** Opening it opens your agent's chat. There is no dashboard.

- The agent speaks first. New member: "What are you working toward?" with three chips.
- Everything the app can do is a **card in the thread with one button**: a person to meet, a
  plan to approve, a session to post, a set to tick off, a check-in, progress, a tip, "again
  next week?". You never navigate to a form to act.
- You can type or say anything. "I can't make Thursday." "Find me someone faster." "Show me
  this week." "Post it." The agent handles it or shows a card.
- **Tabs: Chat · Sessions · You.** *Sessions* is what's booked, the plan you're on, your record.
  *You* is your goal, partner, level, Health, mentor profile (if you offer one), settings. Nothing
  is removed; everything is reachable by asking the agent or from You.

## What your agent may do on its own, and what it may not

| On its own | Only when you tap |
| --- | --- |
| Look for people, talk to their agents, work out times that fit both | Ask a specific person |
| Draft a plan, a schedule, a session, a goal — and show it as a card | Post it, approve it, book it |
| Coordinate the back-and-forth with the other agent | Accept booking terms, pay, tip |
| Read your Health and plan progress; remind, nudge, keep score | Change what it shares about you |

A spoken "yes" never approves anything. Every consequential step is a tap on a card.

## Rules that carry over from v0.3, unchanged

Sessions, not faces — no browsing people, ever; the agent introduces one at a time. Level is
required. Check-in inside 150 m or a 4-digit code. $5 late cancel, $10 no-show and a strike; two
strikes pause public sessions. Women-only enforced by the server. Reputation is counts, never
stars. Block, report ("made it feel like a date"), suspension, deletion, admin queue.

## What exists, and what this needs

| Piece | State | Needed |
| --- | --- | --- |
| Sessions engine, check-in, fees, weekly slots, goals, reputation | Built, deployed | — |
| Apple Health sync, Today's read, workouts | Built, deployed | Surface via the agent |
| Workout plans, runs, set-by-set logging, offline | Built, deployed | Surface via the agent |
| Agent-to-agent matching: discovery, proposals, coordination, dual approval, booking | Built (A2A), hidden behind "Workout matching" | Surface as cards in the chat |
| Conversation (cloud) | Built, **off**: `ASSISTANT_CHAT_ENABLED` + unfunded AI Gateway | Fund + enable — **owner** |
| Chat tools that *act*: find, ask, post, approve, book, plan, log, tip | **Not built**; the chat only navigates | **Functional (Codex)** — the core gap |
| Chat as Home, agent-first onboarding, cards for every action, voice | Not built | **Design** (+ native speech: functional) |
| Mentors: rate, hold-and-release payment, payout, cut, earner verification, tips | **Not built** (v0.3 removed member-to-member money; Stripe does membership and fees only) | **Owner decision, then functional** — Stripe Connect |

## What we stop saying

"Post the workout you're doing anyway." "Coaching." "Workout matching." "Negotiation",
"revision", "consent", "provider", "TypeSafe", "pilot". The words are: your agent, your partner,
your mentor, your goal, session, plan, meeting point, show up.
