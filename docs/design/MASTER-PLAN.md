# SamePace — the master plan

21 September 2026. This is the one document the owner approves and the team builds from. It merges
`docs/design/agent-first-layout.md` (layout draft) and `docs/design/sheets-vs-screens.md` (research
and framework); both stay in the repo as appendices. Where they disagreed about *how a thing is
presented*, the framework won. Paths are relative to `mobile/src/` unless they start with `docs/`
or `shared/`. **Nothing is removed — every feature is re-homed (§2.3).**

Owners: **DESIGN** (Claude) = layout, screens, components, copy in the app layer.
**FUNCTIONAL** (Codex) = server, native modules, data contracts, consent records.
Marked **[F]** = needs functional work before it can ship; everything else is design over
endpoints that exist today.

Wireframe key: `[ Label ]` button · `( Label )` chip · `(o)` the assistant orb · `›` opens
something · `═` a pinned glass bar · `•` a badge · `[···]` overflow menu · `────` a sheet's grabber.
Tab-root wireframes leave out the tab bar row.

---

## 0. The plan on one page

### 0.1 What changes for a member

1. **The assistant is the middle of the app** (Home · Find · Assistant · Chats · You). You talk or
   type; it proposes; you approve with a tap. A spoken "yes" never approves anything.
2. **Home is one calm screenful:** what needs you, Today (our read — easy / steady / ready — with
   its reason and key readings inside it), what's next, a message box. Charts open in a sheet.
3. **A plan with a buddy is a real place** (`assistant/plan/[id]`), and a **Plan peek** sheet
   rises over the chat so you can approve without leaving the conversation.
4. **Sheets are contextual, not a habit:** a sheet answers a tap, about the thing you tapped, in
   one breath. Anything you travel to, stay in or type a lot into is a full screen.
5. **Doing things is full screen:** session detail, check-in, workout in progress. Post a session
   and the workout-plan editor are full-screen tasks that cannot be swiped away by accident.
6. **Settings live in Settings,** behind the gear on You. Verification and Membership & fees open
   on your *status*, not on a form.
7. **One onboarding flow:** terms → what you do → level → Apple Health → set up your assistant →
   get verified → notifications and location → how showing up works → first conversation. No
   payment is asked.
8. **Training is one private hub** — Day · Log · Workouts · Plans — replacing four looping screens.
9. **Deleting is forgiving:** swipe + Undo once the server can undo **[F]**; a small confirm until
   then. Joining is one tap; the $5 line shows only inside the 12 hours when leaving costs money.
10. **Light on true white, glassy and classy; dark equally considered.** One vocabulary: session,
    spot, meeting point, host, buddy, Join / Leave, weekly session, goal, chat, Notifications, plan.

### 0.2 The five presentation types

| Type | What it is | Use it for | Rules |
| --- | --- | --- | --- |
| **Inline** | No overlay: menu, chip, switch, stepper, expanding row, card in the chat, toast with Undo | Anything reversible; ≤ 5 one-line options; a toggle | Always try this first |
| **Compact sheet** | Hugs its content | One decision whose consequence needs a sentence; a consent; one short field | Title, ≤ 5 lines, ≤ 2 buttons, no scrolling at default text size |
| **Large sheet** | Half ↔ full | A peek, a picker with many rows, a one-field quick capture | Opens full if it has a text field; no children; ≤ 2 screenfuls |
| **Screen (pushed)** | A place with a URL and a back chevron | Destinations: details, hubs, settings pages, lists | Hides the tab bar; one pinned footer; owns ≤ 4 sheets |
| **Modal (full-screen)** | A task with a start and an end, or a live state | Onboarding, Post, plan editor, looking-for, check-in, workout in progress | Close top-left, one pinned primary, no swipe-to-dismiss, discard guard; may open one sheet |

### 0.3 The phases

| # | Phase | Owner | Needs the server? |
| --- | --- | --- | --- |
| 1 | Sheet foundations and the inline kit | Design | No |
| 2 | Presentation corrections (retire page sheets, menus, confirms, Join fee rule) | Design | No |
| 3 | Plan screen + Plan peek | Design | No |
| 4 | Settings area; permissions leave the feature screens | Design | No |
| 5 | Assistant tab complete (Chat · Plans · Buddies, composer, looking-for) | Design | No |
| 6 | Home: Needs you, Today sheet, docked message box | Design | No |
| 7 | Onboarding as one flow + just-in-time Verify and Membership gates | Design (+ one consent sign-off from Functional) | No |
| 8 | Live screens: check-in and workout in progress | Design | No |
| 9 | Training hub, Log sheet, workout and plan details | Design | No |
| 10 | The conversational spine: approve-first chat tools, then "assistant everywhere" | Functional, then both | Yes |
| 11 | Undo and gates glue: soft-delete, `membership_required`, coordination default, recap | Functional + Design | Yes |
| 12 | Voice and Siri: speech module, `VoiceBar`, App Shortcuts, new build | Functional (native) + Design | New build |

Phases 1–9 need no server change and no new build, so they look right on the member's phone
(which talks to production) the day they merge.

---

## Built so far (verified in code, 21 September)

**On `main` (PRs #39–#43)**
- **Centre tab:** `(tabs)/agent.tsx` renders `app/assistant.tsx` inside `AssistantPlacement` =
  `"tab"` (`lib/assistant-placement.ts`); `/assistant` stays for links. The tab draws a `Bot` icon
  and a dot when `useAssistantStatus` says `needs_you` — **not yet the orb's state or a count**.
- **Home one screenful:** `(tabs)/index.tsx` centres greeting → `TodayCard` → `NextUp` / "Nothing
  planned yet" → `AssistantSpot` → `TrainingShortcuts` inside a `minHeight`; there is no drop
  order yet, and "Waiting on you" sits below the fold.
- **Today with our read:** `shared/today.ts` `ourRead()` → `easy | steady | ready` + `because`;
  `DayDial`; readings inside the card. `/today` renders `TodayDetail` **as an iOS page sheet
  (`presentation: "modal"`), not as a `Sheet`**; its `Tile` is private to `today-card.tsx`.
- **Kits:** `charts.tsx` (`AreaChart`, `WeekBars`, `StageBar`, `DayDial`) · `assistant-hero.tsx`
  (`AssistantHero`, `AssistantOrb`, `AssistantSpot`, `useAssistantStatus`) · `assistant-kit.tsx`
  (`Segmented`, `ChatBubble`, `CoachNotes`, `TypingDots`, `ActionCard`, `ComposerRow`, `Composer`
  — no mic, no "+") · `assistant-plan.tsx` (`PlanCard`, `PlanTrack`, `Approvals`, `TimelineItem`)
  · `fitness-kit.tsx` · `workout-plans/plan-row.tsx` · `step-dots.tsx` · `lib/area.ts`.
- **Onboarding pieces:** `app-terms-gate.tsx` (four `POINTS`, "Read the full notice", pinned
  **Agree and continue**) and `welcome.tsx` (what you do, with a "Not now" → level → `HealthStep`,
  one button asks for everything → the deal). The two disagree on `StepDots` (`total` 4 vs 5).
- **Find** already has its filters as inline chips and **Post** in its header.

**On branch `design/sheets-and-composer` (3 commits ahead of `main`, not merged)**
- `components/sheet.tsx`: compact + half (56%) + full, header-only drag, `startFull`,
  `keepMounted`, keyboard-aware, visible Close. Used in exactly two places.
- Pinned composer: `lib/composer-slot.tsx` + `components/composer-dock.tsx`.
- Chat options as a `Sheet` — it **still holds the four privacy switches**, Delete conversation
  and "Use on-device help".

**The six `Sheet` gaps, all confirmed:** no dismissal veto · no `onAccessibilityEscape` · the
grabber is a plain `View` · focus neither moved on open nor returned on close · upward scroll at
half does not expand first · Reduce Motion snaps (`duration: 0`).

**Not built:** `/settings`, `/training`, `assistant/plan/[id]`, Buddies pane, Needs-you card, Home
dock, any speech package. `assistant.tsx` is still one 936-line scroll (hero only on Plans, a
workout card above the chat, plans opened "below", Controls at the bottom, dates typed as
`YYYY-MM-DD HH:mm`). `post`, `verify`, `report`, `today`, `training-block/new` are page sheets;
`workout-run/[id]` is pushed. `session/[id]` raises a native alert with the fee sentence on
**every** Join. 11 `Alert.alert` calls in 7 files; `Screen footer=` on 3 routes. `expo lint` fails
on `lib/assistant/markdown.ts:2` (`import/no-unresolved 'marked'`).

---

## 1. Principles

1. **One job, one primary action, pinned.** Each screen answers one question; its one primary
   button lives in the glass footer. Everything else is a row, a chip or the `[···]` menu.
2. **Show, don't list.** A reading is a gauge or tile; a plan is a photo card; progress is a track
   or ring. Heading + paragraph + soft button is a rejected layout.
3. **The assistant asks, the member approves.** Every consequential step is an `ActionCard` or a
   pinned button the member taps; the result is posted back into the conversation.
4. **Lightest surface that works.** Inline first → compact sheet → large sheet → pushed screen →
   full-screen modal. A sheet must name the test that ruled out Inline.
5. **Settings live in Settings.** No `Switch` and no permission text on a feature screen; a
   feature that is off shows one line and a link to its Settings row.
6. **Ask once, in plain words.** Every opt-in is asked once in onboarding, in a sentence a member
   would say; legal text is one tap away; nothing accepted is re-prompted.
7. **Talk or type — same thread, same cards.** Voice is an input method, never a separate mode
   and never an approval.
8. **Private stays private, and looks it.** Apple Health and workout records never reach a buddy
   or their assistant. Private surfaces carry a lock glyph. No red except errors; readings are
   facts against the member's own week, never a score.

### 1.1 The 30-second presentation test

Ask in order; the first "screen" answer settles it; a sheet must pass all nine.

| # | Test | Sheet if… | Otherwise |
| --- | --- | --- | --- |
| T1 | Time | under ~30 s | Screen / Modal |
| T2 | Steps | one, or one + its confirmation | 3+ → Modal |
| T3 | Own navigation | never pushes, never opens a sheet | Screen, full stop |
| T4 | Context | what's behind is still useful | Screen |
| T5 | Data at risk | nothing typed, one short field, or autosaved | Modal, guarded |
| T6 | Live / immersive | no | Full-screen Modal |
| T7 | Destination | only exists relative to a parent | Screen (needs a URL) |
| T8 | Canvas | a few rows, one chart, one card | Screen |
| T9 | Weight | needs a sentence or a pinned button | Inline |

### 1.2 Hard limits

- **Never a sheet on a sheet.** Chaining counts. A sheet may change its own content **once**
  (form → result). Allowed above a sheet: an iOS permission prompt, the share sheet, a native
  picker, one discard alert — nothing we draw.
- **Sheets only answer taps.** Anything the app initiates is a banner, a Needs-you item or
  (rarely) an alert.
- **In a sheet:** ≤ 2 steps, ≤ 1 text field, no pushes, no segments, no pagers, ≤ 2 screenfuls.
  A row either acts in place or closes the sheet and then navigates.
- **Dirty sheets don't dismiss** on swipe or tap-outside; Close asks "Discard?". Autosaving and
  read-only sheets always dismiss freely. Must-answer prompts have no Close at all.
- **Only Screens and Modals have routes.** A link never opens a sheet directly.
- **Budget:** ≤ 4 sheets *of its own* per Screen. The shared `ConfirmSheet` and the app-wide
  sheets (Verify gate, Membership gate, Report, Block, Name, Host record, Ask) are one component
  each and are not counted per screen. The page-sheet presentation (`presentation: "modal"`) is
  retired from the app.

---

## 2. Information architecture

### 2.1 Tab bar

**Home · Find · Assistant (centre) · Chats · You.** The centre tab draws `AssistantOrb` at 28 in
its current state (off / ready / looking / needs you / booked) with a count badge for everything
the assistant is waiting on the member for. Home's badge counts join requests + goal wrap-ups.
Visible on the five tab roots only; pushed Screens hide it; Sheets and Modals cover it. **Post**
lives in Find's header, on Home's plan card, and as "post it for me" in chat.

### 2.2 Route tree after the redesign

```text
app-terms → welcome (8 steps)      Modal    onboarding, once                      §3.16
(tabs)/index                       Screen   Home                                  §3.1
(tabs)/sessions                    Screen   Find                                  §3.5
(tabs)/agent                       Screen   Assistant: Chat · Plans · Buddies     §3.2
(tabs)/inbox                       Screen   Chats                                 §3.9
(tabs)/you                         Screen   You                                   §3.13
assistant/plan/[id]                Screen   Plan                                  §3.3
assistant/looking-for              Modal    What you're looking for (one page)    §3.2
session/[id]                       Screen   Session                               §3.6
post                               Modal    Post a session (4 steps)              §3.5
live/[id]                          Modal    Check in                              §3.7
thread/[id]                        Screen   Chat                                  §3.9
training?tab=day|log|workouts|plans  Screen Training hub                          §3.10
workout/[id]                       Screen   Workout (Apple Health)                §3.11
workout-plan/[id]                  Screen   Workout plan                          §3.11
workout-plan/new · [id]/edit       Modal    Workout-plan editor                   §3.11
session-workout/[id]               Screen   Our workout                           §3.11
workout-run/[id]                   Modal    Workout in progress                   §3.8
training-block/[id]                Screen   Goal                                  §3.12
activity                           Screen   Notifications                         §3.15
settings  + /assistant /assistant/outside /privacy /health /health/readings
          /notifications /location /verification /membership /blocked /agreed
                                   Screen   Settings                              §3.14
delete-account · sign-in · invite/[code] · open · billing-return · verified   Screen  §3.15
```

**Not routes** (component sheets owned by a parent): Needs-you list, Today sheet, Plan peek, Ask
the assistant, Log an exercise, Train for a goal, Report, and every sheet in §3.17.

**Redirects** (links, pushes and App Shortcuts keep working): `/assistant` → `/(tabs)/agent`;
`/assistant?negotiationId=X` → `/assistant/plan/X`; `/today` → `/training?tab=day`; `/fitness` →
`/training?tab=log`; `/health` → `/training?tab=workouts`; `/workout-plans` →
`/training?tab=plans`; `/verify` → `/settings/verification`; `/billing` → `/settings/membership`;
`/blocked` → `/settings/blocked`; `/training-block/new?seriesId=X` → Home, which opens the Train
for a goal sheet after its first frame; `/report?…` → the parent screen, which opens the Report
sheet.

### 2.3 Re-homing table — every route and feature

Types: **S** Screen · **M** Modal · **LS** large sheet · **CS** compact sheet · **I** inline.

| Today | Feature | New home | Type |
| --- | --- | --- | --- |
| `(tabs)/index` | Greeting, `AppHeader` bell, `LiveBanner` | Home, same place | S / I |
| | `TodayCard` (our read, readings) | Home first screen; tap → **Today sheet** | I → LS |
| | Suggested session under Today | Assistant offer in the Next-up slot when nothing is planned | I |
| | `NextUp` / "Nothing planned yet" (Post · Find) | Home Next-up slot; Post stays on this card | I |
| | `AssistantSpot` | Merged into the **Needs you** card / one-line assistant strip | I |
| | `TrainingShortcuts` | One "Your training" row below the fold → `/training`; also on You | I |
| | "Saved workouts on this iPhone" | Home error state button → `/training?tab=plans` | I |
| | `NamePrompt` | Onboarding step 2; if still missing, a Needs-you item → Name sheet | CS |
| | "Set your level" card | Onboarding step 3 (required); older accounts: Needs-you item → Level sheet | LS |
| | `PushPrompt` | Onboarding step 7; if skipped, a Needs-you item once a plan or request exists | I |
| | Waiting on you (Approve / Decline) | **Needs you** card, buttons inline, toast receipt | I |
| | Goal wrap-ups | Needs-you item → goal Screen, wrap-up section at its top | I |
| | "$10 credit" card | `Badge` on You → explanation sheet → Settings › Membership & fees | CS |
| | Coming up · Every week · At your level | Home below the fold, same order | I |
| | Weekly-session actions (expanding row) | `OverflowMenu` on the row; only **Leave** opens a sheet | I / CS |
| `(tabs)/sessions` | Title, Post, activity chips, four filter chips | Find header — filters **stay inline chips** | I |
| | Goal rail, day sections, "Show N more", empty states | Find feed; empty state gains the assistant offer | I |
| `(tabs)/agent` + `assistant.tsx` | `AssistantHero` | `AssistantStatusBar` in the header of all three panes | I |
| | Chat / Plans `Segmented` | Chat · Plans · Buddies, panes stay mounted | I |
| | "Build a workout together" card | Starter chip "Draft a workout" + composer "+"; plans live in Training › Plans | I |
| | Cloud chat (bubbles, `CoachNotes`, draft card, Retry, Stop) | Assistant › Chat | S |
| | `DraftReview` | **Read-only** sheet over the chat; "Edit" closes it → plan editor | LS → M |
| | Chat options sheet: 4 privacy switches | Settings › Privacy & AI | S |
| | Chat options: Delete conversation | Header `[···]` → confirm; also Settings › Assistant | CS |
| | Chat options: Use on-device help / Back to coaching | Header `[···]` › **Where it thinks** (checkmarks); also Settings › Assistant | I |
| | On-device chat, availability, retry | Assistant › Chat, same thread; bubbles say "On this iPhone" | S |
| | `LocalDraftTools` (note, photo, camera) | Composer "+" menu → iOS pickers | I |
| | `AssistantPreferencesEditor` | `assistant/looking-for`, one page, chip pickers, Cancel / Save | M |
| | …its share switch | Settings › Privacy & AI "Let buddies see what I'm looking for" | I |
| | Plans in progress list | Assistant › Plans feed (`PlanFeedCard`) | I |
| | `Conversation` (join, track, card, approvals, Approve) | **Plan screen** + **Plan peek** | S + LS |
| | `AssistantCoordinationPanel` | Plan screen row → "Let our assistants work it out" sheet; default in Settings | CS |
| | `Candidates` (other times, propose, send another) | Plan screen row → "Other times that fit both" | LS |
| | `BookingReview` (terms, Accept and book) | Terms as fact chips above the pinned button, on the Plan screen and in the peek | I |
| | End / decline, `ReportLink` | Plan `[···]`: End this plan (confirm) · Report | CS / LS |
| | `History` timeline | Plan screen row → "What's happened" | LS |
| | `AssistantDiscovery` | Assistant › Buddies; Start looking is a consent sheet; switch also in Settings | I / CS |
| | Plan with a past buddy | Assistant › Buddies › Past buddies, **Plan again** | I |
| | Controls › Pause my assistant | `[···]` › Pause (Undo toast); Settings › Assistant | I |
| | Controls › Connect an outside assistant | Settings › Assistant › Outside assistants (key shown inline, once) | S |
| `(tabs)/inbox` | Chats list, empty state | Chats, unchanged | S |
| `(tabs)/you` | Avatar, name, rings, legend, goals finished / helped | You hero | S |
| | Strike / pause, free sessions, credit, fees | You status `Badge`s → explanation sheet → Membership & fees | CS |
| | Your level | Level chips on You → Level sheet (live preview, no Save) | LS |
| | Women-only sessions | Settings › Safety → choice sheet | CS |
| | Verification block | Verified mark by the name; Settings › Verification | S |
| | Training rows, Notifications, Appearance, Blocked, name, Help, Privacy, Terms, Admin queue, Sign out, Delete | One "Your training" tile; the rest → Settings | S |
| `today` | `TodayDetail` | Training › Day (pushed); Home opens the Today sheet | S + LS |
| `health` | Intro text | Onboarding step 4 and Settings › Apple Health › What this means | LS |
| | Watch recorder card + snapshot | Training › Workouts live tile; `[···]` › Open Watch recorder | I |
| | Per-type sync switches | iOS's own sheet chooses; Settings › Apple Health › **Stop syncing a kind of reading** | S |
| | Sync automatically, Connect / Update, Sync now, Check again | Settings › Apple Health | S |
| | Disconnect and delete | Settings › Apple Health → confirm | CS |
| | Export Apple Health data · Export fitness data | Settings › Your data → iOS share sheet | I |
| | Private workouts list, corrections, remove, paging | Training › Workouts | S |
| `fitness` | `FitnessSummary` | Training › Log hero | S |
| | `LogEditor` | **Log an exercise** sheet (component); "measure this attempt" → Privacy & AI | LS |
| | `LogCard` list, edit, delete, outcome review | Training › Log; edit = same sheet; delete = swipe + Undo **[F]** (interim confirm) | I / CS |
| | Optional AI assistance, pilot permissions | Settings › Privacy & AI | S |
| `workout/[id]` | Details, zones, correction, reflect, recap, log sets | Same route; rows open sheets (§3.11) | S |
| `workout-plans` | Create, device copies, plans, history | Training › Plans and Training › Workouts | S |
| `workout-plan/new` | AI / by hand, review, Save & start | Same route, **full-screen Modal** with guard | M |
| `workout-plan/[id]` | Preview, Start, Attach, Edit, Delete | Same route; Edit → `[id]/edit` Modal; "template" is renamed "plan" | S |
| `session-workout/[id]` | Choose, start / continue / review, save a copy, remove, progress | Same route, "Our workout" | S |
| `workout-run/[id]` | Everything | Same route, **full-screen Modal**, one pinned control (§3.8) | M |
| `session/[id]` | Everything | Same route; `[···]` replaces alert lists; Join rule of §3.6 | S |
| `thread/[id]` | Messages, quick replies, check-in button, report | Same; assistant help = chips that draft into the thread's own input | S |
| `live/[id]` | Check-in, code, statuses, rating, next-week offers | Same route; code and rating become sheets; adds "Open workout plan" | M |
| `post` | Whole form | Same route, **full-screen Modal**, 4 steps, guard | M |
| `training-block/[id]` | Everything | Same; Approve / Pass stay inline; Leave = confirm | S |
| `training-block/new` | Goal form | **Train for a goal** sheet (3 chip rows + 1 field) | LS |
| `activity` | Notifications feed | Same | S |
| `billing` | Membership, fees, disputes, Stripe, refresh | Settings › Membership & fees, status-first; Fee sheet; Membership gate | S + LS + CS |
| `verify` | Both tiers, states, dev stand-in | Onboarding step 6 · just-in-time Verify gate · Settings › Verification | M / CS / S |
| `report` | Reasons, note, block | **Report** sheet (opens full); Block = confirm | LS / CS |
| `blocked` | List, Unblock | Settings › Blocked; Unblock inline with Undo toast | S |
| `welcome`, `app-terms` | Terms gist, what you do, level, Apple Health, the deal | Onboarding steps 1–4 and 8; steps 5–7 new | M |
| `delete-account`, `sign-in`, `invite/[code]`, `open`, `billing-return`, `verified`, `+native-intent`, `Suspended` | Handlers and blocking states | Unchanged; returns land on the matching Settings page | S |

---

## 3. The surfaces

Shared rules: tab roots use `AppHeader`; pushed Screens use the glass navigation header; content
sits on `Backdrop`. Loading = `Skeleton` at the final heights (no layout jump). Error =
`StateView error` with **Try again**. Offline = cached content, primary disabled with "You're
offline". One `Screen footer=` at most. `Notice` is for errors only.

### 3.1 Home — `(tabs)/index` · Screen

**Job:** what needs me, how is my day, what is next. **Pinned:** the docked message box.

```text
┌──────────────────────────────────┐
│ SamePace                  bell•  │
├──────────────────────────────────┤
│ Good morning, Ish                │
│ ╭ NEEDS YOU ─────────── 1 of 3 ╮ │
│ │(o) A plan is ready           │ │
│ │    Easy run · Tue 6:30 AM    │ │
│ │ [ Later ]        [ Review ]  │ │
│ ╰──────────────────────────────╯ │
│ ╭ TODAY · our read ──────────  ›╮│
│ │ (dial)  A steady day          ││
│ │ Slept a little less than usual││
│ │ (7h 10)(52 bpm)(HRV 48)(4.1k) ││
│ ╰───────────────────────────────╯│
│ ╭ NEXT UP ─────────────────────╮ │
│ │[photo] Thu 6:30 AM · Run     │ │
│ │ with Maya     [ Open plan ]  │ │
│ ╰──────────────────────────────╯ │
│══════════════════════════════════│
│ (Find an easy run) (My day)      │
│ │ Ask your assistant…    (mic) │ │
└──────────────────────────────────┘
```

- **Order.** Today leads whenever nothing needs the member (the usual case): greeting → Today →
  Next up → a one-line assistant strip. When something needs them, the Needs-you card takes the
  top slot and Today follows, as drawn.
- **The fit rule.** First-screen height = window − top inset − header (64) − dock − tab bar; the
  cards sit in one centred `View`. Nothing in it scrolls or clips, **measured after Dynamic Type
  scaling**. Drop order when short: (1) suggestion chips; (2) Next up collapses to one row;
  (3) Today's reason line; (4) Today's pills. Needs you never shrinks. "Coming up", "Every week",
  "At your level", "Your training" start exactly one screen down.
- **Today card.** Eyebrow **"Today · our read"** so nobody mistakes it for Apple's. `DayDial` + the
  word + `ourRead.because` in one line + up to four reading pills *inside* the card. No chart on
  Home. Tap → **Today sheet**.
- **Needs you** (`NeedsYouCard`) merges, in priority order: check-in open → assistant invite →
  plan ready / booking to accept → join requests → goal wrap-ups → set-up items (name, level,
  notifications, "Meet your assistant"). Shows the first; "1 of 3" opens the list. **Review** opens
  the **Plan peek over Home**; join requests keep **Approve / Decline** inline.
- **Docked message box** (`HomeDock`) is a doorway, not a second chat: focusing it or tapping a
  chip switches to the Assistant tab with the text carried over. It never opens a sheet.
- **States.** Nothing needs you → strip `(o) Looking for your run buddy · 2 people fit ›`;
  assistant off → `(o) Set up your assistant ›`. Nothing planned → `ActionCard` "Nothing planned
  this week" · (Steady day) (Run) · **Find me a buddy** · secondary **Post a session**. Apple
  Health not connected → one row "Connect Apple Health to see your day ›"; unavailable → slot
  omitted. Error → `StateView` + "Saved workouts on this iPhone". Offline → cached, dock disabled.
- **Kit:** `Screen hidesTabBar`, `AppHeader`, `LiveBanner`, `NeedsYouCard`, `AssistantOrb`,
  `TodayCard`, `DayDial`, `PhotoCard`, `ActionCard`, `HomeDock`, `SuggestionChips`, `ListRow`,
  `SessionCard`, `TrainingBlockCard`, `OverflowMenu`.
- **Sheets (4):** Today · Needs-you list · Plan peek · Train for a goal. Leave weekly session uses
  the shared `ConfirmSheet`; the Name item uses the app-wide Name sheet.

### 3.2 Assistant — `(tabs)/agent` · Screen

**Job:** say what you want; approve what it proposes. **Pinned:** the composer, mic inside it.

```text
┌──────────────────────────────────┐
│ (o) Assistant            [···]   │
│     Looking · 2 people fit   ›   │
│ [ Chat ][ Plans •1 ][ Buddies ]  │
│ A plan with Maya is ready·Review │
├──────────────────────────────────┤
│       I have forty minutes before│
│       work — find an easy run  me│
│ (o) Tomorrow, 6:30–7:10 AM near  │
│     Katy Trail? Two people fit.  │
│  ╭ Invite Maya? ───────────────╮ │
│  │ Run · Steady · Verified     │ │
│  │ (Tue 6:30 AM) (Katy Trail)  │ │
│  │ She sees your first name,   │ │
│  │ level and these times only. │ │
│  │ [ Not now ]  [ Invite Maya ]│ │
│  ╰─────────────────────────────╯ │
│     SamePace cloud               │
│══════════════════════════════════│
│ (Tomorrow works) (Later today)   │
│ │ +  Message your assistant (mic)│
└──────────────────────────────────┘
```

- **Header.** `AssistantStatusBar` — `AssistantOrb size=32`, "Assistant", one status line from
  `assistantStatus()`; tap → `assistant/looking-for`. One name everywhere: **Assistant** (never
  "coach", "Workout assistant", "Buddy planning").
- **`[···]`** — What you're looking for · **Where it thinks** ▸ SamePace cloud ✓ / On this iPhone ·
  Pause assistant (Undo toast) · Delete conversation (confirm) · Assistant settings. **This menu
  and Settings › Assistant are the only places on-device vs cloud is chosen;** every assistant
  bubble says which one spoke (`source`).
- **`Segmented` Chat · Plans · Buddies.** All panes stay mounted; switching never clears the draft
  or a streaming reply. The composer shows on Chat only.
- **Thread.** `ChatBubble`s, newest at the bottom; `TypingDots`; `CoachNotes` for long prose; plan
  changes arrive as system lines ("Maya approved the plan").
- **Approve-first cards** sit in the assistant bubble's `footer` as `ActionCard`s: title as a
  question, fact chips, one line on what yes shares or does, **primary = the yes**, secondary "Not
  now". After the tap the card collapses (220 ms) to a receipt — "Invited Maya · 8:02 AM" — and
  the outcome is posted. The set: *Here's what I'll look for* → **Start looking** · *Invite Maya?*
  → **Invite Maya** · *A plan is ready* → **Review** (Plan peek) · *Book it?* → **Review and book**
  (peek at terms) · *Join this session?* → **Join** · *Post this session?* → **Post session** /
  Edit first · *Sam asked to join* → **Approve** / Decline · *Log this?* → **Save to my log** ·
  `WorkoutPlanDraftCard` → **Review** (read-only sheet → **Save & start**) · recap card (lock
  glyph). All but the draft card are **[F]** (§10.1). A card opens at most one sheet.
- **`NeedsYouStrip`** under the segments when something waits → Plan peek.
  **`SuggestionChips`** (max 3): replies when the assistant asked; otherwise "Find me a buddy",
  "What's my day look like?", "Draft a workout".
- **Composer.** Leading **+** (`OverflowMenu`: Photo of a workout · Take a photo · Paste a note) ·
  "Message your assistant" · trailing **mic** when empty / **send** with text / **stop** while
  streaming. Pinned by `ComposerDock`; rides the keyboard.
- **States.** First run → the scripted conversation (§3.16). Empty → orb at 64, "What are you up
  for?", three starters. Cloud off → "The cloud assistant is off · Turn on in Settings ›". Cloud
  unreachable → system line + chip **Use this iPhone**. On-device unavailable → the reason + **Use
  SamePace cloud**. A turn failed → "That didn't go through" + **Try again**. Stopped reply → text
  kept, caption "Stopped". Offline → composer disabled, thread readable.
- **Plans pane.** `PlanFeedCard` rows under **Needs you · In progress · Booked · Ended** → push the
  Plan screen. Empty: "No plans yet" · **Find me a buddy**.
- **Buddies pane.** Status hero ("Looking for a run buddy · until Sun 28 Sep" / "Not looking").
  **People who fit** cards (name, activity, places in common; level and show-up record **[F]**)
  with **Invite**. **Past buddies** with **Plan again**. Row "Verify it's you to be introduced ›"
  when needed. Pinned **Start looking** (consent sheet) / "Looking until Sun 28 · **Stop**" (Undo).
- **`assistant/looking-for` · Modal, one page,** Cancel / **Save**, discard guard. Chip groups
  **What** · **How long** (30 · 45 · 60 · 90) · **Where** (meeting points) · **When**
  (`DayTimeChips`: days × Before work / Lunch / After work / Evening) + one optional field
  "Anything your buddy should know?". Maps to `PUT /agents/preferences`.
- **Sheets (4):** Plan peek · Draft review · Start looking · Invite. **Kit:** `AssistantStatusBar`,
  `Segmented`, `NeedsYouStrip`, `ChatBubble`, `ActionCard`, `SuggestionChips`, `Composer`,
  `ComposerDock`, `PlanFeedCard`, `OverflowMenu`, `UndoToast`.

### 3.3 Plan screen — `assistant/plan/[id]` · Screen (pushed)

**Job:** decide on one plan with one buddy. **Pinned:** one button whose label is the next step.
Reached from the Plans feed, a push notification, "Open full plan" in the peek, and redirects.

```text
┌──────────────────────────────────┐
│ ‹        With Maya        [···]  │
├──────────────────────────────────┤
│ Joined ● Plan ● Approved ○       │
│        Terms ○ Booked ○          │
│ ╭ [photo: Katy Trail] ─────────╮ │
│ │ PROPOSED                     │ │
│ │ Easy run · 40 min            │ │
│ │ Tue 23 Sep · 6:30 AM         │ │
│ │ Meeting point: Katy Trail N  │ │
│ ╰──────────────────────────────╯ │
│ (You ○ not yet) (Maya ● approved)│
│ Both of you approve before       │
│ anything is booked.              │
│ Other times that fit both     ›  │
│ Let our assistants work it out   │
│               On until Tue 6 PM› │
│ What's happened               ›  │
│ Open until Wed 24 Sep, 8 AM      │
│══════════════════════════════════│
│ [ Suggest another ] [ Approve ]  │
└──────────────────────────────────┘
```

**Pinned button by state:** invited → **Join planning** (note: "Maya sees your first name, level
and the times you allow — never your health data") · joined, no plan → **Find times that fit
both** · plan from the buddy → **Approve** (+ Suggest another) · you approved → disabled "Waiting
for Maya" · both approved → terms appear as fact chips above the button — (You host) (Free to
cancel until 12 h before) ($5 late cancel) ($10 no-show) (Nothing charged today) — and the button
is **Accept and book** · booked → **Open session** · ended / ran out of time → **Plan again**.
One deliberate tap *is* the confirmation: button → check → success haptic → receipt in the chat.

**Rows → sheets:** Other times that fit both (LS) · Let our assistants work it out (CS) · What's
happened (LS). **`[···]`:** End this plan (confirm: "Ends planning with Maya. A booked session
stays booked.") · Report Maya. Three sheets of its own plus the shared confirm — at the budget;
nothing else may be added here.
**States:** skeleton of track + card; error with Try again and **End this plan** still in the
menu; meeting point no longer offered → button disabled with one line why.
**Words never shown:** negotiation, revision, counterproposal, consent, participant.
**Kit:** `PlanTrack`, `PlanCard`, `Approvals`, `ListCard`, `ListRow`, `Tag`, `OverflowMenu`.

### 3.4 Plan peek · Large sheet (half), childless

Opens from **Review** on a chat card, the `NeedsYouStrip`, or Home's Needs-you card. The
conversation (or Home) stays legible behind it.

```text
┌──────────────────────────────────┐
│ (chat, dimmed but readable)      │
│            ────                  │
│ Plan with Maya              (×)  │
│ Joined ● Plan ● Approved ○ …     │
│ ╭ [photo] Easy run · 40 min ───╮ │
│ │ Tue 23 Sep · 6:30 AM         │ │
│ │ Katy Trail North lot         │ │
│ ╰──────────────────────────────╯ │
│ (You ○ not yet) (Maya ● approved)│
│ Open full plan                 › │
│══════════════════════════════════│
│ [          Approve          ]    │
└──────────────────────────────────┘
```

Contents: `PlanTrack`, `PlanCard`, `Approvals`, the terms chips when booking, one pinned button
(same state machine as §3.3, minus "Suggest another"). **No rows that open anything.** "Open full
plan" closes the sheet, then pushes the Plan screen. Both surfaces render one shared
`PlanSummary` component so they cannot drift. Dismissal is always free.

### 3.5 Find — `(tabs)/sessions` · Screen, and Post — `post` · Modal

**Find. Job:** browse sessions at my level. **Primary:** the card itself; header button **Post**.

```text
┌──────────────────────────────────┐
│ Find                  [ + Post ] │
│ (All)(Run)(Ride)(Gym)(Hike) ›    │
│ (My level)(Before 10)(Fill-in) › │
├──────────────────────────────────┤
│ TRAIN FOR A GOAL              ›  │
│ [goal card] [goal card] [goal…   │
│ TODAY                            │
│ ╭ [photo] 6:30 PM · Easy run ──╮ │
│ │ Katy Trail · Fits you        │ │
│ │ Maya ✓ Verified · 2 spots    │ │
│ ╰──────────────────────────────╯ │
│ [ Show 4 more at other levels ]  │
└──────────────────────────────────┘
```

Filters are a **second inline chip row**; results update live; there is no Filters sheet (revisit
only if filters pass six or gain a range). **Empty:** an assistant `ActionCard` — "Nothing at your
level for Run this week" · (Run) (Steady) (Mornings) · **Ask my assistant to find a buddy** ·
secondary **Post a session**; "Show other levels" / "Clear filters" stay as text links. Level
missing → row "Set my level to see what fits ›" → Level sheet. **Sheets (1):** Level. **Kit:**
`Chip`, `ChipRow`, `SessionCard`, `TrainingBlockCard`, `SectionTitle`, `ActionCard`, `StateView`.

**Post · full-screen Modal, four steps, `StepDots`.** × Close top-left (asks "Discard this
session?" when dirty); no swipe-to-dismiss. 1 **What** (one session / train for a goal; activity;
how hard; "Any level welcome") → 2 **When** (`DayTimeChips`: day, start time · Dallas, how long) →
3 **Where** (meeting-point `PhotoCard`s) → 4 **Who and name** (how many buddies, who can see it,
how people join, women-only, session name, details). Pinned **Next**, then **Post session** /
**Post the goal** / **Add weekly session**. Step 1 link: "Tell the assistant instead". No slogans.
A `verify_member` refusal opens the Verify gate, a membership refusal the Membership gate; the
form is kept. **Sheets (2):** Verify gate · Membership gate.

### 3.6 Session detail — `session/[id]` · Screen (the reference Detail)

**Job:** decide to join, or get ready. **Pinned:** **Join** / **Ask to join** / **Check in** /
**Chat with Maya** — one, by state ("Full" is disabled).

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
│══════════════════════════════════│
│ [          Join          ]       │
└──────────────────────────────────┘
```

**Join rule.** More than 12 hours out: one tap joins; the footer becomes its success state and a
toast says "You're in. Free to leave until Mon 6:30 PM." — no confirm, no fee talk. **Inside the
12 hours:** a compact sheet — "Join Easy run before work?" · "It starts in under 12 hours, so
leaving after you join costs $5 (waived if someone takes your spot)." · **Join** · Cancel. That is
the only place the $5 line appears on Join.
Facts are `MetricTile`s. A host's join requests sit at the top with **Approve / Decline** inline.
`[···]`: Ask the assistant · Leave (confirm with the fee line when it applies) · Cancel session
(host, confirm) · Manage this goal · Report. **States:** ended → tags + **How was it?**; not
available → `EmptyState`.
**Sheets:** none of its own — the shared `ConfirmSheet` (Join inside 12 h · Leave · Cancel) and the
app-wide Host record, Verify gate, Membership gate, Report and Ask sheets.
**Kit:** `PhotoCard`, `Tag`, `MetricTile`,
`Avatar`, `PlanRow`, `ListRow`, `OverflowMenu`, `ConfirmSheet`, `UndoToast`.

### 3.7 Live check-in — `live/[id]` · Modal (full screen)

**Job:** prove you are both there. **Pinned:** **Check in**.

```text
┌──────────────────────────────────┐
│ × Close                     (i)  │
│                                  │
│           120 m                  │
│     from the meeting point       │
│                                  │
│     Katy Trail North lot         │
│   Check-in open until 6:45 AM    │
│                                  │
│    (● You)         (○ Maya)      │
│     not yet         on her way   │
│                                  │
│ Open workout plan             ›  │
│ Use a backup code             ›  │
│ Open in Maps                  ›  │
│══════════════════════════════════│
│ [        Check in         ]      │
└──────────────────────────────────┘
```

`BigNumber` = distance ("Here" inside the fence; "—" while finding you), inside a `ProgressRing`
that closes as you approach. **States:** not open → countdown "Opens in 18 min", button disabled ·
location off → "Location is off", button **Open Settings**, backup-code row promoted · closed →
the reason · **both in** → `SuccessMark`, "You're both here", button **Start our workout** (if a
plan is attached) or **Done**. **Sheets (3):** What counts (`(i)`, CS) · Backup code (CS on the
number pad: "Your code 4 8 2 1" as `BigNumber` + one 4-digit field that submits on the fourth
digit) · **Rate your buddy** (CS: two Yes / No chip rows "On time?", "Would you join again?" ·
**Send** → the *same* sheet becomes one offer: "Same time next week with Maya?" **Make it weekly**
· Train for a goal together · Not now). The private recap is a card in the Assistant thread,
never a third overlay. System edge gestures deferred; Android Back = Close.

### 3.8 Workout in progress — `workout-run/[id]` · Modal (full screen)

**Job:** do the next set. **Pinned:** one control whose label changes with the state.

```text
┌──────────────────────────────────┐
│ × Close   Leg day    5/14 [···]  │
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░    │
│                                  │
│ GOBLET SQUAT · SET 2 OF 3        │
│          8 reps                  │
│          40 kg                   │
│   target 8 × 40 kg               │
│   [ − ]  8 reps  [ + ]           │
│   [ − ]  40 kg   [ + ]           │
│                                  │
│ How to do it                  ›  │
│ Skip this set                    │
│ NEXT  Romanian deadlift 3 × 10   │
│ On this iPhone · syncs later     │
│══════════════════════════════════│
│ [       Done — set 2       ]     │
└──────────────────────────────────┘
```

**Pinned control:** set → **Done — set 2** · resting → `BigNumber` countdown with `RestTimer`,
control **Skip rest** · timed set → `BigNumber` stopwatch (`ExerciseTimer`), **Start** → **Stop**
→ elapsed shown for review → **Save set** · last set → **Finish workout**. Targets sit under the
number in `textSecondary` so planned and actual are never confused; a missing actual stays "—".
Mid-set nothing may cover the number. `[···]`: All sets · Private note · Share my set counts with
Maya · Our plan and progress (closes → pushes) · Sync now · Finish early · Delete this workout
record. **Close** never loses work: toast "Your workout is saved. Continue any time."
**Offline** is the status line under NEXT, never a `Notice`. **Must-answer prompts** — "Changes
from another device" and "Recover unsaved entries" — are compact sheets with two buttons, no
Close, no swipe, no tap-outside. **Sheets (4):** How to do it (LS) · All sets (LS, autosaves per
field) · Finish workout (CS) · one slot shared by Private note / Share set counts / Delete /
must-answer (`ConfirmSheet`-shaped). **Kit:** `BigNumber`, `Stepper`, `RestTimer`,
`ExerciseTimer`, `SetFields`, `OverflowMenu`.

### 3.9 Chats and thread — `(tabs)/inbox`, `thread/[id]` · Screens

Chats: `Avatar` + session title + last line + time; unread dot. Empty: "No chats yet" · **Find a
session**. Thread: `ChatBubble`s, quick-reply chips, pinned `Composer` (mic = dictation only —
this is person to person), header button **Check in** / **How was it?**, `[···]` Report · Block.
Assistant help here is **chips** ("Suggest a time", "Where should we meet?") that draft text into
the thread's own input for the member to send. No second composer; the assistant never reads or
posts in this thread. **Sheets (2):** Report · Block.

### 3.10 Training hub — `training` · Screen with four segments

**Job:** my day, what I did, what I'll do. Lock glyph in the header: "Private to you". **Pinned,
by segment:** Day → **Ask about my day** · Log → **Log an exercise** · Workouts → **Start a
workout** · Plans → **New workout plan**.

```text
┌──────────────────────────────────┐
│ ‹  Training  (lock)       [···]  │
│ [ Day ][ Log ][Workouts][Plans]  │
├──────────────────────────────────┤
│        (  DayDial 160  )         │
│       Steady · our read          │
│   Slept a little less than       │
│   your week.                     │
│ HEART TODAY                      │
│ ▁▂▃▅▃▂▂▃▆▇▅▃▂▁                   │
│ ┌ Sleep ──────┐ ┌ Resting HR ──┐ │
│ │ 7h 10 ▓▓▒▒░ │ │ 52 bpm ▂▃▂▃  │ │
│ └─────────────┘ └──────────────┘ │
│ ┌ HRV · SDNN ─┐ ┌ HRV · RMSSD ─┐ │
│ │ 48 ms  ▃▄▃▅ │ │ 41 ms  ▃▃▄▅  │ │
│ └─────────────┘ └──────────────┘ │
│══════════════════════════════════│
│ [     Ask about my day      ]    │
└──────────────────────────────────┘
```

- **Day** = `TodayDetail` rebuilt from exported `MetricTile`s + today's workouts. Tile tap →
  Metric sheet. Not connected → dial unlit · **Connect Apple Health**.
- **Log** = `FitnessSummary` + `LogCard` feed. **Log an exercise** sheet (§4, moment 5). An imported
  draft is an `ActionCard` at the top ("From your plan — confirm what you actually did"). Delete
  = swipe + Undo **[F]**; interim confirm sheet.
- **Workouts** = one chronological feed of Apple Health workouts and finished workout runs, tagged
  (Apple Health) / (Logged here), each with a mini zone `StageBar`. While the Watch records: a live
  tile. **Start a workout** → plan picker sheet → the workout Modal.
- **Plans** = `PlanRow` feed; device copies tagged (On this iPhone) with sync state. Swipe or
  `[···]` → Remove this device copy / Delete plan.

**Sheets (4):** Metric · Log an exercise · Start a workout · Ask the assistant.

### 3.11 Workout, plan and shared-plan details

- **`workout/[id]` · Screen.** Hero `MetricTile`s (time, distance, energy, average HR), zones
  `StageBar` + minute chips, heart `AreaChart`. Rows → sheets: Fix the name or type (CS) · How did
  it go? (LS, opens full, one note field) · Recap on this iPhone (LS, read-only) · Log the sets I
  did (the Log sheet, prefilled). Pinned **Ask about this workout**. `[···]`: Remove workout. Four
  sheets of its own — at the budget.
- **`workout-plan/[id]` · Screen.** `PlanPreview` + `PlanTimingSummary`; pinned **Start my
  workout** (or **Share with our session**). `[···]`: Edit plan · Attach to a session (CS picker)
  · Delete plan.
- **Workout-plan editor · full-screen Modal** (`workout-plan/new`, `workout-plan/[id]/edit`).
  New: 1 **How?** — Describe it · Photo or note · By hand → 2 **Review and edit** (`PlanEditor`,
  `PlanTimingSummary`). Pinned **Save & start**, secondary "Save for later". Close asks "Discard
  this plan?" when dirty. Pickers expand inline.
- **`session-workout/[id]` "Our workout" · Screen.** `PlanPreview`; "Our progress" as two
  `ProgressRing`s (set counts only, only if each person shares); pinned **Start my workout** /
  **Continue** / **Review my workout**; none yet → **Choose a workout plan** (picker sheet).
  `[···]`: Save a copy for next time (toast) · Swap plan · Remove plan from session (confirm).

### 3.12 Goal — `training-block/[id]` · Screen

Photo hero with tags, goal title, `ProgressRing` "6 of 8 kept", weeks to go; Every week; Training
together with requests **Approve / Pass inline** (toast receipt). The wrap-up ("Who helped you
stick to it?", keep the weekly sessions?) is a section at the top of this screen with Yes / No
chips — not an overlay. Pinned **Join — every week** / **Ask to join** / **Share invite link**.
`[···]`: Add a weekly session · Start one like it (Train for a goal sheet) · Leave this goal
(confirm).

### 3.13 You — `(tabs)/you` · Screen

**Job:** who I am here. **Pinned:** none; header gear → Settings.

```text
┌──────────────────────────────────┐
│ You                      (gear)  │
├──────────────────────────────────┤
│   ( rings )   Ish P.  ✓ Verified │
│   (  IP   )   14 sessions        │
│               96% on time        │
│ (3 goals finished) (Helped 2)    │
│ (2 free sessions) ($10 credit)   │
│ YOUR LEVEL                       │
│ (Run · Steady) (Gym · Building) +│
│ GOALS   [goal card] 10K Nov 6/8  │
│ YOUR TRAINING                    │
│ ╭ This week ▂▅▃▆▂▁▄ 3 workouts ─╮│
│ │ Day · Log · Workouts · Plans ›││
│ ╰───────────────────────────────╯│
└──────────────────────────────────┘
```

Level chip → Level sheet. Status `Badge`s (never red unless the account is paused) → a compact
explanation linking to Membership & fees. Tap the name → Name sheet. Everything else that lived
here moved to Settings. **Sheets (3):** Level · Name · status explanation. **Kit:** `TrackRings`,
`Avatar`, `Badge`, `Chip`, `TrainingBlockCard`, `WeekBars`.

### 3.14 Settings — `settings` · Screens (the only text-and-toggle area)

```text
┌──────────────────────────────────┐
│ ‹ Settings                       │
├──────────────────────────────────┤
│ ASSISTANT                        │
│ What you're looking for    Run › │
│ Assistant              Looking › │
│ PRIVACY & AI                     │
│ What your assistant can use    › │
│ APPLE HEALTH         Connected › │
│ ALERTS  Notifications · Location │
│ SAFETY  Verification · Women-only│
│         sessions · Blocked (2)   │
│ MEMBERSHIP & FEES  Free for now ›│
│ YOUR DATA  Export Apple Health · │
│            Export fitness data   │
│ APPEARANCE  (System)(Light)(Dark)│
│ ABOUT  Help · Privacy · Terms ·  │
│        What you agreed to        │
│ ACCOUNT  Change my name ·        │
│          Sign out · Delete       │
└──────────────────────────────────┘
```

Built only from `SectionTitle`, `ListCard`, `ListRow`, `SettingRow`, `StatusHero`. Every feature
screen that lost a switch shows one line and links to the exact row here.

- **Assistant:** Pause · Where it thinks · Read replies aloud (**off by default**, **[F]**) ·
  Outside assistants › (its own Screen; the one-time key is shown **inline, once**, never in a
  sheet; Remove → confirm) · Delete conversation.
- **Privacy & AI:** the switches of §6, each with "What this means" (large sheet). Switching off
  something that deletes says so in a confirm ("This clears the conversation").
- **Apple Health:** `StatusHero` (Connected · last synced 7:42 AM · 1,204 records) · **Sync now** ·
  Sync automatically · Manage what iOS shares (opens Health) · **Stop syncing a kind of reading ›**
  (pushed list; each removal → confirm) · Open Watch recorder · Disconnect and delete. Not
  connected → hero unlit + pinned **Connect Apple Health**.
- **Notifications:** `StatusHero` (On for this phone / Off / Off in iOS Settings → **Open
  Settings**), then per-kind switches. **Location:** status + Open iOS Settings.
- **Verification — status-first.** Hero: **Not verified yet** · **Being checked** ("A person is
  looking at it. You'll get a notification.") · **Didn't go through** ("Usually the light or a
  blurry photo.") · **Verified** ("Buddies see 'Verified' by your name. Nothing else."). Rows:
  Phone and face · Government ID ("Needed for women-only sessions") · Who sees what · Privacy.
  Pinned **Verify now** / **Continue** / **Try again** / **Verify your ID** / none. Not open on the
  server → "Not open yet · nothing is locked". Persona runs in its own hosted flow.
- **Membership & fees — status-first.** Hero: **Free right now** ("Fees are recorded. Nothing is
  charged to a card today.") · **Active · renews 20 Oct** · **Ends 20 Oct** · **Payment needs
  attention** (the only danger tone; pinned **Fix in Stripe**) · **No membership** (pinned **Start
  membership — $12 a month**). Three `MetricTile`s: Free sessions · Credit · Fees. A fee row →
  Fee sheet. Pull to refresh = refresh payment status.
- **Terms · Privacy** open in the in-app browser; **What you agreed to** is a pushed Screen
  (`AppTermsReview`). **Sign out** → confirm. **Delete account** → its own Screen, type the word.

### 3.15 Small screens

Notifications (`activity`): feed rows → their target; empty "Nothing yet". Sign-in, link and
return handlers, the paused-account state: unchanged; returns land on the matching Settings page.

### 3.16 Onboarding — one full-screen Modal, eight steps, then the first conversation

`StepDots total=8` on every step (one count, in both files). Each step: a drawn hero, a title, at
most three short lines, a pinned primary, a quiet secondary. About two minutes without
verification. Accepted once, never shown again.

| # | Step | Required? | Primary · secondary |
| --- | --- | --- | --- |
| 1 | Before you start — 4 plain points; "Read the full notice" (LS); Terms · Privacy (browser) | Required | **Agree and continue** · Not now — sign me out |
| 2 | What do you do? (+ first name if missing) | **Required** | **Next** |
| 3 | At what level? | **Required** | **Next** · Back |
| 4 | Bring your Apple Health — one button asks for everything | Skippable; auto-skipped when unavailable or connected | **Connect Apple Health** · Not now |
| 5 | Set up your assistant — every opt-in, plain words | Screen required; each switch optional | **Continue** |
| 6 | Get verified (Persona) | Skippable; returns at first Join / Post | **Verify now** · Later |
| 7 | Stay in the loop — notifications, location while checking in | Skippable | **Continue** (each row has **Turn on**) |
| 8 | How showing up works — check in on arrival · free to cancel until 12 h before, then $5 · no-show $10 and a strike · "Free right now — nothing is charged." | Required | **Got it — meet my assistant** |

**Step 4 invites; it cannot enforce.** iOS hides whether read access was denied, and App Store
rules forbid forcing data the app does not need. "Not now" simply continues; the offer returns as
one row on Home's Today slot.

**Step 5**

```text
┌──────────────────────────────────┐
│ ● ● ● ● ◉ ○ ○ ○                  │
│              (o)                 │
│      Set up your assistant       │
│ It finds a buddy at your level   │
│ and sets things up. You approve  │
│ every step.                      │
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
│ What each of these means       › │
│══════════════════════════════════│
│ [        Continue         ]      │
└──────────────────────────────────┘
```

Caption under the list: "Your Apple Health data never reaches a buddy or their assistant."
**Existing members** who finished `welcome` get a Needs-you item "Meet your assistant"; tapping it
opens this same full-screen step, showing their current choices — never an unprompted sheet.

**Step 6** — "Buddies meet strangers. The Verified mark tells them you're a real, reachable
person." · About a minute, once · A text, then a short selfie · Persona runs the check; SamePace
never sees the photo — only whether it passed. Returns to the step with the hero state, then
**Continue**. Government ID is never asked in onboarding. Verification not open → step skipped.

**Payment is never asked here.** When collection is on, the Membership gate appears at the first
Join, Post or Accept and book that needs it (§3.17).

**First conversation** (not a dot — it is the app). Lands on Assistant › Chat: "Hi Ish. You run
at a steady level. When do you usually have time?" → chips (Before work) (Lunch) (After work)
(Weekends) → "Where's easy for you?" → meeting-point chips → "How long?" → (30) (45) (60) → an
`ActionCard` "Here's what I'll look for" · (Run) (Steady) (Before work) (Katy Trail) (45 min) ·
**Looks right — start looking** · Change. Until the chat tools ship this is a client-side script
(`FirstRunScript`) writing `PUT /agents/preferences` and `PUT /agents/discovery` on the approve
tap; free text at any point hands over to the real assistant.

### 3.17 The sheet catalogue

Dismissal: **free** = Close, header swipe, tap-outside, Back / VoiceOver escape · **guarded** =
free until dirty, then only Close → "Discard?" · **locked** = two buttons, nothing else.

**Compact sheets**

| Title | Opened by | Contents | Primary | Dismissal |
| --- | --- | --- | --- | --- |
| Join *session*? | Join inside the 12-hour window | The $5 sentence | **Join** | free |
| Leave this session? / Cancel this session? | Session `[···]` | Consequence; fee line when it applies | **Leave** / **Cancel session** (danger) | free |
| Leave weekly session? / Leave this goal? | Row menu / goal `[···]` | Consequence, fee line | **Leave** (danger) | free |
| Verify it's you to join | A `verify_member` / `verify_government_id` refusal | 3 lines on what and why | **Verify now** → Persona; the action resumes | free |
| Keep showing up (Membership gate) | A `membership_required` refusal **[F]** | "$12 a month. Cancel any time in Stripe. SamePace never sees your card." | **Continue to Stripe — $12/mo** | free |
| Look for a buddy | Buddies footer | What buddies see, "for 7 days", women-only chip | **Start looking** | free |
| Invite Maya? | Buddies card | A miniature of exactly what she sees | **Invite Maya** | free |
| Let our assistants work it out | Plan screen row | Both statuses; "Suggestions only" | **Allow for 24 hours** / Ask now / Stop | free |
| End this plan? | Plan `[···]` | "A booked session stays booked." | **End plan** (danger) | free |
| Delete conversation? | Assistant `[···]`, Settings | What is cleared | **Delete** (danger) | free |
| What counts as checking in | Live `(i)` | 3 lines | — | free |
| Backup code | Live row | Your code; one 4-digit field | auto-submits | free |
| Rate your buddy → one offer | After a session; **How was it?** | Two Yes / No rows → "Same time next week?" | **Send** → **Make it weekly** | free |
| Finish workout | Pinned control; `[···]` Finish early | Done / skipped / time, counted up once | **Finish and save** · Keep going | free |
| Private note | Workout `[···]` | One field, autosaves | — | free |
| Share my set counts with Maya | Workout `[···]` | One switch + what is shared | — | free |
| Changes from another device · Recover unsaved entries | On arrival at a workout | The two existing choices | both are buttons | **locked** |
| Delete / remove (log, workout, plan, device copy, plan from session, workout record) | Swipe or `[···]` — **interim until soft-delete [F]** | What is lost | **Delete** (danger) | free |
| Fix the name or type | Workout row | Chips + one field | **Save** | guarded |
| Attach to a session | Plan `[···]` | Your upcoming sessions | tap a row | free |
| Change my name | Name on You, Settings, Needs you | One field on the keyboard | **Save** | guarded |
| Credit / strike / pause | Badges | One sentence + link | — | free |
| Women-only sessions | Settings › Safety | Choice chips + what it requires | **Save** | free |
| Turning this off clears… | A `SettingRow` that deletes | What is cleared | **Turn off** (danger) | free |
| Disconnect Apple Health · Stop syncing *readings* · Remove key · Block · Sign out | Settings, menus | Consequence | the verb | free |
| Talk to your assistant (mic primer) | First mic tap **[F]** | "Your voice is turned into text on this iPhone." | **Allow microphone** | free |

**Large sheets**

| Title | Opened by | Contents | Primary | Dismissal |
| --- | --- | --- | --- | --- |
| **Today** | Today card on Home | Dial, our read and reason, heart today, six reading tiles with week sparklines (not tappable); "Open your day" closes → `/training?tab=day` | — | free |
| **Plan with Maya** (peek) | Review on a card / strip / Needs you | §3.4 | the next step | free |
| Needs you | "1 of 3" | The same cards; rows act in place or close-then-push | per row | free |
| Metric (Sleep, HRV…) | Tile on Day | Large chart, today vs your week, no advice | — | free |
| Log an exercise / Edit | Pinned on Log; `LogCard`; imported-draft card | Opens full, keyboard up; one field + mic → steppers in place; time chip "Just now" expands inline | **Save exercise** | guarded, `keepMounted` |
| Start a workout | Pinned on Workouts; "Choose a workout plan" | `PlanRow`s, last used first | tap a row | free |
| Draft review | `WorkoutPlanDraftCard` | Read-only `PlanPreview`; "Edit" closes → editor Modal | **Save & start** | free |
| Other times that fit both | Plan screen | A `PlanCard` per option | **Propose this** | free |
| What's happened | Plan screen | `TimelineItem`s | — | free |
| Set your level | Level chips, Find row, Needs you | Per activity, description under each; chips behind update live; "Saved" by the title | — (selection saves) | free |
| Host / buddy record | Host row, candidate card, join request | Sessions, on time, would join again, level | — | free |
| Ask the assistant | `[···]`, pinned "Ask about…" | Context chip, last two turns, chips + composer; **two turns, then "Continue in Assistant"**; cards act in place or close-then-navigate | — | free |
| How to do it | Workout row | Exercise help | — | free |
| All sets | Workout `[···]` | Every set, edit / clear; autosaves per field | — | free |
| How did it go? · Recap on this iPhone | Workout rows | One note field / read-only | **Save** / — | guarded / free |
| Train for a goal | Row menu, goal `[···]` | Three chip rows + one field | **Start training for it** | guarded |
| Report | Any `[···]` (never from a sheet) | Reason chips + one optional note; opens full | **Send report** | guarded |
| Fee | Fee row | What, session, status; review reason field | **Pay in Stripe** / **Ask for a review** | guarded |
| What this means · Read the full notice · Who sees what | `SettingRow`, onboarding, Verification | Selectable text, ≤ 2 screenfuls | — | free |

---

## 4. The eight signature sheet moments

Everything else should be quiet; these eight are where craft shows.

1. **Plan peek — approve from the conversation.** Rises to half; the chat stays legible through
   the dim. `PlanTrack` fills to the current step *as the sheet settles*, not before. On tap:
   button → check (success haptic), the sheet lowers itself after a beat, and the receipt line is
   *already* in the thread as it uncovers. When both have approved, the same peek shows the terms
   chips and **Accept and book** — nothing new to learn.
2. **Start looking — the consent.** One sentence on what buddies see, "for 7 days", one button. As
   it closes, the orb in the tab bar changes to *looking*: cause and effect both on screen.
3. **Invite — "she sees this".** The body is a miniature of exactly what the buddy will see. The
   button carries her name. Receipt line afterwards.
4. **Today and the Metric peek.** The chart draws once as the sheet rises; scrubbing gives a light
   tick per point and never moves the sheet (it drags from its header only). Pull to full for the
   week. Closing returns focus to the tile that was tapped.
5. **Log an exercise — quick capture.** Opens full with the keyboard already up and the cursor in
   "What did you do?". **Draft it for me** turns the sentence into steppers *in place* — the
   sheet's content changes, the sheet does not. Save is pinned above the keyboard. Swipe it away
   by accident and the draft is there next time, with a "Clear" link.
6. **Start a workout — the hand-off.** One tap on a plan: the sheet drops and the full-screen
   workout rises in the same motion, so it reads as the plan opening, not two transitions.
7. **Finish workout.** Sets done, skipped and total time count up once. **Finish and save** →
   `SuccessMark`, success haptic, the Modal closes onto the workout's record. "Keep going"
   restores the exact set.
8. **Set your level.** Choosing updates the one-line description immediately *and* the level chip
   on You behind the sheet — a live preview is what a sheet can do that a screen cannot. No Save
   button; a quiet "Saved" by the title.

**Common craft.** The sheet arrives from the control that was tapped (origin matters more than
spring constants; spring stays `damping 26 · stiffness 260 · mass 0.9`). A select haptic at each
detent. Content is ready before the sheet is up — **prefetch on press-in**; a `Skeleton` inside a
moving sheet looks broken. The pinned button never moves while content loads. The dim is never
darker than the screen behind needs to stay readable (0.35 at half, 0.5 at full). Glass is
`BlurView` 70 over 78% `background`; in dark the sheet is one step lighter than the page. Focus
moves to the title on open and **returns to the opener on close**.

---

## 5. The assistant everywhere

Outside its tab the assistant appears as **offers**, each approve-first. Until the chat tools ship
(§10.1) each entry opens the Ask sheet with the question prefilled and today's "Review" cards; the
layout does not change when the tools arrive.

| Where | How it appears | The offer |
| --- | --- | --- |
| Home, nothing planned | `ActionCard` in the Next-up slot | "Steady day. Want an easy run this week?" **Find me a buddy** · Post a session |
| Home dock | Chips + message box | Switches to the Assistant tab with the text carried over |
| Find, empty results | `ActionCard` replacing the empty state | **Ask my assistant to find a buddy** → "Here's what I'll look for", prefilled from the filters |
| Post, step 1 | Link "Tell the assistant instead" | *Post this session?* → **Post session** / **Edit first** (fills the form) |
| Session detail | `[···]` › Ask the assistant; chips "Does this fit my day?", "Who's the host?" | *Join this session?* → **Join** |
| A join request | "Ask about Sam" → Host / buddy record peek | **Approve** / Decline stay inline on the card |
| After a session | The rating sheet's one state change | **Make it weekly** · Train for a goal together · Not now; the recap arrives as a chat card **[F]** |
| Training › Day | Pinned **Ask about my day** | *An easy session suits today — look for one?* → **Find one** (only "easy run" reaches search) |
| Workout detail | Pinned **Ask about this workout** | *Log this?* → **Save to my log** |
| A chat thread | Chips above the composer | A draft placed in the thread's own input; the assistant never posts to a person |

**Ask the assistant** is one large sheet: orb + the context as a removable chip ("About this
session"); the last two turns; up to three chips; composer with mic. Same conversation as the tab.
**Ceiling: two turns, then "Continue in Assistant".** Never offered on the Assistant tab or in a
thread; a card in it acts in place or closes-then-navigates — it never opens the Plan peek on top.

**The conversational tool list [F]**, in priority order, each returning an approve-first card and
writing only on the member's tap: `setLookingFor` (+ start looking, one approval) →
`showCandidates` → `inviteBuddy` → `reviewPlan` → `bookIt` → `findSessions` / `joinSession` →
`postSession` → `answerRequest` → `recapSession`. Detail in §10.1–10.3.

---

## 6. Opt-ins and permissions

Asked once (onboarding steps 1, 4, 5, 7), defaulted to the useful choice, each with a one-line
consequence. "What each of these means ›" opens a Large sheet with the exact notice text per
switch (the constants in `shared/`). Nothing is re-asked; a new notice version raises **one
Needs-you item, not a wall**. Existing members keep every choice they already made.

| The member reads | Default | Maps to | Legal text | Lives afterwards in |
| --- | --- | --- | --- | --- |
| **Agree and continue** | required | `PUT /me/terms` `{version: APP_TERMS_VERSION}` | `APP_TERMS_COACHING_NOTICE`; Terms, Privacy | About › What you agreed to (read-only) |
| **Think in the cloud** — "Smarter answers. Off = only on this iPhone." | On | `/assistant/settings` `cloudEnabled` | `CHAT_CONSENT_NOTICE` | Privacy & AI; off clears the conversation (confirm) |
| **Use my workout history** — "Recent plans, logs and results, when it helps." | On | `manualWorkoutContextEnabled` + `historyUse: "when_relevant"` | same sheet | Privacy & AI, as two rows: "Use my saved plans and logs" · "Use them without me asking" |
| **Use my Apple Health workout summaries** — "Time, distance, heart-rate summary. Never sleep or HRV." | On if connected in step 4, else hidden | `fitnessContextEnabled` | `CHAT_FITNESS_NOTICE` | Privacy & AI (Settings only) |
| **Help me log workouts** — "Turns a note into sets you can edit." | On | `PUT /fitness/consent` | `FITNESS_AI_CONSENT_NOTICE` | Privacy & AI; off removes saved interpretations |
| **Help improve logging** — "Compares drafts with what you save. 30 days." | Off; Settings only | `PUT /fitness/pilot-consent` | pilot notice | Privacy & AI |
| **Let buddies see what I'm looking for** — "First name, level, times, places." | On | `PUT /agents/preferences` `enabled` | sharing notice | Privacy & AI; `[···]` › Pause |
| **Look for a buddy for me** — "For 7 days, then it asks again." | On | `PUT /agents/discovery`, written when the first conversation's card is approved | discovery notice | Privacy & AI + Buddies; renewal is a Needs-you item |
| **Let assistants work out times** — "Suggestions only. You approve." | On | Per plan: `PUT /agents/negotiations/:id/coordination` (24 h). Account-level default **[F]** | coordination notice | Privacy & AI; per plan on the Plan screen |
| **Connect Apple Health** | the member's tap | `health.connect(EVERYTHING, true)` → iOS sheet | Health notice | Settings › Apple Health |
| **Notifications** | the member's tap | `usePush().enable()` + `me.notify` kinds | — | Settings › Notifications |
| **Location while checking in** — "Only read on the check-in screen." | the member's tap | `expo-location` when-in-use | — | Settings › Location |
| **Get verified** | the member's tap | `beginVerification` (Persona hosted) | Persona + Privacy | Settings › Verification |
| **Read replies aloud** | Off | local setting **[F]** | — | Settings › Assistant |
| **Outside assistants** | Off; Settings only | `/agents/delegations` | delegation notice | Settings › Assistant › Outside assistants |
| **Microphone / speech** | first mic tap | iOS prompts **[F]** | usage strings | iOS Settings |

**Join planning and the 24-hour permission.** With the default on, the **Join planning** tap also
sends the coordination call — *only* because the button's own note says so in plain words: "Your
assistant may also suggest times to Maya's for the next 24 hours. You approve anything before it's
booked." With the default off the note and the call are both absent. Needs the functional owner's
consent-record sign-off before it ships (§10.7).

**Payment** is not an opt-in and not in onboarding. Collection is off in production; while it is
off neither the Membership gate nor the Fee sheet's **Pay** can appear, and Membership & fees
reads "Free right now".

---

## 7. Voice

- **Placement.** The mic is the trailing 44 × 44 button *inside* the composer pill in every
  assistant composer (Assistant tab, Home dock, Ask sheet, the Log sheet's field). Empty → mic;
  text → send; streaming → stop. One control, three faces.
- **Gestures.** Tap starts listening; tap again (or 1.5 s of silence) finishes and sends.
  Press-and-hold (> 300 ms) listens while held and sends on release; sliding off cancels. Haptic
  tick on start, double tick on send.
- **States.** *Idle* — mic glyph in `textSecondary`. *Listening* — the composer grows into
  `VoiceBar`: accent waveform, live transcript (partial words in `textFaint`), `[ × ]` cancel,
  `[ ■ ]` finish; the header orb pulses; chips hide; never inside a compact sheet. *Thinking* — the
  transcript becomes an ordinary "me" bubble, then `TypingDots`. *Replying* — the same bubbles and
  the same cards as typing.
- **Read replies aloud** (off by default): a reply to a *spoken* turn is read — first two
  sentences; cards announced as "I have a suggestion for you to review" — with a speaker chip to
  stop. Health numbers are never read aloud unless asked for.
- **Voice never approves.** "Yes, invite her" gets "Tap **Invite Maya** to confirm" and the card
  pulses once. Every consequential step stays a deliberate tap.
- **Errors.** First mic tap → primer sheet ("Your voice is turned into text on this iPhone") → the
  two iOS prompts. Denied → mic with a slash; tap → **Open Settings** and "or use the mic on your
  keyboard". "Didn't catch that" + **Try again**, partial transcript kept in the input. Offline →
  on-device recognition still works; the send waits or routes to this iPhone.
- **Accessibility.** Label "Talk to your assistant", hint "Double-tap to start, double-tap again
  to send"; "Listening" and "Sent" announced; transcript is a live region; waveform hidden from
  VoiceOver; Reduce Motion → static level bar, still orb. Everything voice does can be typed.
- **Works today.** Nothing in `mobile/package.json` records or recognises speech, but the iOS
  keyboard's dictation key works in every `TextInput` — so Phase 5 ships the mic button focusing
  the input with a one-time hint "Tap the mic on your keyboard to talk".
- **Needs a native module and a new EAS build [F].** In-app listening with live transcript and
  level (`SFSpeechRecognizer` + `AVAudioEngine`, on-device recognition required,
  `NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription`), and reading aloud.
- **Siri / App Shortcuts.** Three exist (`modules/samepace-intelligence/shortcuts`): "Open workout
  assistant" (rename: "Open my assistant"), "Open next SamePace workout", "Draft workout from a
  picture". Add three in the same build **[F]**, all through `open.tsx` and all landing on a
  Screen or Modal, never a sheet: **"Find me a buddy in SamePace"** → Assistant › Chat with the
  request sent · **"What's my day look like in SamePace"** → Training › Day · **"Start my workout
  in SamePace"** → the next booked session's shared plan, else the latest plan, at its first set.

---

## 8. Kit work

All presentational, tokens only (`useTheme()`, `Spacing`, `Radius`, `HitTarget`); no data or
network inside. New visuals go in kit files, not in screens (§11.2).

### 8.1 `Sheet` — close the six gaps (`components/sheet.tsx`)

| Gap | Change | Props |
| --- | --- | --- |
| Dismissal veto | When `dirty`, swipe and tap-outside rubber-band back; Close and Back call `onDiscardRequest` (native "Discard?" alert). `locked` removes Close and every gesture | `dirty?: boolean`, `onDiscardRequest?: () => void`, `locked?: boolean` |
| VoiceOver escape | `onAccessibilityEscape` on the panel → same path as Close (honours `dirty` / `locked`) | — |
| Accessible grabber | The handle becomes `accessibilityRole="adjustable"`, label "Sheet height", actions Expand / Collapse; tap steps detents | — |
| Focus move / return | Focus the title on open (`AccessibilityInfo.setAccessibilityFocus`); return to the opener on close | `returnFocusTo?: RefObject<View>` |
| Scroll-to-expand | At half, an upward scroll at the content's top expands to full before it scrolls; content drag-down only when scrolled to top | — |
| Reduce Motion | Replace `duration: 0` with a 150 ms cross-fade of panel + dim; no spring, no radius morph | — |

Also: Dynamic Type — a compact sheet that no longer fits becomes a scrolling half sheet with its
footer still pinned; a dev-only warning when two `Sheet`s are visible at once (the stacking rule,
enforced); `GlobalSheets` provider at the root for the cross-cutting ones (Verify gate, Membership
gate, Report, Block, Host record) — `openSheet(name, props)` refuses while another is up.

### 8.2 New and changed components

| Component | Props | Why |
| --- | --- | --- |
| `ConfirmSheet` | `title, body, confirm: {label, danger?}, cancelLabel?, busy?` | One shape for every consequence; replaces inline Card + Notice + two buttons and `Alert.alert` confirms |
| `OverflowMenu` | `items: {icon, label, checked?, danger?, onPress}[], accessibilityLabel` | The Inline tier: replaces alert lists and "row sheets"; 44 pt trigger; anchored glass popover |
| `UndoToast` (+ `useToast`) | `message, actionLabel?, onAction?, duration = 5000` | Receipts and Undo; announced politely; sits above the footer / tab bar |
| `SwipeRow` | `onDelete, deleteLabel, children` | Swipe-to-delete with an accessibility action of the same name; pairs with `UndoToast` |
| `BigNumber` | `value, unit?, caption?, tone?: "text" \| "accent"` | Live screens; Outfit 700, 64–96 pt, tabular figures; digits cross-fade, never roll |
| `MetricTile` | `icon, color, label, value, note?, wide?, onPress?, children` | Export of `today-card.tsx`'s private `Tile`; Day, workout, session facts, membership |
| `Stepper` | `value, step, unit, min?, onChange, label` | Reps and load without a keyboard mid-set; 44 pt halves; adjustable role |
| `DayTimeChips` | `days, slots \| hour + minute chips, value, onChange, zoneLabel` | Lift of `post.tsx`'s chip choices; replaces every typed `YYYY-MM-DD HH:mm`; expands inline, never its own sheet |
| `Composer` (extend) | `+ leading?, onAttach?, onMic?, micState: "idle" \| "listening" \| "denied"` | "+" and mic inside the one pill |
| `VoiceBar` **[F-dependent]** | `transcript, partial, level, onCancel, onFinish` | The listening face of the composer |
| `SuggestionChips` | `items: {label, onPress}[]` | Replies and starters above any composer |
| `HomeDock` | `placeholder, chips, onOpen(text?)` | Home's doorway into the Assistant tab |
| `AssistantStatusBar` | `status: AssistantStatus, onPress` | The hero at header height, on all three panes |
| `NeedsYouCard` / `NeedsYouStrip` | `items: NeedsYouItem[], onOpenAll` | One merged place for everything waiting on the member |
| `PlanSummary` / `PlanFeedCard` | `plan, buddyName, done, state, needsYou` | Shared body of the Plan screen and peek; plans as a feed |
| `StatusHero` | `icon \| dial, state, title, detail, tone` | Status-first top of Verification, Membership, Apple Health, Notifications |
| `SettingRow` / `PermissionRow` | `label, detail?, value, onValueChange, onAbout?` / `icon, title, body, status, onEnable` | `ListRow` + `Switch` with `trackColor` from tokens; onboarding step 7 |
| `FirstRunScript` | `member, venues, onApprove` | The first conversation before chat tools exist |

Used as they are: `Screen`, `Card`, `Row`, `Button`, `Chip`, `Field`, `Avatar`, `Badge`,
`EmptyState`, `StateView`, `T`, `ListCard`, `ListRow`, `SectionTitle`, `PhotoCard`, `SessionCard`,
`Tag`, `AreaChart`, `WeekBars`, `StageBar`, `DayDial`, `AssistantOrb`, `ChatBubble`, `CoachNotes`,
`TypingDots`, `ActionCard`, `Segmented`, `PlanCard`, `PlanTrack`, `Approvals`, `TimelineItem`,
`FitnessSummary`, `LogCard`, `PlanRow`, `PlanPreview`, `PlanEditor`, `PlanTimingSummary`,
`RestTimer`, `ExerciseTimer`, `SetFields`, `StepDots`, `TrackRings`, `ProgressRing`, `SuccessMark`,
`Skeleton`, `Enter`, `Appear`, `PressScale`, `ComposerDock`, `ComposerPortal`.

### 8.3 Light, dark, motion, accessibility

- **Light — glassy and classy on true white.** Page `#FFFFFF` with the faint `Backdrop` wash;
  cards are `glassSurface` (frosted white, bright `glassEdge` hairline, wide faint shadow). Real
  blur only for what floats: tab bar, headers, pinned footers, the dock, sheet chrome, menus.
  Primary buttons are `primary` green, never a black slab. Assistant cards use `accentSoft` with a
  35% accent hairline.
- **Dark — equally considered.** Near-black page, cards at ~6.5% white with a 14% edge, no shadow;
  the accent's glow does the lifting. Sheets are one step lighter than the page. The orb and the
  waveform are the brightest things on screen.
- **Both.** Contrast checked per theme for every new component — 4.5:1 text, 3:1 marks — and over
  photos and charts against the *blurred* result, not the token. Never pure black or pure white
  text. `danger` only for errors and the paused-account state.
- **Motion.** Orb breathes when ready, pulses when looking or listening, one ring-out when
  something needs you. `ActionCard` approve: button → check → receipt (220 ms). `PlanTrack` fills
  left to right. Rest countdown drains its ring. Home cards `Enter` once per focus. **Reduce
  Motion:** opacity changes or nothing; no parallax. Haptics stay: select on tab, chip and detent;
  success on approve, check-in and set done; warning on a danger confirm.
- **Accessibility.** 44 × 44 pt for every target. Every icon-only control has a label and, where
  the result is not obvious, a hint. State is never colour alone (approved = filled dot **and**
  the word; no "✓" typed into labels). Charts expose a one-sentence summary. `BigNumber` reads with
  its unit and caption as one element. Every gesture has a button equivalent. Dynamic Type to the
  largest accessibility size without clipping. Body line height 1.5.
- **Android parity.** `BlurView` only tints there, so floating chrome uses a near-opaque
  `background` fill (as the tab bar already does). Back closes the top sheet once, from any detent.

---

## 9. Build phases

**Every phase's acceptance also includes:** seen in **light and dark** on the simulator · `tsc`
clean and `expo lint` clean (until §10.10 lands: no *new* errors) · every target ≥ 44 pt ·
VoiceOver labels on every new control · Home's first screen still fits · no sheet-on-sheet (the
dev warning never fires) · agreed wording only. Each phase ships alone.

**Phase 1 — Sheet foundations and the inline kit** · Design · depends on nothing
- *Goal:* make the primitives trustworthy before anything leans on them.
- *Touches:* merge `design/sheets-and-composer`; `components/sheet.tsx` (six gaps, §8.1); new
  `confirm-sheet.tsx`, `overflow-menu.tsx`, `toast.tsx`, `swipe-row.tsx`, `lib/global-sheets.tsx`.
- *Accept:* a dirty test sheet refuses swipe and tap-outside and asks on Close; a locked one has no
  exit but its buttons; two-finger scrub closes; the grabber offers Expand / Collapse; focus lands
  on the title and returns to the opener; at half, scrolling up expands first; Reduce Motion fades
  in ~150 ms; a compact sheet at the largest text size scrolls with its footer pinned; a test
  sheet works over `live/[id]` (a full-screen modal route).
- *Not in scope:* any screen change.

**Phase 2 — Presentation corrections** · Design · depends on 1
- *Goal:* every surface uses the right one of the five types; the page sheet is gone.
- *Touches:* `app/_layout.tsx` (`post`, `workout-run/[id]` → `fullScreenModal`, no swipe; `today`,
  `verify` → pushed; `report`, `training-block/new` → component sheets + redirects); `post.tsx`
  (Close + discard guard); `session/[id].tsx` (Join rule, `OverflowMenu`, `ConfirmSheet`);
  `thread/[id].tsx`, `training-block/[id].tsx`, `leave-standing-slot.tsx`, `report.tsx`; Home
  weekly-session rows → menu; `lib/verify-gate.ts` → Verify gate sheet; interim delete confirms in
  `fitness`, `health`, `workout-plans`, `workout-plan/[id]`, `session-workout/[id]`, `online-run`.
- *Accept:* no `presentation: "modal"` left (grep); no `Alert.alert` except "Discard?" and
  delete-account; joining > 12 h out is one tap + toast with no fee text, inside 12 h the compact
  sheet shows the $5 line; Post cannot be swiped away; Approve / Decline / Pass are inline.
- *Not in scope:* the four-step Post layout (fields stay as they are), any new layout.

**Phase 3 — Plan screen + Plan peek** · Design · depends on 1
- *Goal:* a plan is a place; approving from the chat never leaves the chat.
- *Touches:* new `app/assistant/plan/[id].tsx`, `components/plan-summary.tsx`, `plan-peek.tsx`;
  lift `Conversation`, `Candidates`, `BookingReview`, `History` out of `assistant.tsx`;
  `assistant-coordination.tsx` → compact sheet; `/assistant?negotiationId` redirect; push targets.
- *Accept:* Plans list, a push and the redirect all land on the Screen; **Review** in chat opens
  the peek with the thread still mounted and streaming; approving posts the receipt underneath;
  the peek has no row that opens anything; the Screen owns three sheets plus the shared confirm;
  no banned words.
- *Not in scope:* Buddies pane, chat tools.

**Phase 4 — Settings** · Design · depends on 1
- *Goal:* one Settings area; feature screens lose their switches.
- *Touches:* new `app/settings/*`; `SettingRow`, `StatusHero`; rows move out of `(tabs)/you.tsx`,
  `health.tsx`, `fitness.tsx`, the chat options sheet, `assistant.tsx` Controls, `billing.tsx`,
  `verify.tsx`, `blocked.tsx`; redirects.
- *Accept:* no `Switch` outside `app/settings/` and onboarding (grep); Verification and Membership
  open on a status hero in every state listed in §3.14; every old route redirects; every switch
  has `trackColor` from tokens; the one-time key is never in a sheet.
- *Not in scope:* `membership_required` resume (11), Read replies aloud (12).

**Phase 5 — Assistant tab complete** · Design · depends on 3, 4
- *Goal:* one conversation with two feeds beside it.
- *Touches:* split `assistant.tsx` into `components/assistant/{chat,plans,buddies}-pane.tsx`;
  `AssistantStatusBar`, `NeedsYouStrip`, `SuggestionChips`, `PlanFeedCard`; `Composer` "+" and mic
  (dictation fallback); header `OverflowMenu`; new `app/assistant/looking-for.tsx` with
  `DayTimeChips`; `assistant-discovery.tsx` → Buddies; tab icon → `AssistantOrb` + count.
- *Accept:* draft text and a streaming reply survive switching panes; status bar on all three;
  one name, "Assistant"; no typed dates anywhere; "Where it thinks" shows a checkmark and bubbles
  carry `source`; the mic focuses the input and shows its hint once.
- *Not in scope:* real tool cards (10), `VoiceBar` (12).

**Phase 6 — Home** · Design · depends on 3, 5
- *Goal:* one composed screenful that leads with the day and what needs you.
- *Touches:* `(tabs)/index.tsx` (first-screen block only); new `components/needs-you.tsx`,
  `home-dock.tsx`, `today-sheet.tsx`; `today-card.tsx` (eyebrow, `MetricTile` export); Home badge.
- *Accept:* on iPhone SE, 15 and 15 Pro Max, at default and the largest accessibility text size,
  nothing in the first screen clips or half-shows and the drop order is observed; Today shows our
  read, labelled as ours, with its reason and pills inside it; no chart on Home; the card opens
  the Today sheet; the dock switches tabs with the text carried over.
- *Not in scope:* the Training hub ("Open your day" targets `/today` until Phase 9).

**Phase 7 — Onboarding and just-in-time gates** · Design (+ one Functional sign-off) · depends on 1, 4
- *Goal:* one polished flow; every opt-in asked once, in plain words.
- *Touches:* `app-terms-gate.tsx`, `welcome.tsx` (8 steps, one `StepDots` count, "Not now" gone
  from step 2), `health-onboarding.tsx` (copy), new steps 5–7, `PermissionRow`, `FirstRunScript`;
  "Meet your assistant" Needs-you item; Verify gate; Membership gate shell.
- *Accept:* a new account reaches the first conversation in ≤ 2 minutes skipping verification;
  steps 2 and 3 cannot be skipped; "Not now" on Apple Health continues; accepted terms never
  re-prompt across relaunch, sign-out / sign-in and an offline start; step 5 writes exactly the
  calls in §6; existing members see their current choices; payment is never requested.
- *Not in scope:* the Join-planning dual grant until §10.7 is signed off (ships off).

**Phase 8 — Live screens** · Design · depends on 1, 2
- *Goal:* big state, big number, one control.
- *Touches:* `live/[id].tsx`; `workout-run/[id].tsx`, `workout-plans/online-run.tsx`,
  `rest-timer.tsx`, `exercise-timer.tsx`; new `BigNumber`, `Stepper`; Backup code, Rating, Finish,
  All sets and must-answer sheets; "Open workout plan" row on Live.
- *Accept:* mid-set nothing covers the number; planned vs actual are distinct and a missing actual
  reads "—"; conflict / recover prompts cannot be dismissed without choosing; Close shows "Your
  workout is saved"; rating changes state once and never chains; VoiceOver pass on both screens;
  offline is a status line, never a `Notice`.
- *Not in scope:* Watch, Live Activity.

**Phase 9 — Training hub and details** · Design · depends on 1, 4
- *Goal:* four looping screens become one private hub.
- *Touches:* new `app/training.tsx`; redirects for `/today`, `/fitness`, `/health`,
  `/workout-plans`; Log sheet (from `LogEditor`), Metric sheet, Start-a-workout picker;
  `workout/[id].tsx`, `workout-plan/[id].tsx`, `workout-plan/new.tsx` + `[id]/edit` as a
  full-screen Modal, `session-workout/[id].tsx`.
- *Accept:* lock glyph and "Private to you" in the header; each segment has its one pinned action;
  the Log sheet opens full with the keyboard up, keeps its draft after a stray swipe and refuses
  to dismiss when dirty; the editor cannot be swiped away; `workout/[id]` owns ≤ 4 sheets; SDNN /
  RMSSD appear only as chart labels.
- *Not in scope:* swipe-to-delete (11).

**Phase 10 — The conversational spine** · Functional, then both · depends on 5
- *Goal:* the chat can act, approve-first; then the assistant appears everywhere.
- *Touches:* **[F]** §10.1–10.3. Design: each tool result as an `ActionCard` with its receipt; the
  Ask sheet; the offers of §5 on Home, Find, Post, session, Day, workout.
- *Accept:* fresh account → booked session without leaving the chat except for the Plan peek; no
  tool writes without a tap; the prompt no longer asks for a timezone; the Ask sheet stops at two
  turns; nothing health-derived appears in any card sent to or about a buddy.
- *Not in scope:* voice.

**Phase 11 — Undo and gates glue** · Functional + Design · depends on 2, 4, 7
- *Goal:* forgiving deletes; gates that resume what was refused.
- *Touches:* **[F]** §10.4, 10.5, 10.7, 10.8. Design: `SwipeRow` + `UndoToast` replace the interim
  confirms for logs, workouts and plans; the Membership gate resumes the refused Join / Post /
  Book after `billing-return`; the coordination default in Settings; the recap card.
- *Accept:* a deleted log returns on Undo within the window and is gone after it; VoiceOver has a
  "Delete" action on each row; a `membership_required` refusal opens the gate and the original
  action completes on return; the consent record holds the dual-grant sentence verbatim.
- *Not in scope:* switching on collection or enforcement in production (an owner decision).

**Phase 12 — Voice and Siri** · Functional (native) + Design · depends on 5 · new EAS build
- *Goal:* talking to the assistant feels native.
- *Touches:* **[F]** §10.6 and the App Shortcuts. Design: `VoiceBar`, the mic primer and denied
  sheets, Read replies aloud in Settings.
- *Accept:* tap and hold both work; silence sends; a spoken "yes" never approves — the card pulses
  and asks for a tap; recognition works offline; every state is announced; Reduce Motion shows a
  static meter; the three new shortcuts land on a Screen or Modal.
- *Not in scope:* a spoken answer from Siri itself (needs a signed-in intent handler).

---

## 10. Requests to the functional owner

1. **Approve-first chat tools, in this order.** Each returns a card payload (title, fact chips, a
   one-line "what yes does / shares", the write it would make) and performs the write **only** on
   a follow-up call made by the member's tap; the outcome is appended to the thread.
   `setLookingFor` (+ start looking as *one* approval) → `showCandidates` → `inviteBuddy` →
   `reviewPlan` → `bookIt` → `findSessions(filters)` / `joinSession` → `postSession` →
   `answerRequest` → `recapSession`. Today's tools
   (`src/lib/conversation/provider.server.ts:180-248`) only return a "Review" pointer.
2. **Timezone and current time on every chat turn**, plus an optional `context: {kind, id, label}`
   (session, day, workout, join request). Never health readings. The cloud prompt currently asks
   the member for their timezone (`:99-102`).
3. **Candidate level and show-up record** on discovery candidates (level for the activity,
   sessions completed, on-time %, would-join-again %), and push plan state changes into the chat
   thread as system lines.
4. **Soft-delete** for fitness logs, imported workouts, workout plans and workout records: a
   delete that can be reversed for ~10 s (`DELETE` returns an undo token; `POST …/undo`), so the
   app can use swipe + Undo. Until then Design ships compact confirms.
5. **`membership_required` error code** on the membership 403, alongside `verify_member` /
   `verify_government_id`, so the gate can open from `ApiError.code` instead of matching a message.
6. **Speech module** — Expo module over `SFSpeechRecognizer` + `AVAudioEngine`: on-device
   recognition required, partial transcripts, input level, start / stop / cancel, the two usage
   strings in `app.config.js`; reading aloud via `AVSpeechSynthesizer` or `expo-speech`. Same
   build: three new App Shortcuts through `open.tsx`, and rename "Open workout assistant".
7. **Account-level coordination default + consent record.** Store "Let assistants work out times"
   as an account default; when on, accept the 24-hour coordination grant in the same request as
   Join planning, and record the exact sentence shown on the button's note. **Sign-off needed
   before Design turns this on.**
8. **Session recap read** (`recapSession`): a private, member-only recap from permitted records,
   delivered as a chat card after a session.
9. **Re-prompting terms — confirm whether it is real.** The offline receipt in
   `lib/app-terms-store.ts` is bound to a hash of the auth token. If the token rotates and the
   live `GET` fails on a bad connection, `permitsAppAccess` has neither and the gate would
   reappear for someone who already accepted. Please reproduce; if real, bind the receipt to the
   member id + terms version instead.
10. **The `marked` lint error on `main`.** `expo lint` fails with `import/no-unresolved` at
    `mobile/src/lib/assistant/markdown.ts:2` although the package is installed (the resolver does
    not follow its `exports` map). Fix the resolver setting or the import so "lint clean" can be
    a real gate for every phase above.

---

## 11. Decisions taken, and risks

### 11.1 Decisions taken — veto any you disagree with

- **(a) Apple Health per-type switches** leave our UI. iOS's own sheet chooses what is shared;
  Settings › Apple Health gains **"Stop syncing a kind of reading"**, which removes what was
  synced. *It is a pushed list page rather than a sheet*, because every row needs its own
  destructive confirm and a sheet may not open a sheet.
- **(b) "What you do" and "level" are required** onboarding steps. Ten seconds; the assistant
  cannot match without them. "Not now" is removed from step 2.
- **(c) Join planning may also grant the 24-hour "let our assistants work out times"
  permission** — only when the account default is on, only with the plain sentence on the button's
  note, and only after the functional owner signs off the consent record (§10.7). Ships off.
- **(d) A `membership_required` error code** is added (§10.5).
- **(e) "Read replies aloud" defaults off.**
- **(f) Today has two surfaces, like a plan:** a childless **Today sheet** from Home (the owner's
  "charts live in a sheet, never on Home") and the pushed **Training › Day** as the destination
  for links, Siri and the You tile. `/today` redirects to the Screen.
- **(g) "How showing up works" stays as onboarding step 8.** The owner's flow did not list it, but
  nothing is removed, and the $10 no-show and strike must be seen before the first Join.
- **(h) Home's message box is a doorway,** not a second chat: it switches to the Assistant tab.
- **(i) Report and Train for a goal become component sheets;** their routes become redirects.
- **(j) Terms and Privacy open in the in-app browser;** only short notices are sheets.
- **(k) Ask-the-assistant is capped at two turns** and is not offered inside person-to-person
  threads, where chips draft into the thread's own input instead.

### 11.2 Risks

| Risk | Guard |
| --- | --- |
| **Sheet gesture conflicts** — chart scrubbing, horizontal chip rows and text selection fighting the dismiss drag | The sheet drags from its header only; content drag-down only at scroll-top; no horizontal pager in a half sheet; test the Metric and Today sheets by scrubbing |
| **Android blur parity** — `BlurView` only tints | Near-opaque `background` fill for all floating chrome on Android; check contrast against that fill, not the glass |
| **RN `Modal` inside a full-screen modal route** (Live, workout, Post) misbehaving on iOS | Verified in Phase 1 with a test sheet over `live/[id]` before Phase 8 depends on it |
| **Scope creep / sheet creep** | Budget of 4 sheets per Screen; any new sheet names the test that ruled out Inline; a sheet opened on < 1 in 20 visits becomes a menu item |
| **Two presentations of one object drifting** (Plan screen vs peek; Today sheet vs Day) | One shared body component each (`PlanSummary`, `TodayDetail` tiles); the peek only ever *removes* rows |
| **Two agents editing the same files** | **Rule: design changes to shared screens stay surgical, and new visuals go in kit files.** Design does not touch `lib/**/*.server.ts`, `shared/`, migrations or native modules; Functional does not restyle. Large splits (`assistant.tsx`, `online-run.tsx`) are announced in the PR title and land in one commit so a rebase is mechanical |
| **Design depending on unmerged server work** — the phone build talks to production | Phases 1–9 use only endpoints live today; `FirstRunScript` and prefilled Ask questions stand in until Phase 10; nothing renders an empty "coming soon" |
| **Home fit at large text sizes** | The fit rule is evaluated after scaling and drops rows in a fixed order; tested on the smallest phone at the largest size in Phase 6 |
| **Consent drift** — a switch in onboarding not matching its record | §6 is the single mapping; Phase 7 acceptance checks the exact calls; the dual grant ships off until signed |
| **Lint gate not real** | §10.10 first; until then phases are held to "no new errors" |
