> Superseded by docs/design/MASTER-PLAN.md — kept as an appendix.

# SamePace — the agent-first layout

Design specification, 21 September 2026. Builds on `docs/audits/2026-09-21-agent-first-audit.md`
and the kit in `docs/audits/design-handoff-assistant.md`. Paths are relative to `mobile/src/`.
**Nothing is removed.** Every feature that exists today has a home in §2.3.
Anything marked **NFW** *needs functional work* (server or native) before it can ship; everything
else is layout over endpoints that already exist.

Wireframe key: `[ Label ]` button · `( Label )` chip · `(o)` the assistant orb · `‹ ›` chevrons ·
`═` a pinned glass bar · `•` a badge · `[···]` overflow menu.

---

## 1. Design principles

1. **One job, one primary action, pinned.** Every screen answers one question. → Its single primary
   button lives in `Screen footer=` (glass, above the home indicator), never mid-scroll; everything
   else is a row, a chip or the overflow menu.
2. **Show, don't list.** A reading is a gauge, a chart or a tile; a plan is a photo card; progress is
   a track or a ring. → A heading followed by a paragraph and a soft button is a rejected layout.
3. **The assistant asks, the member approves.** The assistant never writes on its own. → Every
   consequential step is an `ActionCard` (or the Plan sheet's pinned button) the member taps; the
   result is posted back into the conversation. A voice request can never approve — approval is a tap.
4. **Settings live in Settings.** Permissions, privacy choices, exports and account controls are
   grouped rows under the gear on You. → No `Switch` and no permission text on a feature screen; a
   feature that is switched off shows one line and a link to its Settings row.
5. **Detail lives in sheets, so first screens fit.** Home's first screen is exactly one composed
   screenful; charts, histories, confirmations and legal text are one tap away. → Destructive
   confirms, pickers and "what this means" are `Sheet`s, never inline expansions.
6. **Ask once, in plain words.** Every opt-in is asked one time in onboarding, in a sentence a
   member would say. → No standing `Notice` decoration; full legal text opens from "What this
   means"; an accepted choice is never re-prompted, only changed in Settings.
7. **Talk or type — same thread, same cards.** Voice is an input method, not a separate mode. → A
   spoken request lands in the same conversation and produces the same approve-first cards.
8. **Private stays private, and looks it.** Apple Health and workout records never reach a buddy or
   their assistant. → Private surfaces carry a small lock in their header; nothing health-derived
   may appear in a `PlanCard`, a chat thread with a buddy, or anything sent between assistants. No
   red except errors; readings are facts against the member's own week, never a score.

---

## 2. Information architecture

### 2.1 Tab bar (unchanged set, five)

**Home · Find · Assistant (centre) · Chats · You.** The centre tab shows the `AssistantOrb` state
(off / ready / looking / needs you / booked) instead of a static icon, and a count badge for
everything the assistant is waiting on the member for. Home's badge counts join requests + goal
wrap-ups. Post is a header button on Find, a secondary on Home, and "post it for me" in chat.

### 2.2 Route tree after the redesign

```text
(onboarding)                      Flow, once per account            §3.15
  app-terms → welcome (8 steps) → lands on (tabs)/agent first conversation
(tabs)
  index            Home            Feed with a fitted first screen  §3.1
  sessions         Find            Feed                             §3.4
  agent            Assistant       Conversation · Plans · Buddies   §3.2
  inbox            Chats           Feed                             §3.7
  you              You             Dashboard                        §3.11
assistant/plan/[id]      Plan sheet          Detail (modal)         §3.3
assistant/ask            Ask the assistant   Sheet                  §5
assistant/looking-for    What you're looking for   Flow (modal)     §3.2.4
needs-you                Everything waiting on you  Sheet           §3.1
session/[id]             Session             Detail                 §3.5
post                     Post a session      Flow (modal)           §3.4.1
live/[id]                Check in            Live (full-screen)     §3.6
thread/[id]              Chat                Conversation           §3.7
training                 Training hub  ?tab=day|log|workouts|plans  §3.9
  training/log           Log an exercise     Sheet (Flow)           §3.9
workout/[id]             Workout (Apple Health)  Detail             §3.10
workout-plan/new         New workout plan    Flow                   §3.10
workout-plan/[id]        Workout plan        Detail                 §3.10
session-workout/[id]     Our workout         Detail                 §3.10
workout-run/[id]         Workout in progress Live (full-screen)     §3.8
training-block/[id]      Goal                Detail                 §3.12
training-block/new       Train for a goal    Flow (modal)           §3.12
activity                 Notifications       Feed                   §3.14
settings                 Settings            Settings               §3.13
  settings/assistant · settings/privacy · settings/health · settings/notifications
  settings/verification · settings/membership · settings/blocked · settings/outside-assistants
report · delete-account · sign-in · invite/[code] · open · billing-return · verified   §3.14
```

Old routes stay as redirects so links, pushes and App Shortcuts keep working:
`/assistant` → `/(tabs)/agent` (with `negotiationId` → `/assistant/plan/[id]`), `/today` →
`/training?tab=day`, `/fitness` → `/training?tab=log`, `/health` → `/training?tab=workouts`,
`/workout-plans` → `/training?tab=plans`, `/verify` → `/settings/verification`, `/billing` →
`/settings/membership`, `/blocked` → `/settings/blocked`.

### 2.3 Re-homing table (every route, every feature)

| Today | Feature | New home |
| --- | --- | --- |
| `(tabs)/index` | Greeting, `AppHeader` bell, `LiveBanner` | Home, unchanged position |
| | `TodayCard` + suggested session | Home first screen (compact: dial + headline + 3 pills); suggested session becomes an assistant offer in the Next-up slot when nothing is planned |
| | `NextUp` / "Nothing planned yet" | Home first screen, Next-up slot (§3.1) |
| | `AssistantSpot` | Merged into the **Needs you** card / assistant status strip |
| | `TrainingShortcuts` (Fitness log, Workouts) | One "Your training" row below the fold → `/training`; also on You |
| | "Saved workouts on this iPhone" (offline fallback) | Home error state button → `/training?tab=plans` |
| | `NamePrompt` | Onboarding step 2; if still missing, an item in Needs you → Name sheet |
| | "Set your level" card | Onboarding step 3; if skipped by an older account, an item in Needs you → `/welcome` |
| | `PushPrompt` | Onboarding step 7; if skipped, an item in Needs you once there is a plan or request |
| | Waiting on you (join requests Approve / Decline) | **Needs you** card + `/needs-you` sheet |
| | Goal wrap-ups ("Wrap it up") | **Needs you** card + sheet |
| | Credit card ("$10 credit") | A `Badge` row on You + Settings › Membership & fees hero |
| | Coming up, Every week (goals, weekly sessions: see next week's, train for a goal, Leave), At your level picks | Home, below the fold, unchanged order. Weekly-session actions move from inline expansion to a row sheet |
| `(tabs)/sessions` | Title, Post button, activity chips | Find header |
| | My level only · Before 10 AM · Fill-in spots · Women-only | Find › Filters sheet (button shows the count) |
| | Train for a goal rail, day sections, "Show N more at other levels", empty states | Find feed; empty state gains the assistant offer (§5) |
| `(tabs)/agent` + `assistant.tsx` | `AssistantHero` | Compact `AssistantStatusBar` in the Assistant header (all three segments) |
| | Chat / Plans `Segmented` | Chat · Plans · Buddies |
| | "Build a workout together" `ActionCard` | Suggestion chip "Draft a workout" + composer "+" menu; Plans live in Training › Plans |
| | Cloud chat: bubbles, `CoachNotes`, `WorkoutPlanDraftCard`, `DraftReview`, Review cards, Retry, Stop | Assistant › Chat. `DraftReview` opens as a sheet over the chat (chat stays mounted) |
| | Controls › Privacy choices (4 switches) | Settings › Privacy & AI |
| | Controls › Delete conversation | Assistant header `[···]` → confirm sheet; also Settings › Assistant |
| | Controls › Use on-device help / Back to coaching | Assistant header `[···]` › "Where it thinks"; also Settings › Assistant |
| | On-device chat, availability check, retry | Assistant › Chat (same thread UI, bubbles say "On this iPhone") |
| | On-device privacy, Clear on-device conversation | Settings › Privacy & AI; `[···]` › Delete conversation |
| | `LocalDraftTools` (draft from a note or photo; choose / take photo) | Composer "+" menu: "Photo of a workout", "Paste a note" |
| | `AssistantPreferencesEditor` (share switch, activity, length, places, note, available times, Save, Stop sharing now) | `/assistant/looking-for` Flow with chip pickers; the share switch → Settings › Privacy & AI "Let buddies see what I'm looking for" |
| | Plans in progress list | Assistant › Plans feed |
| | `Conversation` (join, `PlanTrack`, `PlanCard`, `Approvals`, Approve) | Plan sheet `/assistant/plan/[id]` |
| | `AssistantCoordinationPanel` (allow 24 h, ask our assistants, stop) | Plan sheet row "Let our assistants work it out" → sheet; default in Settings › Privacy & AI |
| | `Candidates` (find plans that fit both, propose, send another) | Plan sheet row "Other times that fit both" → Options sheet |
| | `BookingReview` (terms, Accept and book, Open booked session) | Plan sheet, last state; pinned **Accept and book** |
| | End / decline conversation, `ReportLink` | Plan sheet `[···]`: End this plan (confirm sheet), Report |
| | `History` timeline | Plan sheet row "What's happened" → sheet of `TimelineItem`s |
| | `AssistantDiscovery` (verify needs, 7-day looking, women only, people who fit, Invite, turn off) | Assistant › Buddies; the switch itself also in Settings › Privacy & AI |
| | Plan with a past buddy | Assistant › Buddies, "Past buddies" |
| | Controls › Pause my assistant | Settings › Assistant; `[···]` › Pause |
| | Controls › Connect an outside assistant (`AssistantCredentials`) | Settings › Assistant › Outside assistants |
| `(tabs)/inbox` | Chats list, empty state | Chats, unchanged |
| `(tabs)/you` | Avatar, name, rings, legend, goals finished / helped | You hero |
| | Strike / pause notice, free sessions left, credit, fees, strikes | You status strip (`Badge`s) → Settings › Membership & fees |
| | Membership & fees button | Settings › Membership & fees |
| | Your level | You, level chips → Level sheet (`LevelPicker`) |
| | Women-only sessions (gender) | Settings › Safety |
| | Verification | You: Verified mark by the name; Settings › Verification |
| | Your training rows (Apple Health, Fitness log, Assistant) | One "Your training" tile → `/training` |
| | Notifications (`NotificationSettings`) | Settings › Notifications |
| | Appearance | Settings › Appearance |
| | Blocked, Change my name, Help, Privacy, Terms, Admin queue, Sign out, Delete account | Settings (Safety / About / Account) |
| `today` | `TodayDetail` | Training › Day |
| `health` | Intro text | Removed from the screen; the sentence lives in onboarding step 4 and Settings › Apple Health › What this means |
| | Watch recorder card + live snapshot | Training › Workouts: a live tile while recording; `[···]` › Open Watch recorder |
| | Choose what to sync (per-type switches) | Gone from our UI by owner decision: iOS's own sheet chooses. "Remove a kind of reading" sheet in Settings › Apple Health keeps the delete capability |
| | Sync automatically, Connect / Update, Sync now / Continue sync, Check connection again | Settings › Apple Health |
| | Disconnect and delete synced data | Settings › Apple Health → confirm sheet |
| | Export Apple Health data | Settings › Your data |
| | Private workouts list, Details and corrections, Remove workout, paging | Training › Workouts |
| `fitness` | `FitnessSummary` | Training › Log hero |
| | `LogEditor` (what did you do, draft with AI, sets, started at, measure this attempt) | `/training/log` sheet; "measure" becomes a Settings › Privacy & AI choice |
| | `LogCard` list, edit, delete, paging, logging-outcome review (`FitnessPilotResult`) | Training › Log feed; edit opens the sheet; delete is a confirm sheet; outcome review is a row on the card |
| | Export fitness data | Settings › Your data |
| | Optional AI assistance, pilot permissions | Settings › Privacy & AI |
| `workout/[id]` | Details, zones, correction, reflect with AI, on-device recap, Log exercise sets | `/workout/[id]` Detail with sheets (§3.10) |
| `workout-plans` | Create, Saved on this iPhone (open, remove device copy), plans list, workout history | Training › Plans (plans + device copies) and Training › Workouts (history) |
| `workout-plan/new` | AI draft / by hand, review, Save & start, Save for later | Same route, Flow shape |
| `workout-plan/[id]` | Preview, Start my workout, Attach to session, Edit, Delete | Same route, Detail shape; "template" is renamed "plan" |
| `session-workout/[id]` | Choose plan, start / continue / review, save a private copy, remove plan, our progress | Same route, "Our workout", Detail shape |
| `workout-run/[id]` | Everything (sets, timers, skip, clear, note, sharing, sync, conflict review, recover fields, finish, delete) | Same route, Live shape (§3.8); secondary things in `[···]` and sheets |
| `session/[id]` | Everything | Same, plus `[···]` › Ask the assistant and the verification / membership sheets |
| `thread/[id]` | Messages, quick replies, check-in / how-was-it button, report | Same, plus the assistant chip in the composer row (§5) |
| `live/[id]` | Geofence check-in, backup code, statuses, meeting point, rating, same time next week, train for a goal | Same route, Live shape (§3.6); code and rating become sheets; adds "Open workout plan" |
| `post` | Whole form | Same route, Flow shape in four steps; adds "Post it for me" handoff from chat |
| `training-block/[id]`, `/new` | Everything | Same, Detail / Flow; Leave and Pass / Approve confirms become sheets |
| `activity` | Notifications feed | Same |
| `billing` | Membership, fees, disputes, Stripe, refresh | Settings › Membership & fees (status-first) + Membership sheet + Fee sheet |
| `billing-return`, `verified`, `open`, `invite/[code]`, `+native-intent` | Return and link handlers | Unchanged |
| `verify` | Both tiers, states, dev stand-in | Onboarding step 6 · just-in-time Verify sheet · Settings › Verification (status-first) |
| `blocked`, `report`, `delete-account`, `sign-in` | Everything | Unchanged in content; `blocked` under Settings |
| `welcome`, `app-terms` | Terms gist, what you do, level, Apple Health, the deal | Onboarding steps 1–4 and 8; steps 5–7 are new |

---

## 3. Screen specs

Shared rules for every spec below: header is the glass navigation header (or `AppHeader` on tabs);
content sits on `Backdrop`; loading = `StateView loading` / `Skeleton`; error = `StateView error`
with Retry; one `footer=` at most.

### 3.1 Home — `(tabs)/index` · Feed with a fitted first screen

**Job:** what needs me, how is my day, what is next. **Primary action:** the docked assistant
composer, pinned above the tab bar (`footer=`). The card-level primary is the Needs-you button.

```text
┌──────────────────────────────────┐
│ SamePace                  bell•  │
├──────────────────────────────────┤
│                                  │
│ Good morning, Ish                │
│                                  │
│ ╭ NEEDS YOU ─────────── 1 of 3 ╮ │
│ │(o) A plan is ready           │ │
│ │    Easy run · Tue 6:30 AM    │ │
│ │    with Maya · Katy Trail    │ │
│ │ [ Later ]        [ Review ]  │ │
│ ╰──────────────────────────────╯ │
│ ╭ TODAY ──────── See your day ›╮ │
│ │ (dial)  A steady day         │ │
│ │ Steady  7h 10 · 52 bpm · 4.1k│ │
│ ╰──────────────────────────────╯ │
│ ╭ NEXT UP ─────────────────────╮ │
│ │[photo] Thu 6:30 AM · Run     │ │
│ │ with Maya    [ Open plan ]   │ │
│ ╰──────────────────────────────╯ │
│                                  │
│══════════════════════════════════│
│ (Find an easy run) (My day)      │
│ ╭──────────────────────────────╮ │
│ │ Ask your assistant…    (mic) │ │
│ ╰──────────────────────────────╯ │
├──────────────────────────────────┤
│ Home Find (Assistant) Chats You  │
└──────────────────────────────────┘
```

**The fit rule.** First-screen height = window − top inset − header (64) − dock − tab bar. The three
cards sit in a `View` with `justifyContent: "center"` and `gap: Spacing.three`, greeting at the top
of that group. Nothing in the first screen may scroll or clip. Drop order when height < 560 pt of
free space: (1) suggestion chips row hides, (2) Next up collapses to one `ListRow`-height line,
(3) Today loses its pills. The Needs-you card never shrinks. What follows ("Coming up", "Every
week", "At your level", "Your training") begins exactly one screen down and only appears on scroll;
scrolling slides the dock and tab bar away together (`tabBarHidden`).

**Needs you** (new `NeedsYouCard`) merges, in priority order: check-in open (also `LiveBanner`) →
assistant invite ("Maya wants to plan a run") → plan ready / booking to accept → join requests →
goal wrap-ups → set-up items (name, level, notifications). Shows the first; "1 of 3" opens the
`/needs-you` sheet (a list of the same cards). Its primary opens the right place: Plan sheet,
session, goal. Join requests keep **Approve / Decline** inline.

**States.**
- *Nothing needs you:* the card becomes a one-line assistant strip: `(o) Looking for your run buddy
  · 2 people fit ›` (taps to Assistant › Buddies). Assistant off: `(o) Set up your assistant ›`.
- *Nothing planned:* Next-up slot is an `ActionCard`: "Nothing planned this week" · facts from the
  Today read ("Steady day", "Run") · **Find me a buddy** (opens Assistant with that request sent) ·
  secondary **Post a session**.
- *Apple Health not connected:* Today slot is a one-line row "Connect Apple Health to see your day ›"
  (→ Settings › Apple Health). Health sync unavailable (404): slot is omitted and the other two
  centre.
- *Loading:* `Skeleton` blocks at the three card heights (no layout jump). *Error:* `StateView` +
  "Saved workouts on this iPhone". *Offline:* cached cards, dock disabled with "You're offline".

**Kit:** `Screen hidesTabBar footer`, `AppHeader`, `LiveBanner`, `NeedsYouCard` (new), `AssistantOrb`,
`DayDial`, `PhotoCard`, `ActionCard`, `ComposerDock` (new), `SuggestionChips` (new), `ListCard`,
`ListRow`, `SectionTitle`, `SessionCard`, `TrainingBlockCard`. **Sheets:** Needs you, Name, weekly
session actions (See next week's session · Train for a goal together · Leave weekly session).

### 3.2 Assistant — `(tabs)/agent` · Conversation (+ two Feeds)

**Job:** tell the assistant what you want; approve what it proposes. **Primary action:** the
composer, pinned above the tab bar, with the mic inside it.

```text
┌──────────────────────────────────┐
│ (o) Assistant            [···]   │
│     Looking · 2 people fit   ›   │
│ [ Chat ][ Plans •1 ][ Buddies ]  │
├──────────────────────────────────┤
│       I have forty minutes       │
│       before work — find someone │
│       for an easy run         me │
│                                  │
│ (o) Tomorrow, 6:30–7:10 AM near  │
│     Katy Trail? Two people fit.  │
│  ╭ Invite Maya? ───────────────╮ │
│  │ Run · Steady · Verified     │ │
│  │ 12 sessions · 96% on time   │ │
│  │ (Tue 6:30 AM) (Katy Trail)  │ │
│  │ She sees your first name,   │ │
│  │ level and these times only. │ │
│  │ [ Not now ]  [ Invite Maya ]│ │
│  ╰─────────────────────────────╯ │
│     SamePace cloud               │
│                                  │
│══════════════════════════════════│
│ (Tomorrow works) (Later today)   │
│ ╭──────────────────────────────╮ │
│ │ + Message assistant     (mic)│ │
│ ╰──────────────────────────────╯ │
├──────────────────────────────────┤
│ Home Find (Assistant) Chats You  │
└──────────────────────────────────┘
```

#### 3.2.1 Header
`AssistantStatusBar` (new; a one-line `AssistantHero`): `AssistantOrb size=32`, title "Assistant",
status line from `assistantStatus()` (eyebrow + short detail). Tap → `/assistant/looking-for`.
`[···]` `OverflowMenu`: **What you're looking for** · **Where it thinks** (SamePace cloud ✓ / On this
iPhone) · **Pause assistant** · **Delete conversation** · **Assistant settings**. This is the only
place on-device vs cloud is chosen outside Settings; every assistant bubble says which one spoke
(`source="SamePace cloud"` / `"On this iPhone"`). One name everywhere: **Assistant** (never "coach",
"Workout assistant", "Buddy planning").

`Segmented`: **Chat · Plans · Buddies**, with a count dot on Plans when something needs the member.
All three panes stay mounted; switching never clears the draft text or a streaming reply.

#### 3.2.2 Chat pane
- Thread: `ChatBubble`s, newest at the bottom, auto-scroll; `TypingDots` while thinking;
  `CoachNotes` for long plan prose; `AssistantMarkdown` inside bubbles.
- **Approve-first cards** sit in the assistant bubble's `footer` as `ActionCard`s: icon, title as a
  question, fact chips, one line on what yes shares or does, **primary = the yes**, secondary =
  "Not now". After the tap the card collapses to a receipt line ("Invited Maya · 8:02 AM ✓") and the
  assistant posts the outcome. Cards (tools in the audit's order; all **NFW** step 9 except the
  last two, which exist): *Here's what I'll look for* → **Start looking** · *Invite Maya?* → **Invite
  Maya** · *A plan is ready* → **Review** (opens the Plan sheet) · *Book it?* → **Review and book**
  (opens the Plan sheet at terms) · *Join this session?* → **Join** · *Post this session?* → **Post
  session** · *Maya asked to join* → **Approve** / Decline · *Log this?* → **Save to my log** ·
  `WorkoutPlanDraftCard` → **Review** (`DraftReview` sheet → **Save & start**) · recap card (read
  only, lock glyph).
- Until step 9 ships, today's "Review" cards open the Plan sheet, `/assistant/looking-for`, a
  session, or `DraftReview` as *sheets over the chat* — the chat never unmounts.
- **Plans in progress and "needs you" in chat:** a pinned `NeedsYouStrip` under the segments when
  something is waiting — "A plan with Maya is ready · Review" — one line, accent-soft, opens the Plan
  sheet. Plan state changes are posted into the thread as system lines ("Maya approved the plan").
- **Suggestion chips** above the composer (`SuggestionChips`, max 3, horizontally scrollable):
  contextual replies when the assistant asked a question; otherwise starters: "Find me a buddy",
  "What's my day look like?", "Draft a workout".
- **Composer** (`Composer` + new props): leading **+** (`OverflowMenu`: Photo of a workout · Take a
  photo · Paste a note), multiline input "Message your assistant", trailing **mic** when empty /
  **send** when there is text / **stop** while streaming. Voice: §4.
- **States.** *First run:* the scripted first conversation (§3.15 step 9). *Empty thread:* orb at
  64, "What are you up for?", three starter chips. *Cloud switched off:* one line "The cloud
  assistant is off · Turn on in Settings ›" and the composer switches to On this iPhone if
  available. *Cloud unavailable:* system line "Can't reach the cloud right now" + chip **Use this
  iPhone**. *On-device unavailable:* line with the reason + **Use SamePace cloud**. *Error on a
  turn:* inline "That didn't go through" + **Try again** chip. *Interrupted reply:* bubble keeps
  its text with caption "Stopped". *Offline:* composer disabled, "You're offline"; cached thread
  readable.

#### 3.2.3 Plans pane · Feed
`PlanFeedCard` (new: `PhotoCard` at row height + mini `PlanTrack` + buddy name + state word +
"Needs you" `Badge`). Sections: **Needs you · In progress · Booked · Ended**. Tap → Plan sheet.
Empty: orb, "No plans yet", **Find me a buddy** (switches to Chat with the request sent).

#### 3.2.4 Buddies pane · Feed
Hero status: "Looking for a run buddy · until Sun 28 Sep" with the orb, or "Not looking". **People
who fit** as cards (name, activity, places in common; level and show-up record **NFW**) each with
**Invite** → confirm `ActionCard` sheet. **Past buddies** rows with **Plan again**. Verification
needs show as one row "Verify it's you to be introduced ›" (Verify sheet). Pinned footer: **Start
looking** (off) / "Looking until Sun 28 · Stop" (on). Women-only is a chip in the Start-looking
sheet when `canChooseWomenOnly`.

`/assistant/looking-for` · Flow (modal): four questions, one per step, all chips — **What**
(activity) · **How long** (30 · 45 · 60 · 90 min) · **Where** (meeting points, multi-select) ·
**When** (`DayTimePicker`: days × Before work / Lunch / After work / Evening, replacing typed
`YYYY-MM-DD HH:mm`) · optional "Anything your buddy should know?" field. Pinned **Save**. Maps to
`PUT /agents/preferences`.

### 3.3 Plan sheet — `assistant/plan/[id]` · Detail (modal)

**Job:** decide on one plan with one buddy. **Primary action:** one pinned button whose label is
the next step. Opened from Home, push, the chat card, Plans feed — always this same route.

```text
┌──────────────────────────────────┐
│ ‹ Close    With Maya      [···]  │
├──────────────────────────────────┤
│ Joined ● Plan ● Approved ○       │
│        Terms ○ Booked ○          │
│ ╭──────────────────────────────╮ │
│ │ [photo: Katy Trail]          │ │
│ │ PROPOSED                     │ │
│ │ Easy run · 40 min            │ │
│ │ Tue 23 Sep · 6:30 AM         │ │
│ │ Meeting point: Katy Trail N  │ │
│ ╰──────────────────────────────╯ │
│ (You ○ not yet) (Maya ● approved)│
│ Both of you approve before       │
│ anything is booked.              │
│                                  │
│ Other times that fit both     ›  │
│ Let our assistants work it out   │
│               On until Tue 6 PM› │
│ What's happened               ›  │
│ Open until Wed 24 Sep, 8 AM      │
│                                  │
│══════════════════════════════════│
│ [ Suggest another ] [ Approve ]  │
└──────────────────────────────────┘
```

**Pinned button by state:** invited, not joined → **Join planning** (note: "Maya sees your first
name, level and the times you allow — never your health data"; if the Settings default is on, the
same tap also allows your assistant to suggest times for 24 hours and the note says so) · joined,
no plan → **Find times that fit both** · plan from the buddy → **Approve** (+ Suggest another) ·
you approved → disabled "Waiting for Maya" · both approved → the terms block appears under the
card as fact chips — (You host) (Free to cancel until 12 h before) ($5 late cancel) ($10 no-show)
(Nothing charged today) — and the button is **Accept and book** · booked → **Open session** ·
ended / ran out of time → **Plan again**.

**Rows → sheets:** *Other times that fit both* → Options sheet (`PlanCard` per option, **Propose
this** / **Send this instead**) · *Let our assistants work it out* → sheet with both people's
status, **Allow for 24 hours** / **Ask our assistants now** / **Stop** · *What's happened* →
`TimelineItem` list · `[···]`: **End this plan** (confirm sheet: "Ends planning with Maya. A booked
session stays booked.") · **Report Maya**.
**States:** loading skeleton of track + card; error with Retry and, in `[···]`, **Leave this plan**
still available; meeting point no longer offered → button disabled with one line why.
**Kit:** `Sheet`/modal `Screen footer`, `PlanTrack`, `PlanCard`, `Approvals`, `ListCard`, `ListRow`,
`TimelineItem`, `Tag`, `OverflowMenu`, `ConfirmSheet`. Words: never "negotiation", "revision",
"counterproposal", "consent", "participant".

### 3.4 Find — `(tabs)/sessions` · Feed

**Job:** browse sessions at my level. **Primary action:** the card itself; header button **Post**.

```text
┌──────────────────────────────────┐
│ Find                  [ + Post ] │
│ (All)(Run)(Ride)(Gym)(Hike) ›    │
│ [ Filters •2 ]   My level: Steady│
├──────────────────────────────────┤
│ TRAIN FOR A GOAL            ›    │
│ [goal card] [goal card] [goal…   │
│                                  │
│ TODAY                            │
│ ╭ [photo] ─────────────────────╮ │
│ │ 6:30 PM · Easy run · 45 min  │ │
│ │ Katy Trail · Fits you        │ │
│ │ Maya ✓ Verified · 2 spots    │ │
│ ╰──────────────────────────────╯ │
│ TOMORROW                         │
│ ╭ [photo] ─────────────────────╮ │
│ │ 6:00 AM · Tempo ride · 60 min│ │
│ ╰──────────────────────────────╯ │
│ [ Show 4 more at other levels ]  │
├──────────────────────────────────┤
│ Home Find (Assistant) Chats You  │
└──────────────────────────────────┘
```

Filters sheet: My level only · Before 10 AM · Fill-in spots · Women-only (when eligible) · **Show
results**. **Empty results:** `EmptyState` replaced by an assistant `ActionCard` — "Nothing at your
level for Run this week" · (Run) (Steady) (Mornings) · **Ask my assistant to find a buddy** ·
secondary **Post a session**; "Show other levels" / "Clear filters" remain as text links. Level not
set: one row "Set my level to see what fits ›". **Kit:** `Chip`, `SessionCard`, `TrainingBlockCard`,
`SectionTitle`, `Sheet`, `ActionCard`, `StateView`.

#### 3.4.1 Post — `post` · Flow (modal, four steps, `StepDots`)
1 **What** (one session / train for a goal; activity; how hard; "any level welcome") → 2 **When**
(`DayTimePicker`: Day, Start time · Dallas, minutes, how long) → 3 **Where** (meeting-point
`PhotoCard`s; pin hint) → 4 **Who and name** (how many buddies, who can see it, joining, women-only,
session name, details). Pinned **Next**, then **Post session** / **Post the goal** / **Add weekly
session**. Header link on step 1: "Tell the assistant instead" (§5). A `verify_member` refusal opens
the Verify sheet; a membership refusal opens the Membership sheet; the form is kept.

### 3.5 Session detail — `session/[id]` · Detail (the reference)

**Job:** decide to join, or get ready. **Primary:** pinned **Join** / **Ask to join** / **Check in**
/ **Chat with Maya** (one, by state; "Full" is disabled).

```text
┌──────────────────────────────────┐
│ ‹                   Share [···]  │
│ ╭ [photo: Katy Trail] ─────────╮ │
│ │ (Run) (Open) (Women-only)    │ │
│ ╰──────────────────────────────╯ │
│ Tue 23 Sep · 6:30 AM             │
│ Easy run before work             │
│ ┌ Level ─┐ ┌ Spots ─┐ ┌ Length ┐ │
│ │ Steady │ │ 1 of 2 │ │ 45 min │ │
│ │ Fits ✓ │ │ left   │ │        │ │
│ └────────┘ └────────┘ └────────┘ │
│ HOST                             │
│ (M) Maya ✓ Verified              │
│     12 sessions · 96% on time ›  │
│ MEETING POINT                    │
│ Katy Trail North lot   [ Maps ]  │
│ OUR WORKOUT                      │
│ [plan row] 5 exercises · 40 min› │
│ Repeats every week            ›  │
│══════════════════════════════════│
│ [          Join          ]       │
└──────────────────────────────────┘
```

Facts are `MetricTile`s, not a list. Host join requests appear as a Needs-you block at the top
(Approve / Decline). `[···]`: Ask the assistant · Leave (confirm sheet with the fee line) · Cancel
session (host, confirm sheet) · Manage this goal · Report. After joining the footer becomes **Chat
with Maya**, and inside the check-in window **Check in**. **States:** ended → tags + "How was it?"
button; not available → `EmptyState`. **Kit:** `PhotoCard`, `Tag`, `MetricTile`, `Avatar`,
`PlanRow`, `ListRow`, `Screen footer`, `ConfirmSheet`, Verify sheet, Membership sheet.

### 3.6 Live check-in — `live/[id]` · Live (full-screen modal)

**Job:** prove you are both there. **Primary:** pinned **Check in**.

```text
┌──────────────────────────────────┐
│ ‹ Close                          │
│                                  │
│        120 m                     │
│   from the meeting point         │
│                                  │
│   Katy Trail North lot           │
│   Check-in open until 6:45 AM    │
│                                  │
│   (● You)        (○ Maya)        │
│    not yet        on her way     │
│                                  │
│   ~~~ proximity ring ~~~         │
│                                  │
│ Open workout plan             ›  │
│ Use a backup code             ›  │
│ Open in Maps                  ›  │
│                                  │
│══════════════════════════════════│
│ [        Check in         ]      │
└──────────────────────────────────┘
```

`BigNumber` = distance (or "Here" inside the fence; "—" while finding you). A `ProgressRing` closes
as you approach. **States:** not open yet → BigNumber is a countdown "Opens in 18 min", button
disabled with the time · location off → BigNumber replaced by "Location is off", button **Open
Settings**, backup code row promoted · closed → the reason line · **both in** → `SuccessMark`,
"You're both here", button **Start our workout** (if a plan is attached) or **Done** · after the
session → Rating sheet (two Yes / No chip rows: "On time?", "Would you join again?" · **Send**),
then the assistant offer sheet (§5). Backup code sheet: "Your code 4 8 2 1" (`BigNumber`) and a
4-digit field for theirs. **Kit:** `BigNumber` (new), `ProgressRing`, `SuccessMark`, `ListRow`,
`Sheet`, `Chip`.

### 3.7 Chats and thread — `(tabs)/inbox`, `thread/[id]` · Feed, Conversation
Chats: rows of `Avatar` + session title + last line + time; unread dot. Empty: "No chats yet" ·
**Find a session**. Thread: `ChatBubble`s, quick-reply chips, pinned `Composer` (with mic —
dictation only, this is a person-to-person chat), header button **Check in** / **How was it?** by
state, `[···]` Report. A small `(o)` button left of the composer opens Ask-the-assistant with the
thread's session as context (§5); the assistant never reads or posts in this thread.

### 3.8 Workout in progress — `workout-run/[id]` · Live (full-screen)

**Job:** do the next set. **Primary:** one pinned control whose label changes with the state.

```text
┌──────────────────────────────────┐
│ ‹ Close   Leg day    5/14 [···]  │
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░    │
│                                  │
│ GOBLET SQUAT · SET 2 OF 3        │
│                                  │
│          8 reps                  │
│          40 kg                   │
│                                  │
│   [ − ]  8 reps  [ + ]           │
│   [ − ]  40 kg   [ + ]           │
│                                  │
│ How to do it                  ›  │
│ Skip this set                    │
│                                  │
│ NEXT  Romanian deadlift 3 × 10   │
│ On this iPhone · syncs later     │
│                                  │
│══════════════════════════════════│
│ [       Done — set 2       ]     │
└──────────────────────────────────┘
```

**States of the pinned control:** set → **Done — set 2** (saves the shown actuals) · resting →
`BigNumber` countdown "1:30" with `RestTimer`, control **Skip rest** · timed set → `BigNumber`
stopwatch (`ExerciseTimer`), **Start** → **Stop** → elapsed shown for review → **Save set** · last
set done → **Finish workout** → Finish sheet (sets done / skipped, total time, **Finish and save**
/ Keep going). Targets show above the steppers in `textSecondary` so planned and actual are never
confused; a missing actual stays "—".
`[···]`: All sets (sheet: every exercise, edit / clear any set) · Private note · Share my set
counts with Maya (sheet, off by default) · Our plan and progress · Sync now · Finish early · Delete
this workout record (confirm sheet). **Offline:** the status line under NEXT; never a `Notice`.
**Needs you:** "Changes from another device" and "Recover unsaved entries" open as sheets on
arrival, each with its two existing choices. No offline storage → line "Needs a connection to
save". **Kit:** `BigNumber`, `Stepper` (new), `RestTimer`, `ExerciseTimer`, `SetFields` (inside
All sets), `Sheet`, `OverflowMenu`.

### 3.9 Training hub — `training` · Dashboard with four segments

**Job:** my day, what I did, what I'll do. **Primary (pinned, by segment):** Day → **Ask about my
day** · Log → **Log an exercise** · Workouts → **Start a workout** · Plans → **New workout plan**.
Lock glyph in the header: "Private to you".

```text
┌──────────────────────────────────┐
│ ‹  Training  (lock)       [···]  │
│ [ Day ][ Log ][Workouts][Plans]  │
├──────────────────────────────────┤
│        (  DayDial 160  )         │
│            Steady                │
│   A steady day — slept a little  │
│   less than your week.           │
│ HEART TODAY                      │
│ ▁▂▃▅▃▂▂▃▆▇▅▃▂▁  AreaChart        │
│ ┌ Sleep ──────┐ ┌ Resting HR ──┐ │
│ │ 7h 10       │ │ 52 bpm       │ │
│ │ ▓▓▒▒░ stages│ │ ▂▃▂▃▂▂▃ week │ │
│ └─────────────┘ └──────────────┘ │
│ ┌ HRV · SDNN ─┐ ┌ HRV · RMSSD ─┐ │
│ │ 48 ms  ▃▄▃▅ │ │ 41 ms  ▃▃▄▅  │ │
│ └─────────────┘ └──────────────┘ │
│ ┌ Steps ──────┐ ┌ Active energy┐ │
│ │ 4,120 ▂▅▃▆  │ │ 310 kcal ▃▅▂ │ │
│ └─────────────┘ └──────────────┘ │
│══════════════════════════════════│
│ [     Ask about my day      ]    │
└──────────────────────────────────┘
```

- **Day** = `TodayDetail` rebuilt from exported `MetricTile`s (Sleep with `StageBar`, Resting HR,
  HRV · SDNN, HRV · RMSSD, Steps, Active energy, Glucose, zones tile) + today's workouts. Tile tap →
  Metric sheet (large `AreaChart` / `WeekBars`, today vs the member's week, no advice). Not
  connected → `EmptyState` with the dial unlit · **Connect Apple Health**. `[···]`: Apple Health
  settings.
- **Log** = `FitnessSummary` (the week drawn) + `LogCard` feed. **Log an exercise** opens
  `/training/log` (sheet, Flow): "What did you do?" field with mic → **Draft it for me** (when the
  fitness help opt-in is on) → sets as `Stepper`s → when (`DayTimePicker`) → **Save exercise**. An
  imported draft is an `ActionCard` at the top ("From your plan — confirm what you actually did").
- **Workouts** = one chronological feed of Apple Health workouts and finished workout runs, each a
  row with activity icon, duration, distance and a mini zone `StageBar`, tagged (Apple Health) /
  (Logged here). While the Watch records: a live tile "Recording on your Watch · 24 min · 142 bpm".
  `[···]`: Open Watch recorder. **Start a workout** opens a plan picker sheet → workout run.
- **Plans** = `PlanRow` feed; device copies carry (On this iPhone) and their sync state; row
  `[···]`: Remove this device copy (confirm sheet). Empty: "No plans yet" · **New workout plan**.

### 3.10 Workout, plan and shared-plan details · Detail / Flow
- `workout/[id]`: hero `MetricTile`s (time, distance, energy, average HR), zones `StageBar` + minute
  chips, heart `AreaChart`. Rows → sheets: Fix the name or type · How did it go? (goal + note,
  **Make sense of my note** when help is on) · Recap on this iPhone · Log the sets I did. Pinned
  **Ask about this workout**. `[···]`: Remove workout.
- `workout-plan/new` (Flow): 1 **How?** three large options — Describe it (assistant drafts) · Photo
  or note · By hand → 2 **Review** (`PlanEditor`, `PlanTimingSummary`) → pinned **Save & start**,
  secondary "Save for later".
- `workout-plan/[id]`: `PlanPreview` + `PlanTimingSummary`; pinned **Start my workout** (or **Share
  with our session** when opened from a session). `[···]`: Edit plan · Delete plan (confirm sheet).
- `session-workout/[id]` "Our workout": `PlanPreview`; "Our progress" as two `ProgressRing`s (set
  counts only, only if each person shares); pinned **Start my workout** / **Continue** / **Review
  my workout**; no plan yet → **Choose a workout plan**. `[···]`: Save a copy for next time · Swap
  plan · Remove plan from session.

### 3.11 You — `(tabs)/you` · Dashboard

**Job:** who I am here. **Primary:** none pinned (profile); header gear → Settings.

```text
┌──────────────────────────────────┐
│ You                      (gear)  │
├──────────────────────────────────┤
│   ( rings )   Ish P.  ✓ Verified │
│   (  IP   )   14 sessions        │
│               96% on time        │
│               92% would join     │
│ (3 goals finished) (Helped 2)    │
│ (2 free sessions) ($10 credit)   │
│ YOUR LEVEL                       │
│ (Run · Steady) (Gym · Building) +│
│ GOALS                            │
│ [goal card] 10K in November 6/8  │
│ YOUR TRAINING                    │
│ ╭ This week ▂▅▃▆▂▁▄ 3 workouts ─╮│
│ │ Day · Log · Workouts · Plans ›││
│ ╰───────────────────────────────╯│
├──────────────────────────────────┤
│ Home Find (Assistant) Chats You  │
└──────────────────────────────────┘
```

Level chip → Level sheet (`LevelPicker`). Status `Badge`s → Settings › Membership & fees. A strike
or pause shows as a `Badge` (not red unless the account is paused) → sheet explaining it. Tap name
→ Change my name sheet. **Kit:** `TrackRings`, `Avatar`, `Badge`, `Chip`, `TrainingBlockCard`,
`WeekBars`, `Sheet`.

### 3.12 Goal — `training-block/[id]`, `/new`
Detail: photo hero with tags, goal title, a `ProgressRing` "6 of 8 kept", weeks to go; Every week
(weekly sessions); Training together (people, requests **Approve / Pass**). Pinned **Join — every
week** / **Ask to join** / (member) **Share invite link**. `[···]`: Add a weekly session · Start
one like it · Leave this goal (confirm sheet). `BlockEnding` wrap-up stays a Flow. `/new`: Flow
with `GoalPicker`, pinned **Start training for it**.

### 3.13 Settings — `settings` · Settings (the only text-and-toggle screen)

```text
┌──────────────────────────────────┐
│ ‹ Settings                       │
├──────────────────────────────────┤
│ ASSISTANT                        │
│ What you're looking for  Run ›   │
│ Assistant            Looking ›   │
│ PRIVACY & AI                     │
│ What your assistant can use  ›   │
│ APPLE HEALTH                     │
│ Apple Health       Connected ›   │
│ ALERTS                           │
│ Notifications             On ›   │
│ Location      While checking in› │
│ SAFETY                           │
│ Verification        Verified ›   │
│ Women-only sessions          ›   │
│ Blocked members            2 ›   │
│ MEMBERSHIP                       │
│ Membership & fees Free for now›  │
│ YOUR DATA                        │
│ Export Apple Health data     ›   │
│ Export fitness data          ›   │
│ APPEARANCE  (System)(Light)(Dark)│
│ ABOUT  Help · Privacy · Terms    │
│        What you agreed to        │
│ ACCOUNT  Change my name          │
│          Sign out · Delete       │
└──────────────────────────────────┘
```

Built only from `SectionTitle`, `ListCard`, `ListRow` and new `SettingRow` (label, one-line detail,
`Switch`, optional "What this means" → `LegalSheet` holding the exact notice text). Sub-pages:

- **Assistant** (`settings/assistant`): Pause assistant (switch) · Where it thinks (cloud / this
  iPhone) · Read replies aloud (**NFW**) · Outside assistants › (`AssistantCredentials`: name, how
  long it lasts, **Create a one-time key**, list with Remove) · Delete conversation.
- **Privacy & AI** (`settings/privacy`): the nine switches of §6, in that order, each changeable
  any time; switching one off states its effect in the confirm sheet ("This clears the
  conversation").
- **Apple Health** (`settings/health`): `StatusHero` (Connected · last synced 7:42 AM · 1,204
  records) · **Sync now** / Continue sync · Sync automatically (switch) · Manage what iOS shares
  (opens the Health app's permission page) · Remove a kind of reading › (sheet) · Open Watch
  recorder · Disconnect and delete (confirm sheet). Not connected → hero unlit + pinned **Connect
  Apple Health**.
- **Notifications**: `StatusHero` (On for this phone / Off / Off in iOS Settings → **Open
  Settings**) then the per-kind switches (Sessions, Messages, Reminders, Fill-in spots, …).
- **Verification** (`settings/verification`) — status-first:

```text
┌──────────────────────────────────┐
│ ‹ Verification                   │
├──────────────────────────────────┤
│          ( ✓ mark 96 )           │
│           Verified               │
│   Buddies see "Verified" by      │
│   your name. Nothing else.       │
│                                  │
│ Phone and face        Verified ✓ │
│ Government ID         Not yet  › │
│   Needed for women-only sessions │
│ Who sees what                  › │
│ Privacy                        › │
│                                  │
│══════════════════════════════════│
│ [      Verify your ID      ]     │
└──────────────────────────────────┘
```

  Hero states: **Not verified yet** (mark unlit) · **Being checked** ("A person is looking at it.
  You'll get a notification.") · **Didn't go through** ("Usually the light or a blurry photo.") ·
  **Verified**. Pinned: **Verify now** / **Continue** / **Try again** / **Verify your ID** / none.
  Not open yet → hero "Not open yet · nothing is locked". The development stand-in is a dev-only
  sheet.
- **Membership & fees** (`settings/membership`) — status-first:

```text
┌──────────────────────────────────┐
│ ‹ Membership & fees              │
├──────────────────────────────────┤
│         Free right now           │
│  Fees are recorded. Nothing is   │
│  charged to a card today.        │
│ ┌ Free ────┐┌ Credit ──┐┌ Fees ─┐│
│ │ 2 left   ││ $10      ││ $0    ││
│ └──────────┘└──────────┘└───────┘│
│ MEMBERSHIP                       │
│ $12 a month            Not open ›│
│ Manage or cancel in Stripe     › │
│ SESSION FEES                     │
│ Late cancel · $5 · Waived      › │
│ No-show · $10 · Under review   › │
│ Membership terms               › │
│ Refresh payment status           │
└──────────────────────────────────┘
```

  Hero states: **Free right now** (collection off) · **Active** · renews 20 Oct · **Ends 20 Oct** ·
  **Payment needs attention** (the only danger tone; pinned **Fix in Stripe**) · **No membership**
  (collection on; pinned **Start membership — $12 a month**). A fee row opens the Fee sheet: what,
  which session, status, **Pay in Stripe**, **Ask for a review** (reason field, 10+ characters).
  Pull to refresh = Refresh payment status. SamePace never sees card details — said once, in the
  Membership sheet.

### 3.14 Small screens
Notifications (`activity`): feed rows → their target; empty "Nothing yet". Report: reasons as
chips, optional note, pinned **Send report**, "Block without reporting". Delete account: type the
word, pinned danger **Delete my account**. Sign-in: unchanged. `invite/[code]`, `open`,
`billing-return`, `verified`: unchanged handlers; returns land on the matching Settings page.

### 3.15 Onboarding — one Flow, eight steps, then the first conversation

`StepDots total=8`; every step: title, at most three short lines, a drawn hero, pinned primary,
quiet secondary. About two minutes without verification. Accepted once, never shown again; existing
members who have already finished `welcome` see only step 5, once, as a sheet ("Meet your
assistant").

| # | Step | Required? | Primary · secondary |
| --- | --- | --- | --- |
| 1 | Before you start (terms) | Required | **Agree and continue** · Not now — sign me out |
| 2 | What do you do? (+ first name if missing) | Required | **Next** |
| 3 | At what level? | Required | **Next** · Back |
| 4 | Bring your Apple Health | Skippable; auto-skipped when unavailable or connected | **Connect Apple Health** · Not now |
| 5 | Meet your assistant (all opt-ins) | Screen required; each switch optional | **Continue** |
| 6 | Get verified | Skippable | **Verify now** · Later |
| 7 | Stay in the loop (notifications, location) | Skippable | **Turn on notifications** · Not now |
| 8 | How showing up works | Required | **Got it — meet my assistant** |

Order logic: what is legally needed first; the two questions the assistant cannot work without;
then the three things that make it good (health, permissions, trust); the deal last so it is fresh
when the first session is booked. Payment is **not** a step (§6.3).

**Step 1** keeps today's four-point gist (`app-terms-gate.tsx` `POINTS`) as four icon rows, no
card; "Read the full notice", Terms and Privacy open in a `LegalSheet`; footer caption stays.
**Steps 2–4** are today's `welcome` steps and `HealthStep`, unchanged in content.

**Step 5 — Meet your assistant**

```text
┌──────────────────────────────────┐
│ ● ● ● ● ◉ ○ ○ ○                  │
│            (o)                   │
│    Meet your assistant           │
│ It finds a buddy at your level   │
│ and sets things up. You approve  │
│ every step.                      │
│                                  │
│ Think in the cloud        [on ]  │
│  Smarter answers. Off = only     │
│  on this iPhone.                 │
│ Look for a buddy for me   [on ]  │
│  For 7 days, then it asks again. │
│ Let buddies see what I'm         │
│ looking for               [on ]  │
│  First name, level, times, places│
│ Let assistants work out times[on]│
│  Suggestions only. You approve.  │
│ Help me log workouts      [on ]  │
│ Use my workout history    [on ]  │
│ What each of these means      ›  │
│══════════════════════════════════│
│ [        Continue         ]      │
└──────────────────────────────────┘
```

Six switches on the step (three further refinements live only in Settings, §6). Defaults as drawn.
One caption under the list: "Your Apple Health data never reaches a buddy or their assistant."

**Step 6 — Get verified**

```text
┌──────────────────────────────────┐
│ ● ● ● ● ● ◉ ○ ○                  │
│         ( ✓ mark 120 )           │
│        Get verified              │
│ Buddies meet strangers. The      │
│ Verified mark tells them you're  │
│ a real, reachable person.        │
│                                  │
│ (i) About a minute, once         │
│ (i) A text, then a short selfie  │
│ (i) Persona runs the check.      │
│     SamePace never sees the photo│
│     — only whether it passed.    │
│ (i) Needed to join or post public│
│     sessions when checks are on  │
│                                  │
│══════════════════════════════════│
│ [       Verify now        ]      │
│           Later                  │
└──────────────────────────────────┘
```

**Verify now** runs the existing hosted flow (`beginVerification`, tier `member`) and returns to
this step showing the hero state (Verified / Being checked / Didn't go through · Try again), then
**Continue**. Government ID is never asked in onboarding; it is offered when a member first opens
or posts a women-only session. **Just-in-time version:** the same content as a `Sheet` ("Verify
it's you to join") opened by `useVerifyGate` on a `verify_member` / `verify_government_id` refusal
at the first Join, Post, Invite or Start looking — the action resumes on success. Verification not
open on the server → step 6 is skipped silently.

**Step 7 — Stay in the loop:** two `PermissionRow`s, each with its own **Turn on** button and a
✓ when granted: *Notifications* — "When someone joins, messages, or a plan needs you." *Location
while checking in* — "Only read on the check-in screen, to confirm you're at the meeting point."
(iOS "While Using"). Denied → row shows "Off · change in iOS Settings". Pinned **Continue**.

**Step 8 — How showing up works:** today's three `Deal` rows (check in on arrival · free to cancel
until 12 hours before, then $5 · no-show $10 and a strike) drawn as three icon rows, plus the line
"SamePace is free right now — fees are recorded, nothing is charged." Pinned **Got it — meet my
assistant**.

**Step 9 — First conversation** (not a dot; it is the app). Lands on Assistant › Chat. The
assistant opens: "Hi Ish. You run at a steady level. When do you usually have time?" → chips
(Before work) (Lunch) (After work) (Weekends) → "Where's easy for you?" → meeting-point chips →
"How long?" → (30) (45) (60) → an `ActionCard` "Here's what I'll look for" · (Run) (Steady)
(Before work) (Katy Trail) (45 min) · **Looks right — start looking** · Change. Until the chat
tools ship (step 9 of the build order) this is a client-side script (`FirstRunScript`) that writes
`PUT /agents/preferences` and `PUT /agents/discovery` on the approve tap; typed or spoken free text
at any point hands over to the real assistant.

---

## 4. Voice

**Placement.** The mic is the trailing button *inside* the composer pill, 44 × 44, in every
assistant composer (Assistant tab, Home dock, Ask sheet, Log sheet's "What did you do?"). Empty
input → mic; text present → send; streaming → stop. One control, three faces.

**Tap to toggle is the rule; hold also works.** Tap starts listening, tap again (or 1.5 s of
silence) finishes and sends. Press-and-hold (> 300 ms) listens while held and sends on release;
sliding off the button before release cancels. Haptic tick on start, double tick on send.

**States.**

```text
┌──────────────────────────────────┐
│ IDLE                             │
│ ╭──────────────────────────────╮ │
│ │ + Message assistant     (mic)│ │
│ ╰──────────────────────────────╯ │
│ LISTENING                        │
│ ╭──────────────────────────────╮ │
│ │ ▁▃▅▇▅▃▁▃▅▇▅▃▁                │ │
│ │ "forty minutes before work,  │ │
│ │ find someone for an easy…"   │ │
│ │ [ × ]   Listening    [ ■ ]   │ │
│ ╰──────────────────────────────╯ │
│ THINKING                         │
│ (o) · · ·          orb pulses    │
│ REPLYING                         │
│ (o) Tomorrow, 6:30–7:10 AM near  │
│     Katy Trail? Two people fit.  │
└──────────────────────────────────┘
```

- *Idle:* mic glyph in `textSecondary`.
- *Listening:* the composer grows into a `VoiceBar`: live waveform (accent), the live transcript in
  body text (partial words in `textFaint`), × to cancel, ■ to finish. The orb in the header
  switches to its listening pulse. Suggestion chips hide.
- *Thinking:* the transcript becomes an ordinary "me" bubble; `TypingDots` in an assistant bubble.
- *Speaking back:* off by default. With Settings › Assistant › "Read replies aloud" on, a reply to
  a *spoken* turn is read (first two sentences; cards are announced as "I have a suggestion for
  you to review"), with a speaker chip to stop. Never reads health numbers aloud unless the member
  asked for them.

**Same cards.** A spoken request is just text in the same thread. The assistant clarifies with
chips (which can also be answered by voice), then produces the same `ActionCard`s. **Voice never
approves:** "yes, invite her" gets "Tap Invite Maya to confirm" and the card pulses once. This keeps
every consequential step a deliberate tap.

**Errors and permissions.** First mic tap shows a one-time `Sheet`: "Talk to your assistant — your
voice is turned into text on this iPhone" · **Allow microphone** → the two iOS prompts (microphone,
speech recognition). Denied → the mic shows a slash; tapping it opens a sheet with **Open Settings**
and "or use the mic on your keyboard". Didn't catch that → the bar says "Didn't catch that" with
**Try again**; the partial transcript is kept in the input for editing. Offline → on-device
recognition still works; the send waits or routes to On this iPhone.

**Accessibility.** Mic label "Talk to your assistant", hint "Double-tap to start, double-tap again
to send"; state changes announced ("Listening", "Sent"); the transcript is a live region; the
waveform is decorative and hidden from VoiceOver; with Reduce Motion the waveform is a static
level meter and the orb does not pulse. Everything voice does is possible by typing.

**What works today, honestly.** Nothing in `mobile/package.json` records or recognises speech.
*Today, no new build:* the iOS keyboard's own dictation key works in every `TextInput`, so the
design ships first with the mic button focusing the input and a one-time hint "Tap the mic on your
keyboard to talk". *Needs a native module and a new EAS build (NFW):* in-app listening with live
transcript and waveform (an `SFSpeechRecognizer` + `AVAudioEngine` Expo module, on-device
recognition required, `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`
added in `app.config.js`), and reading replies aloud (`AVSpeechSynthesizer` / `expo-speech`).

**Siri and App Shortcuts.** Three exist in `modules/samepace-intelligence/shortcuts`
("Open my assistant", "Open my next workout", "Draft a workout from a picture"). Add three (native,
NFW, same build as the speech module): **"Find me a buddy in SamePace"** → opens Assistant › Chat
with that request sent and listening on for the follow-up; **"What's my day look like in
SamePace"** → opens Training › Day (a spoken answer from Siri itself needs a signed-in intent
handler — later); **"Start my workout in SamePace"** → opens the next booked session's shared plan,
else the most recent plan, straight into the Live screen's first set. All three deep-link through
`open.tsx`, so they survive sign-in.

---

## 5. The assistant outside its tab

**Ask-the-assistant sheet** — `assistant/ask?context=…` · Sheet (medium detent, grows to large
when the keyboard or a card appears). Header: orb + "About this session" (the context as a chip
the member can remove). Body: the last two turns only. Footer: up to three context chips + the
composer with mic. It is the same conversation as the Assistant tab — turns appear there too — and
"Open full conversation ›" jumps to it. Context sent with the turn is an identifier and a label,
never health readings (**NFW**: context parameter on the chat turn, with timezone and current
time).

| Where | How it appears | The approve-first offer |
| --- | --- | --- |
| Find, empty results | `ActionCard` replacing the empty state | "Nothing at your level for Run this week." **Ask my assistant to find a buddy** → Here's-what-I'll-look-for card prefilled from the active filters |
| Home, nothing planned | `ActionCard` in the Next-up slot | "Steady day. Want an easy run this week?" **Find me a buddy** · Post a session |
| Post | Link on step 1, "Tell the assistant instead" | Member describes it; the assistant returns *Post this session?* with fact chips → **Post session** (or **Edit first**, which fills the Flow) |
| Session detail | `[···]` › Ask the assistant; chips "Does this fit my day?", "Who's the host?", "Find one like this later in the week" | *Join this session?* → **Join** |
| A join request | In the Needs-you sheet, a quiet "Ask about Sam" | Shows Sam's public record (sessions, on time, level); *Approve Sam?* → **Approve** / Decline |
| After a session | Offer sheet after the rating is sent | "Same time next week with Maya?" **Make it weekly** · **Train for a goal together** · Not now. Then the private recap card (lock glyph; from permitted records; **NFW** `recapSession`) |
| Today / Training › Day | Pinned **Ask about my day**; chips "What suits today?", "Compare with last week" | *An easy session suits today — look for one?* → **Find one** (the read stays private; only "easy run" reaches search) |
| A chat thread | `(o)` button left of the composer | Chips "Suggest a time", "Where should we meet?" → a draft message placed in the thread's input for the member to send; the assistant never posts to a person |
| Workout detail | Pinned **Ask about this workout** | *Log this?* → **Save to my log** |

Until the chat tools ship, each entry opens the sheet with the question prefilled and the existing
"Review" cards; the layout does not change when the tools arrive.

---

## 6. Opt-ins, redesigned

### 6.1 The rule
Asked once (onboarding steps 1, 4, 5, 7), in the member's words, defaulted to the useful choice,
each with a one-line consequence. "What each of these means ›" opens a `LegalSheet` with the exact
notice text per switch (the constants in `shared/`), plus Terms and Privacy links. Nothing is
re-asked after acceptance; a new notice version raises one Needs-you item, not a wall.

### 6.2 The switches

| Says | Default | Maps to | Later, in Settings |
| --- | --- | --- | --- |
| *Agree and continue* (step 1) | required | `PUT /me/terms` `{version: APP_TERMS_VERSION}` — establishes built-in assistant permissions for new members | About › What you agreed to (`AppTermsReview`, read only) |
| **Think in the cloud** — "Smarter answers. Off = only on this iPhone." | On | `/assistant/settings` `cloudEnabled` (`CHAT_CONSENT_NOTICE`) | Privacy & AI; off clears the conversation (confirm sheet) |
| **Use my workout history** — "Recent plans, logs and results, when it helps." | On | `/assistant/settings` `manualWorkoutContextEnabled` + `historyUse: "when_relevant"` | Privacy & AI, as two rows: "Use my saved plans and logs", "Use them without me asking" |
| **Use my Apple Health workout summaries** — "Time, distance, heart-rate summary. Never sleep or HRV." | On if Apple Health was connected in step 4, else hidden | `/assistant/settings` `fitnessContextEnabled` (`CHAT_FITNESS_NOTICE`) | Privacy & AI (Settings only; on the step it rides with "Use my workout history") |
| **Help me log workouts** — "Turns a note into sets you can edit." | On | `PUT /fitness/consent` `{enabled}` (`FITNESS_AI_CONSENT_NOTICE`) | Privacy & AI; off removes saved interpretations |
| **Help improve logging** — "Compares drafts with what you save. 30 days." | Off; Settings only | `PUT /fitness/pilot-consent` | Privacy & AI |
| **Let buddies see what I'm looking for** — "First name, level, times, places." | On | `PUT /agents/preferences` `enabled: true` | Privacy & AI; also `[···]` › Pause assistant |
| **Look for a buddy for me** — "For 7 days, then it asks again." | On | `PUT /agents/discovery` `{enabled, preferenceRevision, womenOnly}`; written when the first conversation's card is approved, because it needs saved preferences | Privacy & AI + Assistant › Buddies; renewal is a Needs-you item |
| **Let assistants work out times** — "Suggestions only. You approve." | On | Per plan: `PUT /agents/negotiations/:id/coordination` (24 h). The switch is a stored default; with it on, the member's **Join planning** tap also sends this call and the card says so. A true account-level default is **NFW** | Privacy & AI; per plan in the Plan sheet |
| **Bring your Apple Health** (step 4) | member's tap | `health.connect(EVERYTHING, true)` → iOS sheet; `/health/connection` | Settings › Apple Health |
| **Notifications** (step 7) | member's tap | `usePush().enable()` + `me.notify` kinds via `useUpdateMe` | Settings › Notifications |
| **Location while checking in** (step 7) | member's tap | `expo-location` when-in-use; read only on `live/[id]` | Settings › Location (status + Open iOS Settings) |
| **Get verified** (step 6) | member's tap | `beginVerification` (Persona hosted) | Settings › Verification |
| Outside assistants | Off; Settings only | `/agents/delegations` | Settings › Assistant › Outside assistants |

Existing members keep every choice they already made; the "Meet your assistant" sheet shows their
current values, not the defaults.

### 6.3 Payment: asked when first needed, never in onboarding
Collection is off in production (`BILLING_ENABLED` unset; "fees are recorded, nothing is charged").
Asking for a card while nothing is charged costs trust and completion for no benefit, and there is
no card-on-file endpoint — only Stripe-hosted membership checkout and per-fee checkout. So
onboarding says the deal (step 8) and takes no payment. When collection and enforcement are on, the
**Membership sheet** appears at the moment a Join, Post or **Accept and book** is refused for
membership (**NFW**: give that 403 a `membership_required` code like `verify_member`; today it is
only a message):

```text
┌──────────────────────────────────┐
│            ────                  │
│      Keep showing up             │
│ Your 2 free sessions are used.   │
│ Membership is $12 a month.       │
│ Cancel any time in Stripe.       │
│                                  │
│ (i) Paid on Stripe's secure page │
│     SamePace never sees your card│
│ (i) Your $10 credit comes off    │
│     the first month              │
│                                  │
│ Membership terms               › │
│                                  │
│ [ Continue to Stripe — $12/mo ]  │
│            Not now               │
└──────────────────────────────────┘
```

On return (`billing-return`) the sheet shows "Checking…" then resumes the action that was refused.
The **Fee sheet** (a fee the member can pay) has the same shape: what and which session, amount,
**Pay in Stripe**, **Ask for a review**. While collection is off neither sheet can appear and
Settings › Membership & fees reads "Free right now".

---

## 7. Visual system deltas

### 7.1 New kit components (all presentational; tokens only)

| Component | Props | Why |
| --- | --- | --- |
| `Sheet` | `visible, onClose, title?, detents: ("medium"\|"large")[], footer?, children` | The missing primitive: confirms, pickers, legal text and detail currently expand inline |
| `ConfirmSheet` | `title, body, confirm: {label, danger?}, cancelLabel, busy` | One shape for every destructive confirm |
| `LegalSheet` | `title, sections: {heading, text}[], links` | Full notice text one tap away, selectable, never on the screen itself |
| `OverflowMenu` | `items: {icon, label, danger?, onPress}[], accessibilityLabel` | Secondary actions leave the scroll; 44 pt trigger |
| `Composer` (extend) | `+ onMic?, micState: "idle"\|"listening"\|"denied", onAttach?, leading?` | Mic and "+" inside the one pill; send / stop unchanged |
| `VoiceBar` | `transcript, partial, level, onCancel, onFinish` | The listening face of the composer |
| `ComposerDock` | `placeholder, chips, onOpen(text?), onMic` | Home's pinned entry into the Assistant tab |
| `SuggestionChips` | `items: {label, onPress}[]` | Replies and starters above any composer |
| `AssistantStatusBar` | `status: AssistantStatus, onPress` | The hero at header height, on all three panes |
| `NeedsYouCard` / `NeedsYouStrip` | `items: NeedsYouItem[], onOpenAll` | One merged place for everything waiting on the member |
| `PlanFeedCard` | `plan, buddyName, done, state, needsYou, onPress` | Plans as a Feed, not text cards |
| `MetricTile` | `icon, color, label, value, note?, wide?, onPress?, children (chart)` | Export of today-card's private `Tile`; used by Day, workout, session facts, membership |
| `BigNumber` | `value, unit?, caption?, tone?: "text"\|"accent"` | Live screens: distance, countdown, reps, code. Outfit 700, 64–96 pt, tabular figures |
| `Stepper` | `value, step, unit, min?, onChange, label` | Actual reps / load without a keyboard mid-set |
| `StatusHero` | `icon\|dial, state, title, detail, tone` | Status-first top of Verification, Membership, Apple Health, Notifications |
| `SettingRow` | `label, detail?, value, onValueChange, onAbout?, disabled?` | `ListRow` + `Switch` with `trackColor` from tokens |
| `PermissionRow` | `icon, title, body, status, onEnable` | Onboarding step 7 |
| `DayTimePicker` | `days, slots \| hour + minute chips, value, onChange, zoneLabel` | Lift of `post.tsx`'s chip `Choice`s; replaces every typed `YYYY-MM-DD HH:mm` |
| `FirstRunScript` | `member, venues, onApprove` | The three-question first conversation before chat tools exist |

Existing components used as they are: `Screen`, `Card`, `Row`, `Button`, `Chip`, `Field`, `Avatar`,
`Badge`, `EmptyState`, `StateView`, `T`, `ListCard`, `ListRow`, `SectionTitle`, `PhotoCard`,
`SessionCard`, `Tag`, `AreaChart`, `WeekBars`, `StageBar`, `DayDial`, `AssistantOrb`, `ChatBubble`,
`CoachNotes`, `TypingDots`, `ActionCard`, `Segmented`, `PlanCard`, `PlanTrack`, `Approvals`,
`TimelineItem`, `FitnessSummary`, `LogCard`, `PlanRow`, `PlanPreview`, `PlanEditor`,
`PlanTimingSummary`, `RestTimer`, `ExerciseTimer`, `SetFields`, `StepDots`, `TrackRings`,
`ProgressRing`, `SuccessMark`, `Skeleton`, `Enter`, `Appear`, `PressScale`. `Notice` is kept for
errors (`tone="danger"`) and one-off system lines only.

### 7.2 Light and dark
- **Light — glassy and classy on true white.** Page `#FFFFFF` with the faint `Backdrop` wash;
  content cards are `glassSurface` (frosted white, bright `glassEdge` hairline, the wide 7% shadow).
  Real blur is reserved for what floats: tab bar, headers, pinned footers, the dock, `Sheet`
  chrome. Primary buttons are `primary` green, never a black slab. The assistant's cards use
  `accentSoft` with a 35% accent hairline so they read as "from the assistant" at a glance.
  `BigNumber` is `text` on white; rings and dials use `accent`, `stand`, `exercise`, `move` at full
  strength against a `backgroundSelected` track.
- **Dark — equally considered.** `#050506` page, cards at 6.5% white with the 14% edge; no shadow,
  the glow of the accent does the lifting. Primary buttons are near-white with near-black text;
  the orb and the listening waveform are the brightest things on screen. Sheets are one step
  lighter than the page (`backgroundElement` over blur) so they separate without a border.
- Both: contrast re-checked per theme for every new component (4.5:1 text, 3:1 marks); never pure
  black or pure white text; `danger` only for errors and the paused-account state.

### 7.3 Motion
Orb: breathes when ready, pulses when looking or listening, a single ring-out when something needs
you. Sheets: spring up from the footer, backdrop fades. `ActionCard` approve: button → check →
collapses to a receipt line (220 ms). `PlanTrack`: the newly done step fills left to right.
`BigNumber`: digits cross-fade, never roll, for legibility mid-workout. Rest countdown: the ring
drains. Home cards: `Enter` stagger once per focus. Tab icon dip stays. **Reduce Motion:** all of
the above become opacity changes or nothing; the waveform becomes a static level bar; no parallax
on photo heroes. Haptics: select on tab and chip, success on approve / check-in / set done.

### 7.4 Accessibility rules
44 × 44 pt minimum for every target (mic, overflow, steppers, chips — `HitTarget`); visible focus
for keyboard and switch control; every icon-only control has a label and, where the result is not
obvious, a hint; state is never colour alone (approved = filled dot **and** the word; selected chip
= fill **and** `accessibilityState.selected`, no "✓" typed into labels); charts expose a one-sentence
summary (as `TodayCard` does); `BigNumber` reads with its unit and caption as one element; sheets
trap focus and return it to the opener; Dynamic Type up to XXL without clipping — the Home fit rule
is evaluated *after* text scaling and drops rows rather than truncating; body line height 1.5.

---

## 8. Build order

| # | Step | Owner | Depends on |
| --- | --- | --- | --- |
| 1 | Kit primitives: `Sheet`, `ConfirmSheet`, `LegalSheet`, `OverflowMenu`, `SettingRow`, `StatusHero`, exported `MetricTile`, `BigNumber`, `Stepper`, `DayTimePicker` | design | — |
| 2 | `/settings` and its sub-pages; move every switch, export and account row out of health, fitness, chat, assistant and You; status-first Verification and Membership; old routes redirect | design | 1 |
| 3 | Plan sheet `assistant/plan/[id]`; Home, push, chat cards and Plans feed all open it; chat stays mounted | design | 1 |
| 4 | Assistant tab: `AssistantStatusBar`, Chat · Plans · Buddies, pinned `Composer` with "+" and mic (keyboard-dictation fallback), `SuggestionChips`, `NeedsYouStrip`; `/assistant/looking-for` Flow; Controls gone | design | 2, 3 |
| 5 | Home: `NeedsYouCard` + `/needs-you` sheet, fitted first screen with the drop order, `ComposerDock`; tab badge counts everything waiting | design | 3, 4 |
| 6 | Onboarding as one 8-step Flow (steps 5–7 new), the "Meet your assistant" sheet for existing members, `FirstRunScript`; just-in-time Verify sheet through `useVerifyGate` | design | 1, 2 |
| 7 | Live shapes: `live/[id]` (BigNumber, code and rating sheets, Open workout plan) and `workout-run/[id]` (current set, rest, one control, All-sets sheet, conflict / recover sheets) | design | 1 |
| 8 | Training hub `/training` (Day · Log · Workouts · Plans), Log sheet, workout / plan / Our-workout Detail shapes; `/today`, `/fitness`, `/health`, `/workout-plans` redirect | design | 1, 2 |
| 9 | Approve-first chat tools in priority order (`setLookingFor` + start, `showCandidates` with level and show-up record, `inviteBuddy`, `reviewPlan`, `bookIt`, `findSessions` / `joinSession`, `postSession`, `answerRequest`, `recapSession`); timezone, current time and screen context on every turn; plan state changes pushed into the thread | functional | — (4 renders them) |
| 10 | Ask-the-assistant sheet and the offers of §5 across Find, Home, Post, session, join request, after a session, Day, thread, workout | both | 4, 9 (ships first with prefilled questions) |
| 11 | Speech: native listening module (on-device recognition, live transcript, level), usage strings, `VoiceBar`; "Read replies aloud"; new EAS build | functional (native) + design | 4 |
| 12 | App Shortcuts: "Find me a buddy", "What's my day look like", "Start my workout" through `open.tsx` | functional (native) | 11 (same build), 8 |
| 13 | Billing and coordination glue: `membership_required` code on the 403, Membership and Fee sheets resume the refused action; account-level default for letting assistants work out times | functional + design | 2 |
| 14 | Words and accessibility sweep: replacement list from the audit, no typed "✓", `trackColor` on every switch, Dynamic Type pass on Home, VoiceOver pass on Live screens, light and dark contrast check of every new component | design | all |

Each step ships alone. Steps 1–8 need no server change and no new build; 9 and 13 are server; 11
and 12 share one native build.
