# Agent-first audit — 21 September 2026

The owner's brief: the assistant is now the cornerstone of SamePace, yet "most screens
look like settings pages" and nothing reads as a clear screen. Three read-only reviews
ran over every route on `main` (navigation, screen-by-screen layout, the assistant flow
and its words). This is the synthesis and the plan. **Nothing is removed — features are
re-homed.** Paths are relative to `mobile/src/`.

## What is wrong, in five findings

1. **The assistant is a side route, not the spine.** It has no tab. It is absent from
   Find, Chats, Post, session, thread, live and the Today sheet. Home shows it third
   (`app/(tabs)/index.tsx:194`). Plans it has ready never reach "Waiting on you" or the
   tab badge, which counts join requests only (`app/(tabs)/_layout.tsx:104`).
2. **`app/assistant.tsx` is nine screens in one scroll**: hero, Chat/Plans switch, a
   workout-plans card, chat, preferences editor, plans list, an inline conversation
   opened "below" (:247), discovery, past buddies, controls. 15 Notices in the route and
   10 more in the chat files. The composer sits mid-scroll (`cloud-chat.tsx:405`). The
   hero only renders on the Plans pane (:134). Three names for one thing: "Workout
   assistant", "coach", "Buddy planning".
3. **The chat can talk, not act.** Its tools (`src/lib/conversation/provider.server.ts:180-248`)
   only produce a "Review" card that navigates to another pane, which unmounts the chat.
   The on-device chat has no tools. Not reachable from the conversation: set what you're
   looking for, start looking, invite, approve, book, join, post, answer a join request,
   read today's summary, log an exercise. The cloud prompt asks the member for their
   timezone because the app never sends it (:99-102). Fresh account → booked session via
   the assistant: **12 steps, 6 permission walls, 1 form; 9 of the 12 outside the chat.**
4. **Settings live inside feature screens.** Health permissions above the workout list
   (`app/health.tsx:198-310`), AI consent and export inside the fitness log
   (`app/fitness.tsx:224-305`), four switches inside the cloud chat, assistant controls
   at the bottom of the assistant, 12 rows on You. Home's "Workouts" shortcut opens a
   permissions page. This is the settings-page feeling.
5. **Five layout habits repeat everywhere.**
   - Consent/legal paragraphs inline instead of one tap away (`health.tsx:236-259`,
     `workout-run/[id].tsx:346-350`, `components/app-terms-gate.tsx`).
   - Notices as standing decoration (`workout-plans.tsx:71-88`, `billing.tsx:95-117`).
   - No pinned primary action: `footer=` is used by 3 routes; primaries sit mid-scroll in
     health, workout-run, workout-plan, verify.
   - Destructive confirms expand inline as Card + Notice + two buttons; they should be sheets.
   - Objects drawn as heading + caption + soft "Open" button; headings that explain
     instead of show (`workout-run/[id].tsx:486` states progress as a sentence).

Also: four overlapping "what I did" screens that link in a loop (`/fitness`, the
`/health` workout list, `/workout/[id]`, history in `/workout-plans`); the live session
has no way into the shared plan (`live/[id].tsx`); dates typed as `YYYY-MM-DD HH:mm`
(`assistant-preferences.tsx:171,181`, `fitness.tsx:568`).

## Settings-page score (0 clear · 5 pure text-and-buttons stack)

| 5 | 4 | 3 | ≤2 |
| --- | --- | --- | --- |
| health, workout-run, billing, assistant preferences / discovery / coordination | assistant, fitness, session-workout, workout-plan/[id], workout-plan/new, verify | you, live, workout/[id], workout-plans, report, delete-account, terms gate | Home, Find, Chats, session, training-block, post, thread, activity, today, welcome, sign-in |

Worst by impact: assistant → workout-run → health → fitness → Home (assistant third) →
session-workout → workout-plan → live → billing → verify.

## Every screen is one of eight shapes

Feed (scannable cards) · Detail (hero, facts, one pinned action) · Flow (a question per
step, progress, pinned Next) · Conversation (bubbles, pinned composer) · Live (big state,
big number, one control) · Dashboard (drawn data) · **Settings (grouped rows — the only
place text-and-toggle stacks belong)** · Sheet (one short decision).

`session/[id]` is the reference Detail; `today` the reference Dashboard. Assignments:
assistant = Conversation + Feed of plans; plan = Detail; workout-run and live = Live;
health, billing, you = Settings with a status hero; fitness = Dashboard + logging sheet;
workout-plans = Feed; workout-plan/new, verify, post, preferences = Flow.

## The structure to move to

**Tabs: Home · Find · Assistant (centre, orb state + needs-you badge) · Chats · You.**
Post moves to Find's header, Home's existing button, and "post it for me" in chat.

- **Home** (fits above the tab bar): greeting → one **Needs you** card merging assistant
  invites, plans ready, join requests and goal wrap-ups (+N opens a sheet) → compact Today
  → Next up with "Open plan" → a docked "Ask your assistant" composer with three
  suggestions. Everything else below the fold.
- **Assistant tab**: full-height chat, composer pinned, on-device/cloud in the header.
  Segments: Chat · Plans · Buddies. Each plan opens as its own modal
  `assistant/plan/[id]` — PlanTrack, PlanCard, Approvals, one pinned "Approve" / "Accept
  and book". Home, push and chat cards all open that same sheet.
- **Ask-the-assistant sheet**, prefilled with context, from session, Today, workout
  detail, empty Find, the Post flow, a join request, and after a session ("Same time
  next week?").
- **Training hub** (from You and the Today sheet): Day · Log · Workouts · Plans. Old
  routes stay as deep links.
- **Settings** (gear on You): Apple Health permissions, AI and privacy, assistant brief /
  pause / outside assistants, notifications, appearance, women-only, verification,
  blocked, billing, exports, legal, sign out, delete. You keeps profile, reputation,
  level, goals.

## The conversational spine (server + app)

Every tool returns an **approve-first card**; the write happens only on the member's tap;
the result is posted back into the chat. In priority order: `setLookingFor` (+ start
looking, one approval not two) → `showCandidates` (needs level and show-up record on the
candidate) → `inviteBuddy` → `reviewPlan` → `bookIt` → `findSessions(filters)` /
`joinSession` → `postSession` → `answerRequest` → `recapSession`. Prerequisites: send
timezone and current time with each turn; keep the chat mounted while a plan sheet is
open; push plan state changes into the chat. First run is a three-turn conversation with
chips, not a form.

## Order of work (each step ships alone)

| # | Step | Owner |
| --- | --- | --- |
| 1 | Assistant needs-you state in Home's "Waiting on you" and the tab badge | design |
| 2 | Plan as its own modal route; Home row, push and chat cards open it | design |
| 3 | "Open workout plan" on live and Next up | design |
| 4 | `/settings`; move permission blocks out of health, fitness, chat, assistant, You | design |
| 5 | Assistant becomes a tab with a pinned composer; Post re-homed; `/assistant` redirects | design |
| 6 | Home: merged Needs-you card + docked composer | design |
| 7 | Live shapes: workout-run and live get a big state and one pinned control; confirms → sheets | design |
| 8 | Training hub merging fitness, health workouts, plans and history | design |
| 9 | Approve-first chat tools, timezone, candidate level/record, recap read | functional (Codex) |
| 10 | Ask-the-assistant sheets across the app (depends on 9) | both |

Words to fix along the way: "preference sharing", "discovery permissions", "negotiating",
"revision N", "withdraw consent", "counterproposal", "participant", "private template",
"fixed copy", "TypeSafe/Jev", "pilot", "A2A agents", "SDNN/RMSSD" outside charts,
"Payment collection is currently disabled". Replacement list: see the flow review notes in PR.

## Accessibility found on the way

`Segmented` segments and the `Composer` input were 36 pt (fixed in the PR that adds this
file). Typed date fields; a "✓" inside a selected Chip label (`assistant-discovery.tsx:97`,
read twice); a Switch without `trackColor` (`health.tsx:249`); hardcoded gaps in health,
assistant, billing and fitness.
