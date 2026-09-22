# Plan v2 proposal — brainstorm

> Status: proposal for the owner, not approved. Produced 2026-09-22 by five competing proposals (member journey, agent spine, marketplace, contrarian, lean delta), two independent judges, a synthesis and a completeness critic; factual claims about the built app were then checked against the code. The full impact analysis is in [plan-v2-impact.md](plan-v2-impact.md). If approved, this supersedes the tab bar, Home and Chat sections of [MASTER-PLAN.md](MASTER-PLAN.md) and [PRD v0.4](../PRD-v0.4.md).

## In one paragraph (what changes for a member)

Home fits one screen: your next step, your agent's latest line and today's read. Chat becomes its own centre tab, a plain conversation with three suggestions above the message box. You tell your agent your goal. It drafts workouts, logs sets, checks you in, reports progress, and looks for one partner at your level who will expect you there. When something needs your yes, one short confirm states the exact time, place and fee, and you tap it. Sessions holds everything with other people, Exercise your training, You your record. Each feature has one home; nothing is removed.

## Your feedback, and what it does to the plan

| Feedback | Plan area | Effect | Size |
|---|---|---|---|
| F1, F4 Glass; sheets in balance | Visual, sheets | Confirms | S |
| F2, F13 Dashboard Home, five tabs | Tabs, Home | Contradicts PRD v0.4, #58 | M |
| F3, F7 Agent first, accountable partner | Agent's job | Confirms | M |
| F5 Terms, Health, opt-ins once; voice | Onboarding | Mostly built | M (voice L) |
| F6 Screens make no sense | Whole app | Extends: one home each | M |
| F8, F10 Chat that creates | Chat | Built (#58, #60) | S |
| F9 Agents coordinate quietly | Permissions | Built; we'd narrow it | M |
| F11, F12 Marketplace, tips | Money | New | L |
| F15 Text-first, exercise agent | Chat, positioning | Contradicts PRD cards | M |

## Recommended structure

**Home · Sessions · Chat · Exercise · You.** Chat is the centre tab: a filled accent pill labelled "Chat", with a needs-you dot. "You" beats "Me": the app speaks to "you". Five tabs work only if **each object has one home, and Home only points to it.**

- **Home:** what to do now. Owns nothing.
- **Sessions:** everything with other people.
- **Chat:** the conversation, nothing else.
- **Exercise:** your private training.
- **You:** record, membership, verification, settings.

**Look (F1).** Light keeps the built true-white page with frosted glass cards. In Chat, the agent's words sit unboxed, yours tinted; the confirm is the only glass card. Dark is near-black. Contrast checked per mode.

## Home

```
----------------------------------
Good morning, Ish
Goal ✓  Partner ✓  Show up
NEXT STEP
Thu 6:30 · Zilker trailhead
Easy 5K with Sam  [Check in]
YOUR AGENT
Sam's agent agreed to Thu.
Still looking for a Saturday.
[ Ask your agent...          ]
(How's my week?) (Post a run)
TODAY · OUR READ             >
Steady · rest 52 · sleep 7h10
----------------------------------
 Home Sessions (Chat) Exercise You
```

Home is one fixed, centred screen with no scroll; what sat below the fold now lives in Sessions or Exercise. Short phones drop the journey line, then chips, then readings.

The agent block is largest and central. Its box is a doorway into Chat, keyboard up; a chip opens Chat and sends. Today shows the easy/steady/ready band and measured readings, never guesses ("legs fresh"). After the first kept session, the journey line becomes your goal ("10K by 30 Nov · 5 kept").

- **New:** "Tell your agent your goal". Today hidden until Apple Health has readings.
- **Looking:** next planned workout; "Working on your partner · Tue/Thu mornings". Never a count of people.
- **Needs you:** shown once, in Next step; opens Plan peek or its confirm. No one-tap Approve.
- **Live:** Check in leads; the agent block shrinks to one line.

## Chat

**Why components in the chat?** Mostly, there shouldn't be. The dashboard feel has one cause: `agent-home.tsx` stacks up to six cards above the conversation, and replies render notices as chips. Move the stack to Home and show facts as plain lines.

We can't reach zero. A typed or spoken yes never approves, and the model's words can drift from what the server will do. So one non-text element survives: **the confirm**, a tap on exact, expiring terms.

```
----------------------------------
Your agent                 ···
Looking · Tue/Thu mornings   >
Sam runs 5K at your pace, free
Thu 6:30 at Zilker. 11 kept.
+----------------------------+
| Ask Sam's agent            |
| Thu 6:30 · Zilker trailhead|
| [Ask]       expires 6:12pm |
+----------------------------+
(How's my week?) (Plan today)
[ Message your agent...      ]
----------------------------------
```

- **Plain text:** my day, progress, recaps.
- **Confirm:** goal, "Start looking", post, a plan (Review opens Plan peek), repeat weekly, save a set.
- **Join requests:** Approve and Decline, the only two-button confirm.
- **Sessions:** one recommended with a confirm, others as numbered lines; inside 12 hours, Join opens the $5 sheet.
- **Check-in:** "Check in here" by location; if that fails, `live/[id]` holds the code field.
- **Workout plan draft:** a plain list, "Save and start"; Edit opens the full-screen editor.
- **Used or expired:** one muted receipt line.

**Chips:** always three, by situation; a tap sends. Today's code hides them exactly when they help. Each maps to a built tool:
- New: Run a 10K · Get stronger · Find me a partner
- Looking: How's it going? · Plan today · Post a run
- Booked: Warm-up for Thu · How's my week? · Check in
- Needs you: "What needs me?" leads. "Running late" waits for a tool (phase 11).

Returning members open at the latest message, with a "while you were away" line built by code from polled updates, not the model. `···` holds cloud or this iPhone, pause, data use, delete; "+" holds the existing photo and note drafts.

**Handoff:** Home's box and chips use CloudChat's existing `prefill`. "Ask about this" on a session, plan or workout opens Chat with a removable "About: Thu 6:30" tag, replacing the master plan's Ask sheet.

## The agent's job

"Exercise agent" is half right: daily training brings people back before a match exists. But "a buddy if there is a match" makes the partner optional, and the partner is the product. Solo AI coaching is crowded, and an app's reminder is easy to ignore; a person waiting at 6:30 is not.

Recommended line: **your agent keeps you on track and finds the partner who'll hold you to it.**

- **Today (#60):** save goals, draft workout plans, log sets, check in, count progress, find and post sessions, introduce a person, handle plans and requests.
- **Not today:** it can't see your readings, and no tool plans your week. Readings-based coaching is new functional work needing its own permission and your decision. Easy/steady/ready stays in code.
- **Partner search:** the default path leads to a "Start looking" tap, never switched on silently. One introduction is open at a time; the next follows a decline, expiry or booking, enforced by the server. Booking needs both taps. Health readings never reach another member or agent.

## Sessions · Exercise · Me

**Sessions.** Post in the header; Yours and Find, opening on Yours if anything is booked.
- **Yours:** Needs you · Your agent is arranging (`assistant/plan/[id]`) · Coming up · Every week · Shared goals · Past.
- **Find:** feed, At your level, Train for a goal; low-key until an area fills.
- **Absorbs:** lower `mine.tsx`, `sessions.tsx`, `inbox.tsx`, `agent-chat/[id]`, the `/assistant` Plans view, `/post`, `session/[id]`, `live/[id]`, `thread/[id]`, `session-workout/[id]`, `training-block/*`.

**Exercise.** Private goal and this week, Today · our read, next workout with Start (`workout-run/[id]`), plans, recent workouts, Apple Health status. Log is a full-screen modal, or say it in chat.
- **Absorbs:** `/today` (as a sheet), the `/health` list and Watch recorder, `/fitness`, `/workout-plans`, `workout-plan/*`, `workout/[id]`, `TrainingShortcuts`, You's training tile.

**You ("Me").** Rings, name, verified mark, levels, badges; Membership and Verification rows; a gear to Settings. Settings › Apple Health takes connect, auto-sync, export and "Stop syncing a kind of reading" (today's per-reading switches, kept). Fix `/you?rename=1`.

## Onboarding

```
Terms → What you do → Level → Apple Health
→ Showing up → Chat: goal → confirm
→ when and where → "Start looking"
→ notifications → verify (once Persona is live)
```

- **Screens:** all built (`AppTermsGate`, `/welcome`); new is one handoff to Chat.
- **Apple Health:** keep all 11 types. Six would drop distance, active energy, cycling power, blood glucose and HRV (RMSSD), which Today and `/health` use. "Stop syncing" is a later exit, not a choice here.
- **Opt-ins:** accepting Terms already turns on cloud, Health workouts, plans and logs, history and matching, each changeable in Settings › Privacy. Women-only is asked at "Start looking".
- **Skip:** "Not now" lands on Home. If chat is down, "What I'm looking for" opens as a form.
- **Verify:** once enforced, it gates introductions and posting or joining public, women-only and shared-goal sessions; the built verify sheet appears at each.
- **Just in time:** location at first Find or check-in; payment at the membership gate.

## Money and the marketplace

- **Built, off:** $12/month after two free sessions (gate at the third join); $5 late cancel and $10 no-show.
- **Not built:** mentors, a kind of partner introduced one at a time; paid one-on-ones, "Book · $40 held", paid out when both check in (needs Stripe Connect); tips after a recap, fixed and private, if ever.

Borrow DoorDash's model, not its menu. **Guards:** agents never discuss price; a mentor's agent never moves first; no photos before booking; public places or a shared gym; both verified for paid sessions; women-only covers mentors; "would train again" is the only feedback. Paid terms are step 2 of Plan peek, under a Terms addendum.

**Sequence:** partners and subscription at launch → unpaid mentors at your area target → paid one-on-ones once you set the cut, gym rules and insurance → tips last.

## What stays, what changes, what is re-homed

**Stays:** master plan phases 1–3 and 4 part 1; sheets-vs-screens rules; #60's tools and receipts; `TodayCard`, `NextUp`, `PlanTrack`, `workout-run`, `HealthStep`; PRD's pillars, one person at a time, goal first, subscription.

**Changes:** the master plan's tabs, three-pane Assistant, Buddies list, Ask sheet and 8-step onboarding go. PRD's "no dashboard" and three tabs go; "never a form" becomes "say it, or use the form".

**Re-homed from #58:** `(tabs)/agent.tsx` becomes Chat. `index.tsx` becomes Home, from `mine.tsx`'s first screen and `agent-home.tsx`'s cards, sharing `useAgentOpening()` with Chat. `mine.tsx` becomes Sessions. The built Siri shortcuts keep working: `samepace://assistant` → Chat, `?capture=photo` → Chat's "+", `samepace://sessions` → Sessions. They say "assistant" until a native build.

**One home each:**
- Name, level: You; other prompts point there.
- Private goal: Exercise. Shared goals: Sessions.
- Arranging, `AssistantDiscovery`: Sessions › Yours.
- Conversation, `LocalChat`: Chat. What I'm looking for (`AssistantPreferencesEditor`): a new `assistant/looking-for` screen, opened from Chat's status line.
- Delete, data use, `FitnessPilotPermissions`, Apple Health controls, Membership, Verification: Settings.
- Activity (`activity.tsx`): the header bell.

## Revised phases

1. **Plan v2, PRD v0.5.** Design; you approve. ✓ Decisions signed.
2. **Over-the-air updates.** Functional; decision 2. ✓ `expo-updates` ships in the next TestFlight build; until then every phase needs a store build.
3. **Tabs, re-homing, wording.** Design; 1. ✓ Old routes and Siri links land home; "Jev", "template", "consent", "shared-planning" swept.
4. **Card changes 1.** Functional, beside 5, behind a new flag. ✓ Card terms apart from notes, Decline, one open introduction, typed "no".
5. **Text-first Chat.** Design; 3; closes with 4. ✓ No card stack; chips always shown.
6. **Home.** Design; 5. ✓ Fits the smallest phone.
7. **Sessions.** Design; 3. ✓ Yours and Find.
8. **Exercise.** Design; 3. ✓ Training in one place.
9. **You, Settings part 2.** Design, functional; 8. ✓ Health and Membership open on status.
10. **Onboarding.** Design, functional; 5, 6; verify offer after 13. ✓ Built screens, one handoff, two confirms.
11. **Card changes 2.** Functional; 4. ✓ Receipt links, "Edit as form", the "About" tag, partner notes (decision 4).
12. **Live screens, undo, gates.** Design, functional; 7, 10. ✓ As master plan 8, 11.
13. **Launch items.** You, functional; alongside; blocks 14–16. ✓ TestFlight (the 502), Apple sign-in code exchange and revocation (confirm the .p8), `A2A_ENABLED=true` (partner-first needs it), Persona, Stripe live, device checks.
14. **Voice.** Functional, design; 13. ✓ Mic in a new build.
15. **Unpaid mentors.** You, then functional; 13, your area target.
16. **Paid one-on-ones, tips.** You, then functional; 15, Terms addendum.

## Where we'd push back on your thinking

- **F15:** one confirm stays, since a typed yes never approves; and the partner is the product.
- **F2, "rest on scroll":** a scrolling Home rebuilds the feed you found confusing.
- **F4, edits in sheets:** say it in chat; big forms are full-screen.
- **F5:** location and payment wait until needed, because people grant more when they see why. Terms get re-asked once, with v2, because today's text names "Chats" and internal names. Voice waits: no speech module exists, so a mic would do nothing; test dictation, and Siri already opens chat.
- **F11, F12:** three ways to charge before one paying member.
- **Designer's view:** a money confirm can't be minimal.

## Alternatives we considered and why not

- **Four tabs, sessions on Home:** rebuilds the long feed; our fallback.
- **Home as chat (#58):** the clutter you named.
- **Floating button, unlabelled orb:** covers controls; unclear.
- **Eight onboarding screens:** too long.
- **Several Join buttons, or Approve on Home:** commits without terms.
- **Six Health readings:** removes built features.
- **Unflagged card changes:** installed apps drop every card.
- **A "coach" chip:** mentors aren't built.

## Decisions for you

1. **Five tabs, with a true-white page in light mode?** Yes, after a phone test. F1 asks for true white; your "never pure white" rule then governs glass and dark mode.
2. **What goes to TestFlight next?** Today's main plus `expo-updates`, not a wait for the redesign, which then arrives over the air.
3. **Automatic contact between agents.** Built: accepting today's Terms plus saved preferences gives your agent authority; it scans hourly, starts at most 5 new contacts a day, someone who received 10 that day gets no more, and nobody with 20 open conversations is contacted. Recommend narrowing: contact only after "Start looking", one open introduction at a time.
4. **How do booked partners say "running late"?** Today they can't. Recommend your agent passes short notes, booked sessions only.
5. **Terms.** One re-accept with v2 (clean wording, narrowed contact), then an addendum only for mentors and payers? Recommend yes.
6. **Mentors and money after launch:** unpaid first, then paid once you set the cut, gym rules and insurance, tips last? Recommend yes.