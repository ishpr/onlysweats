# Functional handoff: the agent's tools (PRD v0.4)

For the functional owner. PRD v0.4 (`docs/PRD-v0.4.md`) makes the conversation the app: every
action is a card in the thread with one button. Today the chat can only *talk* and hand off to
cards that navigate (`ChatAction.kind` → a route). This asks for tools that *act* — each one
returning a **draft card** the member approves with a tap, and the write happening only on
that tap.

## The contract the app needs

Extend `shared/conversation.ts`'s `ChatAction` with a `card` the app can render and act on
without navigating:

```ts
type ChatCard =
  | { kind: "goal_draft"; goal: { label: string; activity: Activity; date: string } }
  | { kind: "person"; memberId: string; firstName: string; level: string; record: string;
      sharedTimes: string[]; role: "buddy" | "mentor"; rateCents?: number }
  | { kind: "session_draft"; session: SessionInput }            // from "post a run Tue 6am…"
  | { kind: "plan"; negotiationId: string }                     // approve / accept-and-book
  | { kind: "workout_plan_draft"; plan: AIWorkoutPlanDraft }     // exists today
  | { kind: "checkin"; bookingId: string }
  | { kind: "progress"; kept: number; planned: number; goalDate: string }
  | { kind: "again"; bookingId: string }
  | { kind: "receipt"; text: string };                           // what a tap did
```

Each card has exactly one primary action, executed by the app against an existing endpoint on
the member's tap. The model never calls a write.

## Tools, in priority order

| # | Tool (model-facing) | Returns | Tap → existing endpoint |
| --- | --- | --- | --- |
| 1 | `setGoal(label, activity, date)` | `goal_draft` | `POST /training-blocks` (or the goal fields on preferences) |
| 2 | `setLookingFor(activity, ability, durationMin, times, venueIds, role)` | receipt | `PUT /agents/preferences` — and in the same tap `PUT /agents/discovery` (one approval, not two) |
| 3 | `findPeople()` | one or more `person` cards | `GET /agents/discovery` — **needs level and show-up record on the candidate** (today: name, activity, shared venues only) |
| 4 | `askPerson(memberId)` | receipt | `POST /agents/discovery/invitations` (+ 24 h coordination permission if the card says so) |
| 5 | `draftSession(title, activity, startAt, venueId, capacity, ability)` | `session_draft` | `POST /sessions` |
| 6 | `reviewPlan(negotiationId)` | `plan` | `POST …/confirm`, then `POST …/book` with the terms hash |
| 7 | `findSessions(filters)` / `joinSession(id)` | session cards | `GET /sessions`, `POST /sessions/:id/bookings` |
| 8 | `answerRequest(bookingId, yes)` | receipt | `POST /bookings/:id/approve` / `decline` |
| 9 | `draftWorkoutPlan(...)` | `workout_plan_draft` | exists |
| 10 | `logSet(runId, exerciseIndex, setIndex, actual)` | receipt | `POST /fitness/runs/...` |
| 11 | `myDay()` / `myProgress()` | `progress` | `GET /health/today`, runs + bookings |
| 12 | `checkIn(bookingId)` | `checkin` | the live check-in endpoint |
| 13 | `againNextWeek(bookingId)` | `again` | `POST /bookings/:id/repeat` |
| 14 | `recapSession(bookingId)` | receipt | new read: booking + `/health/workouts` + `/fitness/runs` in the session window; private to the member |

## Also needed

- Send the device **timezone and current time** in every turn (`ChatTurnInput`); delete the
  prompt's "ask for exact date and timezone".
- Keep the thread mounted while a card acts; **post the receipt back into the thread**.
- Push plan-state changes (buddy joined, plan ready, booked) into the conversation as cards.
- The first-run conversation: the model's opening turn asks "What are you working toward?" and
  the three chips are the tool's suggestions, so a new member reaches "looking" without a form.
- **Mentors** (owner decision pending): a `role` on preferences and discovery, a rate on the
  mentor's profile, hold-at-booking / release-on-dual-check-in via Stripe Connect, payout, cut,
  earner verification gate. Tips: `POST /bookings/:id/tip`.
- Production conversation is already funded and enabled with `zai/glm-5.3-flash`. Preserve the backend-selected model and distinguish loading, account settings, and temporary service availability; a simulator fallback does not establish production configuration.

## Words

The card copy the app shows is written by design; the model's text should use: your agent, your
partner, your mentor, your goal, session, plan, meeting point, show up. Never: negotiation,
revision, consent, provider, coaching, matching.
