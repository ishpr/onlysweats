# SamePace PRD v0.4 — Your agent finds your partner

**Status:** draft for the owner's approval. Supersedes v0.3 on the *surface* of the product; keeps
v0.3's engine (sessions, check-in, fees, strikes, weekly slots, goals, reputation) unchanged.

## The promise, in one sentence

**A partner at your level who keeps you accountable until you reach your goal — found and
arranged for you by your own agent.**

## How it works

Every member has an agent. It works for one person only.

1. **You tell your agent what you're working toward** — in a conversation, by typing or by
   voice. A race, a habit, a number, a date. What you do, at what level, when you're free.
2. **Your agent talks to other members' agents.** It finds people at your level, nearby, who
   want the same thing at the same times. Agents exchange only what their owners allowed:
   first name, level, activity, times, places. Never health data, never chat history.
3. **Your agent talks to you.** It brings you one person at a time — "Maya, 9:30 pace, wants a
   10K in November, free Tuesday and Thursday mornings" — and asks. You say yes or no.
4. **The two agents agree the details; the two people approve.** Time, meeting point, weekly
   until the goal date. Nothing is booked until both owners tap Approve.
5. **You show up.** Both check in at the meeting point. Missing it costs money and a strike, and
   your partner sees it. That's the accountability.
6. **Your agent keeps score and keeps you going.** Sessions kept out of sessions planned. When
   the goal date comes: "You kept 14 of 16. Same partner for the next one?"

## The surface

**The app is the conversation.** Opening it opens your agent's chat. There is no dashboard.

- The agent speaks first. New member: "What are you working toward?" with three chips.
- Everything the app can do is a **card in the thread with one button**: a person to meet, a
  plan to approve, a session to check in to, progress, "again next week?". You never navigate
  to a form to act.
- You can type anything. "I can't make Thursday." "Find me someone faster." "How am I doing?"
- The mic in the composer is the same conversation, spoken.
- **Tabs: Chat · Sessions · You.** Sessions is what's booked and your record. You is your goal,
  partner, level and settings. Everything else in the app today is reachable by asking the
  agent, or lives behind You. Nothing is removed.

## What your agent may do on its own, and what it may not

| On its own | Only when you tap |
| --- | --- |
| Look for people, talk to their agents, work out times that fit both | Ask a specific person |
| Draft the plan, the weekly schedule, the meeting point | Approve a plan, accept booking terms |
| Remind you, nudge you, keep score | Join, leave, cancel, pay |
| Answer questions about your sessions and record | Change what it shares about you |

A spoken "yes" never approves anything. Every consequential step is a tap on a card.

## Rules that carry over from v0.3, unchanged

- Sessions, not faces. No browsing people. The agent introduces one person at a time, and only
  after both agents' owners opted in. Cards show first name, level, record — never photos.
- Level is required. Check-in inside 150 m, or a 4-digit code. $5 late cancel, $10 no-show and
  a strike; two strikes pause public sessions. Women-only enforced by the server.
- Reputation is counts (showed up, on time, would join again), never stars.
- Block, report ("made it feel like a date"), suspension, deletion, admin queue.

## What is demoted (kept, but not on the path)

Apple Health import and Today's read · Jev workout drafts · workout plans and offline logging ·
Watch recorder · fitness log · cloud coaching as a separate mode. All reachable from You or by
asking the agent. None of them sits between a member and a partner.

## What exists today, and what this needs

| Piece | State | Needed for v0.4 |
| --- | --- | --- |
| Sessions engine (v0.3) | Built, on main, deployed | Nothing |
| Agent-to-agent matching: discovery, proposals, coordination, dual approval, booking | Built (A2A), behind "Workout matching" on Chats | Surface it as cards in the chat |
| Conversation (cloud) | Built, **switched off** (`ASSISTANT_CHAT_ENABLED`, unfunded AI Gateway) | Fund + enable — owner |
| Chat tools that *act* (find, ask, approve, book, join, post, recap) | Not built; the chat can only navigate | Functional owner — the one real gap |
| Chat as the home surface, agent-first onboarding, cards for every action | Not built | Design owner |
| Voice in the composer | Not built (native speech module + build) | Functional + design |

## What we stop saying

"Post the workout you're doing anyway." "Coaching." "Workout matching." "Negotiation",
"revision", "consent", "provider", "TypeSafe", "pilot". The words are: your agent, your
partner, your goal, session, meeting point, show up.
