> Appendix to [PLAN-V2-PROPOSAL.md](PLAN-V2-PROPOSAL.md): each piece of owner feedback (F1–F15) run against the existing plan and the merged code.

# F1–F15 against the plan: impact

Sources: MP = `docs/design/MASTER-PLAN.md`, PRD = `docs/PRD-v0.4.md`, SvS = `docs/design/sheets-vs-screens.md`, main = origin/main 25ccf17. Sizes: S = small, M = medium, L = large.

## 1. Impact matrix

| # | Touches | Verdict | Size | Built code |
|---|---|---|---|---|
| F1 Glass in light and dark; never remove; no OnlySweats | MP §1, §8.3 | Confirms | S | Keep |
| F2 Home fits one screen; the read holds the readings; charts in a modal | MP §3.1, §11.1(f); Phase 6 | Confirms | S | Keep `TodayCard` (now on the Sessions tab). Rework: `/today` is a pushed screen and should become the Today sheet |
| F3 Agent in the spotlight; training out of settings | MP §2.1, §3.2, §3.10; Phases 5, 9 | Confirms | M | Keep #58/#60. The Training hub is new |
| F4 Sheet-first, in balance | MP §0.2, §1.1–1.2, SvS; Phases 1–3 | Confirms. SvS already is that balance | S | Keep the sheet kit and `PlanPeek` |
| F5 Terms asked once; one Health ask; opt-ins and Persona in onboarding; voice | MP §3.16, §6, §7, §11.1(a)(b)(g); Phases 7, 12 | Confirms | M | Keep `AppTermsGate` and `HealthStep`. Rework the per-reading switches in `/health`. New onboarding steps 5–7 |
| F6 Screens can't be understood; no flow | MP §0.1; duplication in main | Extends. The plan fixes how things are presented, not the duplication | M | Rework so each feature has one home |
| F7 The goal is an accountable partner | PRD promise; MP §3.16 first run | Confirms PRD; extends MP (goal first) | S | Keep `setGoal`. Rework the first-run script |
| F8 Free-form chat | MP §3.2; PRD | Confirms | — | Built (#58, #60) |
| F9 Agents coordinate quietly | PRD steps 2 and 5; MP §6, §10.7, §11.1(c) | Contradicts MP, where a 24-hour grant ships off | M | Keep A2A. The consent default is the owner's call |
| F10 Say it and it gets created, e.g. post a run | MP §7, §10.1; PRD step 4 | Confirms. Voice extends it | Text S, voice L | `draftSession` is built. Voice needs a native build |
| F11 Four pillars, including a marketplace | PRD pillars; absent from MP | New to MP | L | New |
| F12 Subscription plus tips or hourly mentors | PRD Money [Decision — owner]; MP §3.17 | New | L | New. Stripe Connect is off |
| F13 Home is a dashboard; tabs Home · Sessions · Chat · Exercise · Me | MP §2.1, §3.1, §11.1(h); PRD tabs; #58 | Contradicts PRD and #58; mostly restores MP | M | Rework `_layout`, `index`, `mine`, `agent-home`. The Exercise tab is new |
| F14 Brainstorm against the plan | — | Process | — | — |
| F15 Text-first chat, chips, an exercise agent, a buddy "if there is a match" | MP §3.2, §5; PRD cards; #60 | Contradicts the PRD card model; agrees with the F13 split | M | Rework `agent-home`, `ActionCard` and `AgentActionCard`. Keep the chips and the server tools |

## 2. How the feedback drifted

1. **What Home is.** F3 and F8 ("all using the agent") led to PRD and #58: "the app is the conversation". F13 then says Home "still needs to be the dashboard". **Resolved by F13:** Home is a dashboard, and Chat is its own tab in the centre.
2. **Which tabs.** MP had five tabs, #58 has three, and F13 names a different five. F13 ends in a question mark, so treat it as tentative. **Open:** F13 names no Chats or Find tab. It doesn't say where the list of plans the agents are working out (`inbox`), Find, or member-to-member threads go.
3. **Cards or prose.** F4 (edits happen in a sheet) and F10 (it creates things, shown as PRD cards) pull against F15 (no components in the chat). F15 settles only the chat window. **Open:** where a draft gets reviewed or edited: a reply in chat, a sheet, or a form.
4. **Is the partner central or optional?** F7 and F9 say the goal is a partner. F15 asks for an exercise agent that finds a buddy "if there is a match". **Not resolved.** F15 reads as solo-first.
5. **Money.** F11 asks for a marketplace; F12 says "perhaps" tips. **Open.** These are still owner decisions.
6. **Where exercise lives.** F3 said it was buried, MP put a Training hub under You, and F13 makes it a tab. **Resolved:** Exercise is a tab.

## 3. What survives unchanged

- **Phase 1 kit:** `Sheet`, `ConfirmSheet`, `OverflowMenu`, `Toast`, `SwipeRow`, `GlobalSheets`, plus the five presentation types, tests T1–T9 and the hard limits.
- **Phase 2:** the join rule (one tap more than 12 h ahead, the $5 compact sheet inside 12 h), confirm sheets and the verify-gate sheet.
- **Phase 3:** `assistant/plan/[id]`, `PlanSummary` and `PlanPeek`. The peek is the natural "review" target behind an F15 confirm.
- **Phase 4 part 1:** `app/settings/*`, `SettingRow` and `StatusHero`.
- **#60 server:** 14 tools, server-side execution, receipts, the 30-minute expiry, polling, and location-or-code check-in. Text-first changes how cards look, not the contract.
- **Chat:** `CloudChat` streaming, `getChatClock`, and the `AgentOpening` greeting and chips. The chips F15 asks for already exist.
- **Other built pieces:** `TodayCard`, `NextUp`, `TrackRings`, `workout-run/[id]` with `OnlineRun`, the `workout-plan*` routes, `AppTermsGate` and `HealthStep`.
- **Plan text:** the MP §3.1 Home spec (the fit rule, Needs you, "Today · our read", the drop order), §3.16, §6, §7, and §11.1(a)(b)(e)(f)(g)(h)(j)(k).

## 4. What must change or be re-homed

- **`(tabs)/_layout.tsx`:** go from 3 tabs to 5 with Chat in the centre, and fix the stale comment.
- **`index.tsx`:** becomes the dashboard again, built from:
  - the first screen of `mine.tsx`;
  - the `AgentCard` stack from `agent-home.tsx` (Needs you, Next session, the goal with `PlanTrack`).
  
  The Chat tab keeps only the greeting, the chips and the thread.
- **Sessions tab:** Find (`sessions.tsx`), Coming up, Every week, and the agents' plans (`inbox.tsx`). The Chats tab from MP §3.9 is re-homed here.
- **`/assistant` and hidden `/agent`:** fold into the Chat tab.
  - The Plans view moves to Sessions.
  - `AssistantPreferencesEditor` becomes a sheet.
  - MP §3.2's three panes are obsolete. Its Buddies list also breaks "one person at a time".
- **Exercise tab:** the MP §3.10 hub, promoted to a tab. It holds `/today`, `/health` workouts, `/fitness` and `/workout-plans`.
  - `TrainingShortcuts` and the "Your training" tile on You become redundant.
  - The per-reading switches in `/health` move to Settings as "Stop syncing" (§11.1(a)).
- **Cards:** in `ActionCard` and `AgentActionCard`, show facts as plain lines (today long disclosure sentences render as chips), with one confirm. Two requests for Codex:
  - Cap person cards at 1.
  - Let a typed "no" or "change" decline, since declining isn't consequential.
- **Plan and PRD:** rewrite MP Phases 5, 6 and 9. The PRD needs a v0.5, because "There is no dashboard" and "never navigate to a form" are no longer true.
- **Clean-up:** remove "Jev" and "Private template · Version N" from the copy, and fix the `/you?rename=1` bug.

## 5. Three biggest risks

1. **Churn hurts clarity.** This would be the third tab structure in 48 hours, and none of them has been used on a phone. F6's confusion comes from duplication: the chat lives in three places and Apple Health has about seven entry points. The number of tabs isn't the cause. If Home, Sessions and Exercise each show "next session" and "today", five tabs recreate the problem.
   - **Guard:** each object has one owner, and Home only points to it.
2. **Scope competes with launch.** F11 and F12 need Stripe Connect, identity checks, payouts and tax forms. Voice needs the microphone permission, a speech module, a new build and App Review. All of these are L, and TestFlight (the 502), Persona, Stripe live and the HealthKit device checks are still open. The redesign is JavaScript-only and ships over the air; money and voice do not.
3. **Marketplace liability and privacy.**
   - **Liability:** many gyms prohibit outside trainers from charging on their floor. There is injury and unlicensed-coaching liability, and insurance. Background checks aren't built (FCRA).
   - **Privacy:** an exercise agent that reads Apple Health and also negotiates on its own (F9) can leak judgments drawn from health data into agent-to-agent talk, e.g. "she's recovering, suggest easy". Health data must never shape what gets shared.

## 6. Pushback

- **F15 is right about the tax but wrong about the cure.** The dashboard feel comes from the `AgentCard` stack inside the chat, so move it to Home, as F13 already implies. Pure text fails in three places:
  - A consequential step needs a tap tied to the exact terms (standing rule).
  - An 8-exercise plan reads worse as prose than as a list.
  - Ticking off sets through chat mid-workout is unusable, so that stays in `workout-run`.
  
  **Rule:** text by default. Add an element only when it carries the tap, or when it's a list the member will act on.
- **Testing the designer's view.**
  - **Agreed:** chips, and plain-text answers for read-only questions.
  - **Weak spot:** a confirm on money or a booking can't be minimal. It has to restate the time, place and fee, and it expires.
  - **Chips:** they must follow context (three at a time, changing with state) or they turn into a menu. Today they disappear exactly when the agent needs you.
- **"Exercise agent" is weak positioning.** Solo AI coaching is a crowded field (Apple, Whoop, Strava, general chatbots). SamePace's edge is a person who expects you to turn up. Keep solo coaching as the fallback in quiet areas, not the pitch. Replace "a buddy if there is a match" with "working on your buddy; meanwhile, here's today".
- **F13 rebuilds two agent surfaces.** A dashboard Home next to a Chat tab brings back the split #58 removed.
  - Keep Home free of a composer (MP §11.1(h)); tapping its box should jump to Chat.
  - Home and Sessions overlap heavily. Consider four tabs, with Home holding sessions. This is an open question for the owner.
- **F5's "ask for everything" in Apple Health.** Data minimisation and App Review favour asking only for what the read needs: heart rate, resting heart rate, HRV, sleep, workouts and steps.
- **F9's autonomy.** Agents can propose times without asking, but a booking still needs both taps. Autonomy should stay off by default until the consent record is signed off.
- **F11 and F12 are premature.** They add three ways to charge before there is a single paying member. A paid mentor's agent also has a reason to sell, which undermines quiet matching. Ship buddies plus the subscription first. Add mentor later as an unpaid role (the `role` hook already exists), and add money after that.
- **F4, F15 and PRD conflict on editing.** F4 says edits happen in a sheet, F15 says free-form chat, and PRD says never a form. Pick one: change things by saying so in chat, and keep the 4-step Post modal for people who prefer a form.