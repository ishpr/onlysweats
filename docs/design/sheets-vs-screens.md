> Superseded by docs/design/MASTER-PLAN.md — kept as an appendix.

# SamePace — sheets versus screens

Research note and decision framework, 21 September 2026. Companion to
`docs/design/agent-first-layout.md` (the draft layout spec, whose presentation choices are treated
here as **unvalidated**) and `docs/audits/2026-09-21-agent-first-audit.md`. Paths are relative to
`mobile/src/`. Nothing in this note removes a feature; it only says *how each one is presented*.

The question: in a modern iOS-first consumer app, what belongs in a bottom sheet and what belongs
on a full screen — and where is the line so that sheets feel premium and contextual rather than
a habit?

The short answer: **a sheet is an answer to a tap, about the thing you tapped, that you finish in
one breath while the screen behind still matters.** Anything you travel to, stay in, type a lot
into, come back to, or that needs its own sheets, is a screen.

---

## Part 1 — What the sources say

Summarised in my own words. Sources with URLs are in §1.7. Where a page could not be read directly
it is marked there.

### 1.1 Apple Human Interface Guidelines

**Sheets.** Apple scopes a sheet to a task that is closely tied to what the person is doing right
now, that is simple, and that ends with a return to the parent view. Sheets are explicitly not for
long or complex flows and not for navigation. On iPhone a sheet may be *nonmodal* — the parent
stays usable while the sheet is up (the Notes formatting sheet is Apple's example; Maps, Find My and
Stocks are the persistent versions).

**Detents.** A detent is a height where the sheet rests. The system gives two: *large* (full
height) and *medium* (about half). Apple's test for medium is progressive disclosure: use it when
the most useful content fits in half a screen and the rest can be reached by pulling up, and when
seeing the parent behind is a benefit (share-style sheets, option panels). Do not offer medium when
the content only makes sense at full height — Apple names compose sheets in Mail and Messages.
A resizable sheet should show a grabber: it signals resizability, it can be tapped to step between
detents, and it is what lets a VoiceOver user resize at all. `UISheetPresentationController` adds
the mechanics that matter for feel: whether scrolling at the top edge expands the sheet before it
scrolls content, which detent is the largest one that leaves the parent undimmed (that is what makes
a sheet nonmodal), custom detents, and `isModalInPresentation` to block swipe and tap-outside
dismissal while there is work at risk.

**Stacking.** One sheet at a time from the main interface. If a second is genuinely needed, close
the first, show the second, and reopen the first afterwards if required. The Modality page says the
same in general terms: never more than one modal view at once; an alert is the only thing that may
sit on top, and only one of those.

**Dismissal and unsaved work.** People expect a downward swipe to dismiss. If that would lose
something they made, intercept it and ask (an action sheet with save / discard). A single-view sheet
pairs Cancel (leading) with Done (trailing); a multi-step sheet swaps Cancel for Back after step one
and keeps Done inactive until the last step. Never show Cancel, Back and Done together. Always give
an exit other than completing the task.

**Modality in general.** Use it only when there is a clear benefit: a critical message, a
confirmation, a focused task that should not lose its context, or an immersive experience. Keep
modal tasks short and narrow; do not build a second app inside one. Avoid hierarchy inside a modal;
if sub-views are unavoidable, make the path a single line. Give the modal a title. For video,
photos, camera, document markup, editing and multi-step work that needs concentration, Apple
recommends the **full-screen** modal style instead of a sheet.

**Push versus modal.** Pushing is for moving deeper into the app's content (list → detail →
sub-detail). Modal is for a self-contained task that starts and ends. The tab bar stays for
navigation and may be covered only by something modal, because a modal is temporary.

**Action sheets, menus, alerts.** An action sheet offers choices about an action the person has
*already started* (cancel a draft → delete / save). A menu is for when the person explicitly asks
to see options (a "more" button, a long-press). Action sheets should be short enough not to scroll,
with the destructive choice at the top and Cancel at the bottom. Alerts are for things that must be
known now — problems, data loss, confirmations of consequence — and should be rare; routine,
undoable actions should not alert at all. Alerts max out at three buttons, with specific verbs.

**Going full screen.** Reserved for distraction-free experiences: media, games, focus tasks. Keep
the essential controls reachable, let the person decide when to leave, and defer system edge
gestures so a stray swipe does not end the experience.

### 1.2 Material Design (3, with 1–2 for detail)

Material splits bottom sheets into **standard** (coexists with the main content, no scrim, stays up
while you scroll or pan the primary region — the map case) and **modal** (scrim, blocks everything
until dismissed). It positions the modal bottom sheet as the mobile replacement for an inline menu
or a simple dialog, particularly for a longer list of actions or items that need an icon and a
description. Initial height is capped (the classic guidance is roughly the 16:9 keyline, about half
the screen) with a pull to full height and internal scrolling after that; once full height, show an
explicit close control. The drag handle must be a real accessible control (48 dp target; tap steps
through states) so switch and screen-reader users can resize.

The **full-screen dialog** is Material's answer for the things a sheet should not hold. The
criteria are unusually crisp: use it when the task needs keyboard input in form fields, when
changes are not saved instantly (so there is a Save and a discard-on-close), or when components
inside need to open further dialogs or pickers. It exists partly to avoid the look and confusion of
layers on layers.

**Back.** On Android the system Back gesture must dismiss a modal sheet. Material's components
support predictive back (the sheet previews its dismissal under the finger); a standard sheet needs
its own back handling tied to its state.

### 1.3 Nielsen Norman Group and related research

- **Bottom sheets.** Good for brief, contextual detail or actions where the background stays
  relevant. Not for full navigation flows, long or complex content, persistent destinations, or
  stacks. Always provide a visible close button as well as the grabber; support Back; keep
  interactions short. Observed problems: unclear dismissal, accidental closure from gesture
  ambiguity, disorientation in stacked sheets, and sheets hiding the very content the person needed.
- **Modal dialogs.** Appropriate for preventing irreversible errors, for asking for information
  the person's own action requires, and for breaking a complex task into steps. Wrong for
  non-essential interruptions, for high-stakes flows such as checkout, and for decisions that need
  information hidden behind the modal. Every interruption costs time and working memory. Multi-step
  modals need visible progress.
- **Accidental overlay dismissal.** On mobile there are four ways out of an overlay (close button,
  tap outside, swipe, system Back) and people routinely pick one that does more than they meant,
  losing work or collapsing several layers at once. Recommendations: prefer a page or an accordion
  where feasible; prefer partial overlays to full-page ones that masquerade as pages; never stack;
  always show a close button; make Back dismiss exactly the top layer.
- **Forms in overlays** (NN/g and general form research; I did not find a Baymard study specific to
  forms in bottom sheets). The consistent finding is that a dimmed backdrop which closes on tap is
  the wrong default the moment there is unsaved input or a destructive choice. Long forms belong on
  pages; short ones can live in an overlay if dismissal is guarded and the primary action stays
  visible above the keyboard.

### 1.4 How well-regarded apps divide the two

These are patterns from product familiarity, cross-checked where a source exists (the Expo article
on Maps, Strava's help pages, filter-pattern write-ups). Verify on a device before quoting them to
anyone.

| App | Uses a sheet for | Deliberately uses a full screen for |
| --- | --- | --- |
| Apple Maps | The canonical persistent, nonmodal sheet: search, place card and route options share the map at small / medium / large detents; in iOS 26 it floats as a glass card until the top detent, where it becomes a normal full sheet | Turn-by-turn navigation (a live state), Look Around, the full photo viewer |
| Apple Fitness / Health | Share, edit-summary and filter pickers; "add data" is a modal form | A workout's detail, every metric's history and charts (pushed, because they are destinations with their own children); the live workout on Watch is full screen |
| Strava | Sport picker, sensor and route choosers on the record screen; kudos and comment lists; share | Recording (live, full screen, stats ↔ map toggle), the save-activity form (title, description, photos, privacy — a full modal form), activity detail, segment detail |
| Airbnb | Date and guest pickers, price breakdown, "report this listing", small explanations | Filters (dozens of controls, their own sections, a pinned "show N homes"), the listing, and the whole booking flow (multi-step, own navigation, high stakes) |
| Uber / Lyft | Map plus a sheet that carries the entire ride state: destination, ride options, confirm, driver en route — detents let the rider trade map for detail | Payment methods, trip history, help, account; anything with text entry beyond the destination field moves to a full-height surface |
| Linear / Things | Quick capture: one title field, a row of chips (project, date, tags), keyboard up immediately, saved on return, draft kept if dismissed | The issue / to-do itself, projects, anything edited at length |
| ChatGPT / Claude (mobile) | Model picker, attachment source, voice options, message actions — all short option lists | The conversation and its composer (always a full screen with the composer pinned to the keyboard), voice mode (full-screen live state), settings |
| Instagram | Comments over a playing video (the video staying visible is the point), share-to, "more" actions | Camera and story creation (full-screen, immersive), post composer (multi-step with its own navigation), profiles, DMs |

The common thread: **a sheet is kept when the thing behind it is still doing work** (a map, a video,
a conversation, a list whose filter you are changing). Once the background is only decoration, the
best apps push or go full screen.

### 1.5 Known failure modes

| Failure | What happens | Standard remedy |
| --- | --- | --- |
| Stacked sheets | Depth is lost; Back or a swipe closes more than intended | One sheet at a time; close-then-open; if a surface needs children it is a screen |
| Scroll inside scroll | A scrolling sheet over a scrolling page; the wrong one moves | Modal sheet dims and locks the page; only the sheet scrolls |
| Drag versus scroll | A downward drag inside scrolled content tries to move the sheet | Sheet drags only from the header or grabber, or only when content is at its top; at the half detent, upward scroll expands before it scrolls |
| Drag versus horizontal gestures and text selection | Chart scrubbing, carousels, selecting legal text fight the dismiss gesture | Keep the dismiss gesture off the content area; never put a horizontal pager in a half-height sheet |
| Lost input | Tap-outside or a stray swipe discards a half-typed form | Dirty state disables tap-outside and swipe-close, or prompts to discard; keep the draft alive after close |
| Keyboard in a half sheet | Keyboard covers the fields or the primary button; the sheet jumps | Any sheet with a text field opens at full height (or hugs directly above the keyboard if it has one field); primary action pinned above the keyboard |
| Deep link into a sheet | Arriving with nothing sensible behind; closing reveals a blank or wrong parent | Links resolve to screens; a sheet is opened by its parent after the parent has mounted |
| Focus and screen readers | VoiceOver wanders behind the sheet, cannot resize or dismiss; focus is not returned | Modal accessibility container, focus to the title on open and back to the opener on close, grabber exposed as a control, escape gesture (two-finger scrub) dismisses, visible Close |
| Dynamic Type growth | A "compact" sheet grows past the screen at large text sizes and clips its button | Measure content; when it no longer fits, become a scrolling half/full sheet with the footer still pinned |
| Reduced motion | Springy rise and rubber-banding are vestibular triggers | Replace travel with a short cross-fade; no overshoot |
| One-handed reach | Close button and Cancel/Done live at the top of a full-height sheet | Primary action pinned at the bottom; swipe-down and tap-outside available when nothing is at risk |
| Android Back | Back exits the screen under the sheet, or steps through detents unpredictably | Back closes the top sheet, once, from any detent; with dirty input it triggers the discard prompt |
| Unprompted sheets | A sheet that appears without a tap is a pop-up | Sheets answer taps. System-initiated messages are banners, a Needs-you item, or (rarely) an alert |

### 1.6 What this adds up to

Apple, Material and NN/g agree on more than they differ:

1. Sheets are for **short, contextual, single-purpose** moments where the background still matters.
2. **Keyboard-heavy input, unsaved multi-field state, multi-step work, and anything that needs
   its own overlays** belongs on a full-screen surface.
3. **Never stack.** A surface that needs children is a screen.
4. **Destinations are pushed**, not presented.
5. Below the sheet there is a lighter tier that is often forgotten: **menus, inline controls,
   expanding rows and toasts**. Many sheets should have been one of those.

### 1.7 Sources

Apple (the HIG is rendered client-side; I read the documentation JSON behind each page):

- Sheets — https://developer.apple.com/design/human-interface-guidelines/sheets
- Modality — https://developer.apple.com/design/human-interface-guidelines/modality
- Action sheets — https://developer.apple.com/design/human-interface-guidelines/action-sheets
- Alerts — https://developer.apple.com/design/human-interface-guidelines/alerts
- Menus — https://developer.apple.com/design/human-interface-guidelines/menus
- Tab bars — https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Going full screen — https://developer.apple.com/design/human-interface-guidelines/going-full-screen
- `UISheetPresentationController` — https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller

Material / Android (the Material 3 site would not render for my reader; I relied on search
summaries of the M3 pages plus the readable M1 page and the component documentation):

- M3 Bottom sheets — https://m3.material.io/components/bottom-sheets/guidelines
- M3 Dialogs (incl. full-screen dialogs) — https://m3.material.io/components/dialogs/guidelines
- M1 Bottom sheets (heights, close affordance) — https://m1.material.io/components/bottom-sheets.html
- Material Components Android, BottomSheet — https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md
- Predictive back design — https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back

Research and practice:

- NN/g, Bottom Sheets: Definition and UX Guidelines — https://www.nngroup.com/articles/bottom-sheet/
- NN/g, Modal & Nonmodal Dialogs — https://www.nngroup.com/articles/modal-nonmodal-dialog/
- NN/g, Accidental Dismissal of Overlays — https://www.nngroup.com/articles/accidental-overlay-dismissal/
- Baymard, mobile checkout and form usability (general form findings only) — https://baymard.com/blog/mobile-ecommerce-checkout-forms
- LogRocket, designing bottom sheets — https://blog.logrocket.com/ux-design/bottom-sheets-optimized-ux/
- TestParty, mobile accessibility patterns (sheets, gestures) — https://testparty.ai/blog/mobile-accessibility-patterns
- React Native accessibility (`accessibilityViewIsModal`, `onAccessibilityEscape`) — https://reactnative.dev/docs/accessibility
- Expo, Apple Maps–style Liquid Glass sheets (detents in Expo Router `formSheet`) — https://expo.dev/blog/how-to-create-apple-maps-style-liquid-glass-sheets
- Strava, Recording an activity — https://support.strava.com/hc/en-us/articles/216917397-Recording-an-Activity
- UXPin, filter UI patterns (Airbnb's full filter panel) — https://www.uxpin.com/studio/blog/filter-ui-and-ux/

---

## Part 2 — The decision framework

### 2.1 Nine tests (30 seconds)

Ask them in order. The first test that answers "screen" usually settles it; a sheet has to pass all
nine.

| # | Test | Points to a sheet | Points away from a sheet |
| --- | --- | --- | --- |
| T1 | **Time** — how long is the typical visit? | Under about 30 seconds | Longer, or open-ended |
| T2 | **Steps** — how many decisions in a row? | One, or one plus its confirmation | Three or more, or any branching |
| T3 | **Own navigation** — will it push, or open a sheet of its own? | Never | Yes → it is a screen, full stop |
| T4 | **Context** — is what is behind still useful, or changed by this? | Yes: you act *on* it or compare *with* it | No: the background is decoration |
| T5 | **Data at risk** — would a stray swipe cost more than ~10 seconds to redo? | Nothing typed, or one short field, or autosaved | More than one text field, or anything composed |
| T6 | **Live / immersive** — timers, location, a body in motion? | No | Yes → full-screen modal, gestures deferred |
| T7 | **Destination** — do pushes, links, Siri or habit bring people *here*? | No, it only exists relative to a parent | Yes → it needs a URL and a back stack |
| T8 | **Canvas** — does the content need the full width and height? | A few rows, one chart, one card | Maps, media, tables, long reading, more than about two screenfuls |
| T9 | **Weight** — would something lighter do? | Needs a sentence of explanation or a pinned button | Five or fewer one-line options, a toggle, a reversible action → menu, chip, inline, toast |

### 2.2 Five presentation types

**1. Screen (pushed).** A place. Has a URL, a back chevron, and may open sheets and push further.
Wins on T3, T7, T8. *Use for:* tab roots, details (session, plan, goal, workout), hubs, settings
pages, lists you return to. In this app a pushed screen hides the tab bar and may carry one pinned
footer.

**2. Modal (full-screen modal — a focused task or a live state).** A task with a beginning and an
end, or a live state that should not be left by accident. Close (or Cancel) top-leading, one pinned
primary, no swipe-to-dismiss, unsaved-changes guard. May open **one** sheet. Wins on T2, T5, T6.
*Use for:* create and edit flows with typing, onboarding, check-in, workout in progress.

**3. Large sheet (half ↔ full).** A contextual panel that starts at half and can be pulled to full.
Read-mostly content, a picker with more than a handful of rows, or a single-step form with at most
one text field (then it opens full). Wins when T4 is a strong yes and T1/T2 are short. *Use for:*
peeks (plan, metric, person), pickers (workout plan, level, other times), "what this means", quick
capture.

**4. Compact sheet (hugs its content).** One decision: a confirmation with its consequence spelled
out, a consent with one line on what is shared, a short explanation, a single field. Title, at most
about five lines of body, at most two buttons, no scrolling at default text size. Wins on T9 *only
when* a menu or inline control cannot carry the explanation or the consequence.

**5. Inline (no overlay).** Overflow and context menus, chips, segmented controls, steppers,
switches, expanding rows, in-place state changes, toasts with Undo, cards in the conversation.
Always try this tier first for anything reversible.

### 2.3 Hard limits

- **Stacking: N = 1.** Never a sheet on a sheet. A screen or a full-screen modal may have one
  sheet above it. Allowed above a sheet: an OS permission prompt, the OS share sheet, a native
  picker, and one discard alert — nothing we draw.
- **Chaining counts as stacking.** A sheet whose button opens another sheet, or a sheet that is
  auto-followed by another, is the same failure in sequence. One sheet may change state **once**
  (form → result, rate → offer). That is the ceiling.
- **Steps in a sheet: two.** A decision and, at most, its confirmation or result. Three steps is a
  Modal with `StepDots`.
- **Text fields in a sheet: one.** Chips, steppers and switches are free. Two or more text fields
  is a Modal. A sheet with a text field opens at full height unless it is a single-field compact
  sheet sitting directly on the keyboard.
- **No navigation inside a sheet.** No pushes, no segmented panes, no tabs, no horizontal pagers.
  A row in a sheet either acts in place or closes the sheet and then navigates.
- **Length: about two screenfuls at full detent.** More than that is reading, and reading is a
  screen.
- **A sheet must become a screen when** it grows a second sheet, a third step, a second text field,
  a deep link, a segment control, or people start returning to it on purpose.
- **Forms in sheets.** (a) The primary action is pinned in the sheet footer and stays above the
  keyboard. (b) When dirty, tap-outside and swipe-close stop dismissing and the Close button asks
  "Discard?" — unless the form autosaves, in which case dismissal is always free. (c) The draft
  survives an accidental close (`keepMounted`) until it is saved or explicitly discarded.
  (d) Pickers inside the form expand inline; they never open another sheet. (e) Labels are Cancel
  and a verb ("Save exercise"), never Done alone.
- **Must-answer prompts are not swipeable.** If the person has to choose (a sync conflict, recover
  unsaved entries), dismissal by swipe, tap-outside and Back is disabled and both choices are
  buttons.
- **Sheets answer taps.** Nothing the app initiates on its own arrives as a sheet.

**Do not use a sheet when…** it is reached from a push notification or a link · it has its own
overflow menu with destructive items · it shows a secret once (a key, a code that cannot be shown
again) · it holds the conversation composer as its main content for more than a couple of turns ·
it is the only home of a feature · it would be opened from another sheet · its content is a list
people browse rather than pick from · a menu with the same items would fit on screen · the action
is reversible and a toast with Undo would do · it needs the person's attention *because the app
decided so* rather than because they tapped.

### 2.4 Flowchart

```text
START: someone tapped something (if nobody tapped → banner, Needs-you item, or alert; never a sheet)
│
├─ Is it a live or immersive state (timer, location, doing a set)?            yes → MODAL (full-screen)
│
├─ Do pushes, links, Siri, or habit bring people here directly?               yes → SCREEN
│
├─ Will it push further or need a sheet of its own?                           yes → SCREEN
│        (if it is also a task with Save/Cancel semantics → MODAL)
│
├─ Does it take 3+ steps, 2+ text fields, or compose something that
│  would hurt to lose?                                                        yes → MODAL (guarded)
│
├─ Is it long reading, a map, media, a table, or > 2 screenfuls?              yes → SCREEN
│
├─ Is the screen behind still useful while this is open?                      no  → SCREEN
│
│  ── from here down the answer is an overlay or lighter ──
│
├─ Is it reversible, or ≤ 5 one-line options, or a single toggle?             yes → INLINE
│        (menu · chip · switch · expanding row · toast with Undo)
│
├─ Is it one decision that needs its consequence or what-is-shared
│  spelled out, or a single short field?                                      yes → COMPACT SHEET
│
└─ Otherwise: a peek, a picker with many rows, a one-field quick capture,
   a short explanation with a chart or card                                        → LARGE SHEET
        opens at half; opens full if it has a text field;
        if it ever needs a child sheet, go back up: it was a SCREEN.
```

---

## Part 3 — Applied to SamePace

### 3.0 Two facts about the existing `Sheet` that shape the answers

`components/sheet.tsx` is a React Native `Modal` with a measured, content-hugging resting height
(compact), a half stop at 56% of the window, and a full stop; it drags only from its header, goes
full when the keyboard appears, has a visible Close, honours Reduce Motion, and can keep its
children mounted while closed.

1. **It is a component, not a route.** It cannot be deep-linked, and that is correct. The draft
   spec lists `needs-you`, `assistant/ask`, `training/log` and `assistant/plan/[id]` as routes that
   are sheets. The first three should be component sheets owned by a parent screen; the fourth
   should be a Screen (§3.2, note 1).
2. **A `Sheet` opened from a route that is itself presented with `presentation: "modal"` is a
   sheet on a sheet.** Today `post`, `verify`, `report`, `today` and `training-block/new` are iOS
   page sheets. Each must be either a Screen, a full-screen Modal, or a `Sheet` — never the
   in-between page sheet that then opens sheets of its own.

Gaps in the component that the rules in §3.5 depend on (not fixed here; this note changes no code):
no way to veto dismissal when dirty or must-answer; no `onAccessibilityEscape`; the grabber is not
an accessible control; focus is not moved on open or returned on close; upward scroll at the half
stop does not expand the sheet first; Reduce Motion snaps in zero milliseconds rather than fading.

### 3.1 Every surface

Type is one of **Screen · Modal · Large sheet · Compact sheet · Inline**. "Draft" compares with
`agent-first-layout.md`: `=` agrees, `≠ n` disagrees (see the numbered notes in §3.2), `new` is a
surface the draft implies but does not specify.

| # | Surface | Presentation | Detent / size | Why (deciding test) | Opens from | Draft |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Home | Screen | Tab root | T7 destination | Tab bar | = |
| 2 | Find | Screen | Tab root | T7 | Tab bar | = |
| 3 | Assistant — Chat · Plans · Buddies | Screen | Tab root, panes stay mounted | T7, T1 open-ended; segments are inline | Tab bar, Home dock, Siri | = |
| 4 | Chats | Screen | Tab root | T7 | Tab bar | = |
| 5 | You | Screen | Tab root | T7 | Tab bar | = |
| 6 | Sign in | Screen | Root | T7 | Signed out | = |
| 7 | Onboarding steps 1–8 (`app-terms`, `welcome`) | Modal | Full screen, no swipe, `StepDots` | T2 eight steps; T5 | First run | = |
| 8 | Onboarding — "what each of these means", short notices | Large sheet | Half → full, read-only | T4 the step stays behind; T1 short | Link on steps 1 and 5 | = |
| 9 | Onboarding — Apple Health, notifications, location | Inline | Button → iOS prompt | T9; the OS owns the overlay | Steps 4 and 7 | = |
| 10 | "Meet your assistant" for existing members | Modal | One full-screen step | Sheets answer taps; six switches + consent is not a pop-up | A Needs-you item | ≠ 11 |
| 11 | Needs-you list ("1 of 3") | Large sheet | Half; a component, not a route | T4 over Home; T1; rows act in place or close-then-push | Needs-you card counter | ≠ 14 |
| 12 | Join request Approve / Decline | Inline | Buttons on the card, toast receipt | T9 one tap, low risk | Needs-you card, session, goal | ≠ 18 |
| 13 | Notifications list (`activity`) | Screen | Pushed | T7 (bell, badge), T8 list you browse | Bell in `AppHeader` | = |
| 14 | Home docked composer | Inline | Pinned footer; focusing it switches to the Assistant tab | A conversation is a destination (T1, T7), so it is never a sheet | Home | = |
| 15 | Today → your day (Training › Day) | Screen | Pushed (today it is a page-sheet modal) | T8 charts, T3 opens metric sheets, T7 Siri shortcut | Today card, You, shortcut | = |
| 16 | Metric detail (sleep, HRV, steps…) | Large sheet | Half → full | T4 a peek over the dashboard; T1 | Tile on Day | = |
| 17 | Weekly-session actions (next week's · train for a goal · leave) | Inline | Overflow menu on the row | T9 three one-line options | "Every week" rows | ≠ 10 |
| 18 | Leave weekly session | Compact sheet | Hug; danger button + fee line | Consequence must be spelled out | Item 17 menu | = |
| 19 | Credit / strike / pause explanation | Compact sheet | Hug; link to Membership & fees | T9 needs a sentence, nothing to do | Badges on You and Home | = |
| 20 | Find filters (my level · before 10 · fill-in · women-only) | Inline | A second chip row; results update live | T9 four booleans; a sheet hides state and adds two taps | Find header | ≠ 2 |
| 21 | Find empty-state assistant offer | Inline | `ActionCard` in the feed | T9 | Find | = |
| 22 | Post a session (`post`) | Modal | Full screen, 4 steps, guard | T2, T5 typed name and details; opens Verify / Membership sheets so it cannot be a page sheet (T3) | Find header, Home, goal menu | ≠ 12 |
| 23 | Session detail (`session/[id]`) | Screen | Pushed, pinned footer | T7, T3 | Cards, push, links | = |
| 24 | Join / Ask to join (free-cancel window open) | Inline | Pinned button → success state + toast "free to cancel until…" | Reversible at no cost → no confirm | Session footer, chat card | = |
| 25 | Join inside the 12-hour window | Compact sheet | Hug; fee line + Join | Not freely reversible → say the consequence once | Session footer | new |
| 26 | Leave session | Compact sheet | Hug; fee line | Destructive, consequence | Session `[···]` | = |
| 27 | Cancel session (host) | Compact sheet | Hug | Destructive, affects others | Session `[···]` | = |
| 28 | Session `[···]`, thread `[···]`, plan `[···]`, workout `[···]` | Inline | Overflow menu (today several are `Alert.alert` lists) | T9 | Header | = |
| 29 | Share session / goal invite link / exports | Inline | Button → iOS share sheet | The OS owns it | Header, goal footer, Settings | = |
| 30 | Host / buddy record peek ("12 sessions · 96% on time ›") | Large sheet | Half | T4 deciding whether to join *this* session; read-only | Host row, candidate card, join request | new |
| 31 | Meeting point → Maps | Inline | Button → Apple Maps | T8 a map is Maps' job | Session, Live | = |
| 32 | Just-in-time Verify gate | Compact sheet | Hug (grows to half at large text) → Persona's hosted flow | Answers the refused tap; action resumes | Join, Post, Invite, Start looking | = |
| 33 | Membership gate | Compact sheet | Hug → Stripe hosted page | Same; card details never in-app | Refused Join / Post / Book | = |
| 34 | Ask the assistant about this (session, day, workout, join request) | Large sheet | Half with chips; full when typing; **two turns, then "Continue in Assistant"** | T4 the context is the point; T1 capped by rule | `[···]`, pinned "Ask about…" | = (with limits, note 13) |
| 35 | Live check-in (`live/[id]`) | Modal | Full screen, no swipe | T6 | Live banner, session, thread, push | = |
| 36 | Check-in rules ("what counts") | Compact sheet | Hug, read-only | T9 needs sentences; T4 | Info row on Live | new |
| 37 | Backup code | Compact sheet | Hug on the number pad; one 4-digit field, auto-submits | One field; T4 the state behind is the point | Row on Live | = |
| 38 | "You're both here" | Inline | State of the Live screen | T6 | — | = |
| 39 | Rate your buddy | Compact sheet | Hug; two yes/no chip rows + Send; then the **same** sheet becomes one offer ("Same time next week?") | T1, no typing; chaining limit | After the session; "How was it?" | ≠ 6 |
| 40 | Private recap after a session | Inline | A card in the Assistant thread (lock glyph) | Not a third overlay | Assistant | ≠ 6 |
| 41 | Chat thread (`thread/[id]`) | Screen | Pushed, composer pinned | T1, T7 | Chats, session, push | = |
| 42 | Assistant help inside a thread | Inline | Chips above the thread composer that draft text into the input | Two composers on one screen is the failure; T9 | `(o)` beside the composer | ≠ 13 |
| 43 | Report (`report`) | Large sheet | Opens full; chips + one optional note; guard once the note is dirty | One step, one field; never opened from another sheet | Any `[···]` | = |
| 44 | Block | Compact sheet | Hug | Consequence ("you won't see each other") | Report, menus | = |
| 45 | Blocked members; Unblock | Screen | Pushed; Unblock inline with Undo toast | T7 settings page; reversible | Settings › Safety | = |
| 46 | Composer "+" (photo · camera · paste a note) | Inline | Menu → iOS pickers | T9 | Assistant composer | = |
| 47 | Voice input | Inline | The composer grows into `VoiceBar` | The thread must stay visible; T9 | Mic in any assistant composer | = |
| 48 | Microphone primer (first use) and "mic is off" | Compact sheet | Hug → iOS prompts / Settings | One explanation before an OS prompt | First mic tap | = |
| 49 | Assistant header `[···]`, incl. "Where it thinks" and Pause | Inline | Menu with checkmarks; Pause shows an Undo toast | T9, reversible | Assistant header | = |
| 50 | Delete conversation | Compact sheet | Hug, danger | Destructive, irreversible | Assistant `[···]`, Settings | = |
| 51 | What you're looking for (`assistant/looking-for`) | Modal | **One page**, Cancel / Save, guard | T5 four groups + a note; an *edit* wants Save/Cancel on one page, not four steps | Status bar, `[···]`, Settings, "Change" on a chat card | ≠ 3 |
| 52 | First-run conversation ("here's what I'll look for") | Inline | Chips and an `ActionCard` in the thread | The conversation *is* the form | Onboarding end | = |
| 53 | Look for a buddy — opt-in (Start looking) | Compact sheet | Hug; what is shared, 7 days, women-only chip | A consent with a consequence | Buddies footer; in chat it is the card itself | = |
| 54 | Stop looking | Inline | Footer button + Undo toast | Reversible | Buddies footer | = |
| 55 | Candidates (people who fit), past buddies | Inline | Feed in the Buddies pane; cards in chat | Part of a Screen | Assistant › Buddies | = |
| 56 | Invite a buddy | Compact sheet | Hug; "she sees your first name, level, these times" | Consent; in chat the `ActionCard` does the same job inline | Buddies card | = |
| 57 | Plan review (`assistant/plan/[id]`) | Screen | Pushed, pinned footer by state | T7 push target, T3 it has four children | Plans feed, push, Home, "Open full plan" | ≠ 1 |
| 58 | Plan peek — approve from where you are | Large sheet | Half; `PlanTrack`, `PlanCard`, approvals, terms chips when booking, one pinned button, "Open full plan" | T4 the conversation stays behind; T1 seconds; no children | "Review" on a chat card or the Needs-you card | ≠ 1 |
| 59 | Approve a plan | Inline | The pinned button (peek or screen) → check → receipt line in chat | One deliberate tap *is* the confirmation | Items 57, 58 | = |
| 60 | Booking terms + Accept and book | Inline | Terms as fact chips above the pinned button | The terms must be visible *at* the button, not behind another tap | Items 57, 58 | = |
| 61 | Other times that fit both | Large sheet | Half → full; a `PlanCard` per option | Picker over the plan; T4 | Row and "Suggest another" on the plan Screen | = (legal only because 57 is a Screen) |
| 62 | Let our assistants work it out | Compact sheet | Hug; both statuses, Allow 24 h / Ask now / Stop | Consent with a time limit | Row on the plan Screen | = |
| 63 | What's happened (plan history) | Large sheet | Half, read-only | T4, T1 | Row on the plan Screen | = |
| 64 | End this plan | Compact sheet | Hug, danger | Destructive, affects a buddy | Plan `[···]` | = |
| 65 | AI draft of a workout plan — review | Large sheet | Half → full, **read-only** preview; pinned Save & start; "Edit" closes it and opens item 84 | T4 over the chat; editing sets is T5 and leaves the sheet | `WorkoutPlanDraftCard` in chat | ≠ 4 |
| 66 | Connect an outside assistant (list, create key, reveal once, remove) | Screen | Pushed; create and the one-time key are inline on the page; Remove → compact confirm | A secret shown once must not be swipeable | Settings › Assistant | = |
| 67 | Training hub (Day · Log · Workouts · Plans) | Screen | Pushed, segments | T7, T8 | You, Home, redirects, shortcuts | = |
| 68 | Log an exercise | Large sheet | Opens full with the keyboard up; one text field + mic, then steppers; time is an inline chip; draft kept; a component, not a route | Quick capture (the Things pattern); T4 the log behind | Pinned button on Log; imported-draft card | ≠ 5 |
| 69 | Edit a log | Large sheet | Same sheet, prefilled | Same | `LogCard` | = |
| 70 | Delete a log · remove workout · delete plan · remove device copy · remove plan from session | Compact sheet | Hug, danger | Destructive; no server undo today (see Q2) | Card or `[···]` | = |
| 71 | Apple Health workout detail (`workout/[id]`) | Screen | Pushed | T7, T8 charts, T3 | Workouts feed | = |
| 72 | Fix the workout's name or type | Compact sheet | Hug; chips + one field | One decision | Row on item 71 | = |
| 73 | How did it go? (goal + note, "make sense of my note") | Large sheet | Opens full; one note field; guard | One field, T4 | Row on item 71 | = |
| 74 | Recap on this iPhone | Large sheet | Half → full, read-only | Peek | Row on item 71 | = |
| 75 | Start a workout — plan picker | Large sheet | Half; last used first; a tap starts it | Picker with many rows; T4 | Pinned on Workouts; "Choose a workout plan" on Our workout | = |
| 76 | Workout plans list | Inline | The Plans segment of item 67 | Part of a Screen | Training | = |
| 77 | Workout plan detail (`workout-plan/[id]`) | Screen | Pushed, pinned Start | T7, T3 | Plans, session, chat | = |
| 78 | New workout plan (`workout-plan/new`) | Modal | Full screen; How? → Review/edit; guard | T2, T5 the heaviest typing in the app | Plans footer, chat chip, shortcut | ≠ 12 |
| 79 | Attach a plan to a session | Compact sheet | Hug to half; your upcoming sessions | Short picker | Plan detail footer | new |
| 80 | Our workout — shared session plan (`session-workout/[id]`) | Screen | Pushed | T7 (Live, Next up, session link to it), T3 | Session, Live, Home | = |
| 81 | Save a copy for next time | Inline | Menu item + toast | Reversible, no decision | Our workout `[···]` | = |
| 82 | Workout in progress (`workout-run/[id]`) | Modal | Full screen, no swipe, gestures deferred (today it is pushed) | T6 | Start / Continue | = |
| 83 | Rest timer · exercise timer · set done | Inline | States of the one pinned control | T6: mid-set, nothing may cover the number | — | = |
| 84 | Edit a workout plan | Modal | Full screen, the same editor as item 78, guard | T5 | Plan `[···]`, "Edit" on item 65 | new |
| 85 | How to do it (exercise help) | Large sheet | Half, read-only | Peek between sets | Row on item 82 | = |
| 86 | All sets (edit or clear any set) | Large sheet | Half → full; **autosaves per field**, so dismissal is free | T4; autosave removes the T5 risk | Workout `[···]` | = |
| 87 | Private note | Compact sheet | Hug on the keyboard; one field, autosave | One field | Workout `[···]` | = |
| 88 | Share my set counts with my buddy | Compact sheet | Hug; one switch + one line on what is shared | First-time consent needs the sentence | Workout `[···]` | = |
| 89 | Finish workout | Compact sheet | Hug; done / skipped / time; Finish and save · Keep going | One decision with a summary | Pinned control after the last set; `[···]` Finish early | = |
| 90 | Delete this workout record | Compact sheet | Hug, danger | Destructive | Workout `[···]` | = |
| 91 | Changes from another device · Recover unsaved entries | Compact sheet | Hug; **not dismissable** — two buttons, no swipe, no tap-outside | Must-answer | On arrival at item 82 | ≠ 7 |
| 92 | Watch recorder (live tile and controls) | Inline | Tile on Workouts | T9 | Workouts | = |
| 93 | Goal detail (`training-block/[id]`) | Screen | Pushed | T7 invite links land here; T3 | Home, Find, You, links | = |
| 94 | Train for a goal (`training-block/new`) | Large sheet | Opens at half; three chip rows + one field; guard once dirty | One step, one field, T4 (the weekly session it grows from) | Item 17 menu, goal `[···]` "Start one like it" | ≠ 15 |
| 95 | Goal join requests — Approve / Pass | Inline | Buttons on the row, toast | T9 | Goal detail, Needs you | ≠ 18 |
| 96 | Leave this goal | Compact sheet | Hug, danger | Destructive | Goal `[···]` | = |
| 97 | Goal wrap-up ("who helped you stick to it?", keep the weekly sessions?) | Inline | A section at the top of the goal Screen, yes/no chips | It arrives with the goal as context; no overlay needed | Needs-you item → goal | = |
| 98 | Set your level | Large sheet | Half; per activity, description under each choice; the chips on You update behind it | Picker with explanations; T4 | Level chips on You, Find row, Needs you | = |
| 99 | Change my name | Compact sheet | Hug on the keyboard; one field | One field | Name on You, Settings, Needs you | = |
| 100 | Settings root and its pages (Assistant, Privacy & AI, Apple Health, Notifications, Verification, Membership & fees, Location) | Screen | Pushed | T7 (redirects, returns), T3 | Gear on You | = |
| 101 | Appearance | Inline | Three chips in Settings | T9 | Settings | = |
| 102 | Notification kinds; Sync automatically; privacy switches | Inline | `SettingRow` switches | T9 | Settings pages | = |
| 103 | Switching off something that deletes (cloud thinking, logging help) | Compact sheet | Hug; states what is cleared | Destructive side-effect | The switch | = |
| 104 | "What this means" for one switch or notice | Large sheet | Half → full, selectable text | Short reading, T4 | `SettingRow` about link | = |
| 105 | Terms · Privacy · What you agreed to (full documents) | Screen | Pushed (or the in-app browser) | T8 long reading | Settings › About, onboarding step 1 | ≠ 9 |
| 106 | Connect Apple Health · Manage what iOS shares | Inline | Pinned button → iOS permission sheet / Health app | The OS owns it | Settings › Apple Health, onboarding, Day empty state | = |
| 107 | Remove a kind of reading | Screen | Pushed list; each removal → compact confirm | T3: every row needs its own confirm | Settings › Apple Health | ≠ 8 |
| 108 | Disconnect Apple Health and delete synced data | Compact sheet | Hug, danger | Destructive | Settings › Apple Health | = |
| 109 | Verification status (`verify`) | Screen | Pushed (today a page-sheet modal); Persona runs in its hosted flow | T7 `verified` returns here | Settings, You mark | = |
| 110 | Who sees what | Large sheet | Half, read-only | Peek | Row on Verification | = |
| 111 | Women-only sessions | Compact sheet | Hug; choice chips + what it requires | One decision with a consequence (ID check) | Settings › Safety | = |
| 112 | Membership & fees (`billing`) | Screen | Pushed, status-first | T7 `billing-return`, T3 | Settings, badges | = |
| 113 | Fee detail · Ask for a review | Large sheet | Hug → full when the reason field is focused; guard | One field; T4 | Fee row | = |
| 114 | Pay · start membership · manage in Stripe | Inline | Button → Stripe's hosted page | Card details never in-app | Fee sheet, Membership gate, Settings | = |
| 115 | Sign out | Compact sheet | Hug | Confirmation | Settings › Account | = |
| 116 | Delete account | Screen | Pushed; type the word; danger button | Deliberate friction; never swipeable | Settings › Account | = |
| 117 | Link and return handlers (`invite/[code]`, `open`, `billing-return`, `verified`) | Screen | Transient | T7 | Links | = |
| 118 | Account paused / suspended | Screen | Blocking state | Not a tap's answer | System | = |
| 119 | Receipts and confirmations ("Invited Maya ✓", "Saved to your log", Undo) | Inline | Toast or receipt line | T9 | Everywhere | = |

### 3.2 Where the draft spec and the framework disagree

1. **The "Plan sheet" is a Screen, plus a peek.** The draft makes `assistant/plan/[id]` a modal
   that opens three sheets, a confirm sheet and Report. That is a sheet with children (T3), and it
   is the app's main push-notification target (T7). Make it a pushed Screen — pushing keeps the
   Assistant tab mounted just as well as a modal does. Then add the **Plan peek** (item 58) for the
   moment the owner actually cares about: tapping "Review" in the conversation and approving
   without leaving it. The peek has no rows that open anything. *The framework is right; this is
   the most important change.*
2. **Find filters are chips, not a sheet.** Four booleans. A sheet hides their state behind a
   count, adds two taps per change, and needs a "Show results" button. Revisit only if filters
   pass about six or gain a range (distance, time window) — then a Large sheet with live result
   count.
3. **"What you're looking for" is a one-page edit, not a four-step flow.** One question per step
   is right for first run — and first run is already conversational (item 52). Editing later wants
   everything visible with Cancel / Save.
4. **`DraftReview` in a sheet is read-only.** Reviewing a drafted plan over the chat is a fine
   sheet. Editing exercises, sets and loads is the heaviest form in the app; "Edit" closes the
   sheet and opens the full-screen editor with the draft loaded.
5. **Log an exercise is a component sheet, not the route `training/log`,** and its time picker
   expands inline. `DayTimePicker` in its own sheet would be a stack.
6. **Rating must not chain into an "assistant offer sheet" and then a recap.** One sheet, one
   state change (rate → one offer). The recap is a card in the conversation.
7. **Conflict and recover prompts cannot be swipeable sheets.** They must be answered. Compact,
   non-dismissable, two buttons — or the native alert they resemble.
8. **"Remove a kind of reading" is a Screen,** because every row needs a destructive confirm.
9. **Full Terms and Privacy are Screens.** `LegalSheet` is for the paragraph behind one switch,
   not for documents many screens long.
10. **Weekly-session actions are a menu.** Three one-line items; only Leave earns a sheet.
11. **"Meet your assistant" for existing members must not arrive as an unprompted sheet.** Raise a
    Needs-you item; tapping it opens the same full-screen step new members see.
12. **"Flow (modal)" must mean full-screen modal.** `post` and `training-block/new` are iOS page
    sheets today, and `workout-plan/new` is pushed. Post and the workout-plan editor are guarded
    full-screen Modals. The page-sheet style is retired from the app: it swipes away typed work
    and turns every `Sheet` opened from it into a stack.
13. **Ask-the-assistant: keep, with a ceiling; drop it from threads.** Two turns, then "Continue
    in Assistant". A card inside it either acts in place (Join, Save to my log) or closes the sheet
    and navigates — it never opens the Plan peek on top. In a person-to-person thread, a second
    composer in a sheet above the first is confusing; use suggestion chips that draft into the
    existing input.
14. **`/needs-you`, `/assistant/ask`, `/training/log` are not routes.** Notifications link to the
    specific plan, session or goal, never to a list in a sheet.
15. **Train for a goal is small enough to be a sheet.** Three chip rows and one field: the
    framework moves this one *towards* a sheet, from the draft's modal flow.
16. **Draft principle 5 is too absolute.** "Destructive confirms, pickers and 'what this means' are
    Sheets, never inline expansions" should read: *try a menu, a chip or an Undo toast first; use a
    compact sheet when the consequence needs a sentence; use a large sheet for a peek or a long
    picker.* As written it will manufacture sheets.
17. **`today` as a modal (current code) is wrong; the draft's pushed Training › Day is right.**
18. **Approve / Pass / Decline on join requests stay inline.** The draft turns the goal's
    Pass / Approve into confirm sheets; an approval is not destructive and does not need one.

### 3.3 (a) Count and sanity check

| Presentation | Count | Share |
| --- | --- | --- |
| Screen | 26 | 22% |
| Modal (full-screen) | 8 | 7% |
| Large sheet | 22 | 18% |
| Compact sheet | 31 | 26% |
| Inline | 32 | 27% |
| **Total** | 119 | |

Sheets are 53 of 119 rows (45%), which looks high until you see what they are. Of the 31 compact
sheets, 12 are destructive confirms and 9 are consents or gates — each seen rarely, and each the
case where Apple and NN/g both say an overlay is justified. On the core loop (talk → approve → book
→ check in → work out → log) a member meets about five sheets: the Plan peek, Finish workout, the
rating, the workout picker and the Log sheet. Against the draft, the framework takes ten surfaces
*out* of sheets (notes 1, 2, 6 twice, 8, 9, 10, 11, 13, 18) and puts one *in* (note 15). The count
to watch is not the total but sheets per Screen (§3.5, budget of four) and sheets per core-loop
session.

**The five surfaces most at risk of "a sheet for the sake of it"**

| Surface | Why it is tempting | What it should be |
| --- | --- | --- |
| Find filters | "Filters live in sheets" is a habit from apps with forty filters | An inline chip row (item 20) |
| Weekly-session actions, and every other three-item "row sheet" | A glass sheet looks richer than a menu | An overflow / context menu (item 17); the sheet appears only for Leave |
| The Plan "sheet" with its own sheets | The plan is the hero object, so it gets the hero component | A Screen, with a childless peek for the approve moment (items 57–58) |
| Assistant help inside a chat thread | "Ask the assistant everywhere" | Chips that draft into the thread's own composer (item 42) |
| Rating → offer → recap | Each is small, so each became a sheet | One compact sheet with one state change; the recap is a chat card (items 39–40) |

Watch list (fine today, first to go wrong): the Needs-you list (if it grows actions, it becomes a
screen), "What's happened" (could simply be a section at the bottom of the plan Screen), "Share my
set counts" (after the first consent it is just a menu toggle), and the Ask sheet (the two-turn
ceiling is the only thing keeping it a sheet).

### 3.4 (b) The signature sheet moments

Eight places where doing the sheet superbly is what will make the app feel premium. Everything else
should be quiet.

1. **Plan peek — approve from the conversation.** Rises to half over the chat, which stays legible
   through the dim. `PlanTrack` fills to the current step as the sheet settles, not before. The
   pinned button's label is the next step. On tap: button → check (success haptic), the sheet
   lowers itself after a beat, and the receipt line is *already* in the thread as it uncovers.
   The person never navigates. When both have approved, the same peek shows the terms chips and
   "Accept and book" — nothing new to learn.
2. **Start looking — the consent.** Compact. One sentence on what buddies will see, "for 7 days",
   the women-only chip if eligible, one button. As it closes, the orb in the tab bar changes to
   *looking* — the cause and the effect are both on screen.
3. **Invite — "she sees this".** Compact. The body is a miniature of exactly what the buddy will
   see (first name, level, these times). The button carries her name. Receipt line afterwards.
4. **Metric peek on your day.** Half. The chart draws once as the sheet rises; scrubbing the chart
   gives a light tick per point and never moves the sheet (the sheet drags from its header only).
   Pull to full for the week. Closing returns focus to the tile that was tapped.
5. **Log an exercise — quick capture.** Opens full with the keyboard already up and the cursor in
   "What did you do?". Mic in the field. "Draft it for me" turns the sentence into steppers *in
   place* — the sheet does not change, its content does. Time is a chip that says "Just now". Save
   is pinned above the keyboard. Swipe it away by accident and the draft is still there next time.
6. **Start a workout — the picker hand-off.** Half, last-used plan first, each row showing length
   and exercise count. One tap: the sheet drops and the full-screen workout rises in the same
   motion, so it reads as the plan opening rather than as two transitions.
7. **Finish workout.** Compact over the live screen. Sets done, skipped and total time count up
   once. "Finish and save" → `SuccessMark`, success haptic, the modal closes onto the workout's
   record. "Keep going" is one tap and restores the exact set.
8. **Set your level.** Half. Choosing a level updates its one-line description immediately and the
   level chip on You *behind the sheet* — a live preview is what a sheet can do that a screen
   cannot. No Save button; selection is the save, with a quiet "Saved" by the title.

Common craft for all eight: the sheet arrives from the control that was tapped (origin matters more
than spring constants); a select haptic at each detent; content is ready before the sheet is up
(`Skeleton` inside a moving sheet looks broken — prefetch on press-in); the pinned button never
moves while content loads; the dim never goes darker than it needs to for the screen behind to stay
readable, because a readable background is the whole reason it is a sheet.

### 3.5 (c) Sheet rules for this app

**Dismissal.** Every sheet closes four ways — Close button, swipe from the header, tap outside,
Android Back / VoiceOver escape — *unless* it is dirty or must-answer. Dirty: tap-outside and swipe
stop closing and rubber-band instead; Close and Back ask "Discard?" with a native alert (the one
thing allowed above a sheet). Must-answer (item 91): no Close button, no gesture; two buttons.
Read-only and autosaving sheets always dismiss freely and never ask anything.

**Unsaved changes.** A sheet is dirty the moment a text field differs from its initial value or a
chip selection differs *and* there is a Save button. Sheets without a Save button (level, all sets,
private note) autosave and are never dirty. Forms in sheets use `keepMounted` so an accidental
close loses nothing; the next open shows the draft with a "Clear" link. Full-screen Modals (Post,
plan editor, looking-for) have no swipe-to-dismiss at all; Close asks once when dirty.

**Stacking.** One. A `Sheet` is never rendered from inside a `Sheet`'s children. To go from one to
another, close, wait for the close to finish, then open — and only when the person asked for it.
Before opening a `Sheet` from a route, check that the route is not itself a page-sheet presentation.
A sheet may change its own content once (form → result). Menus opened from a sheet's header are
fine; they are inline.

**Keyboard.** A sheet with a text field never rests at half: single-field compact sheets sit
directly on the keyboard; anything else opens full (`startFull`). The footer is pinned above the
keyboard and never scrolls away. The keyboard is dismissed before any sheet opens over a composer,
and restored when it closes if it was up. Number entry uses the number pad, and a four-digit code
submits on the fourth digit. Mid-workout, steppers replace keyboards wherever possible.

**Deep links and pushes.** Only Screens and Modals have routes. A link never opens a sheet
directly. Where a link's meaning is a sheet (rare — "rate your buddy" is the one real case), it
lands on the parent Screen with a parameter and the parent opens the sheet after its first frame,
so closing reveals a sane place. Old routes that are now sheets (`/today` aside, which is a Screen)
redirect to the parent.

**The assistant composer and sheets.** The composer is a pinned footer on a Screen (Assistant tab,
Home dock, threads). It is never the main content of a sheet, with one bounded exception: the Ask
sheet, capped at two turns. Home's dock does not open a sheet — focusing it goes to the Assistant
tab with the text carried over. `VoiceBar` never runs in a compact sheet. A card in the conversation
opens at most one sheet; approving inside that sheet posts the receipt into the thread underneath.
Streaming continues while a sheet is open over the chat, and the thread is never unmounted by one.
The Ask sheet is never offered on the Assistant tab itself.

**Tab bar.** Visible on the five tab roots only. Every pushed Screen hides it (they carry pinned
footers, and the two would fight). Sheets and Modals cover it; that is what the HIG allows and it
tells the person the moment is temporary. A sheet never sits *above* the tab bar leaving the bar
tappable — that reads as navigation and invites a tab switch with a sheet still open. If a tab
switch is triggered programmatically (Home dock → Assistant), any open sheet closes first.

**Android Back.** Back closes the top sheet entirely, from any detent — it does not step full →
half → closed. With dirty input it triggers the discard prompt. On a full-screen Modal, Back equals
Close (with the same guard). On Live and Workout-in-progress, Back closes the modal; nothing is
lost because both save continuously — say so in the toast ("Your workout is saved. Continue any
time."). RN's `Modal` does not animate predictive back; accept that for now.

**VoiceOver and other assistive tech.** On open, focus moves to the sheet's title and the title is
announced with its role; on close, focus returns to the control that opened it. Content behind is
hidden from the accessibility tree (`accessibilityViewIsModal` is already set). The two-finger
scrub dismisses (add `onAccessibilityEscape`), subject to the same dirty guard. The grabber is an
adjustable control labelled "Sheet height" with Expand / Collapse actions, so resizing does not
require a drag. The visible Close button stays, always, at 44 pt. Every gesture has a button
equivalent. Dynamic Type: a compact sheet that no longer fits becomes a half sheet that scrolls,
with the footer still pinned — test every compact sheet at the largest accessibility size, where
"five lines of body" becomes fifteen. Switch Control and Full Keyboard Access must be able to reach
Close first or last, never have it skipped.

**Reduced motion.** No spring, no overshoot, no rubber-band, no corner-radius morph: the sheet and
the dim cross-fade in about 150 ms (today it snaps in 0 ms, which is abrupt rather than calm). The
picker-to-workout hand-off (moment 6) becomes two plain fades. Haptics stay — they are not motion.

**Glass.** Blur is for the sheet's chrome, as the visual system already says. In dark mode a sheet
is one step lighter than the page so it separates without a border. Over photo heroes and charts,
check the title and Close button for 4.5:1 and 3:1 against the *blurred* result, not the token.

**A budget, to keep it honest.** No Screen may own more than four sheets (the workout detail and
the plan Screen are at the limit). Any new sheet added after this table must name the test that
ruled out Inline. If a sheet is opened by fewer than one visit in twenty to its parent, it was
probably a menu item.

### 3.6 Questions that genuinely need the owner

1. **One plan surface or two?** The recommendation is a pushed Plan Screen plus a childless Plan
   peek over the conversation (note 1). It is the best version of "tap, and a sheet specific to it
   opens", but it is two presentations of one object to build and keep in step. The cheaper
   alternative is the Screen only.
2. **Can deletes be undone on the server?** If logs, workouts and plans could be soft-deleted for a
   few seconds, five destructive confirm sheets (item 70) become swipe-to-delete with an Undo toast
   — fewer sheets, and closer to what Apple recommends for routine deletions. Today they cannot,
   so they stay confirms.
3. **Should Join ever confirm?** The table confirms only inside the 12-hour window, when leaving
   would cost $5 (item 25). If the owner wants the fee line seen on *every* join, that is a compact
   sheet on the most frequent action in the app — a real cost to weigh.
