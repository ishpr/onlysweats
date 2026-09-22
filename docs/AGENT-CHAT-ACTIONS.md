# Agent actions in the conversation

Implemented after the chat-first Home in PR #58. The mobile app advertises `agentCards: true`; older clients continue receiving the existing navigation cards. The server still chooses `zai/glm-5.3-flash`. There is no model picker or additional AI activation flow.

## Review, execute, receive a receipt

The conversational model can read bounded permitted state and prepare a review card. A completed reply stores the exact proposed command on the server. Streaming previews, generated text and a typed “yes” cannot execute it. The member taps the card; the app submits its action ID and conversation generations to `POST /assistant/actions/:id/execute`. It never submits a model-written command.

The authenticated endpoint checks the owner, current Terms/settings, expiry, account status, current source revisions and domain rules. Commands and receipts commit in one transaction. Repeating a tap or retrying a lost response returns the same receipt. A stale card cannot change a newer goal, preference, workout result, proposal or session. Review cards expire after 30 minutes; completed receipts are retained within the existing 30-day conversation retention period.

Workout writes can invalidate a conversation that used the changed source. The executing transaction preserves only its minimal receipt and posts it into the new conversation generation. Other drafts are removed. Deleting history or changing conversation permissions removes pending actions and receipts. Account deletion cascades the new private goal, action and plan-update records.

## Tools and effects

| Model tool | Review or read | What a member tap does |
| --- | --- | --- |
| `setGoal` | A private label, activity and date | Saves the goal with a revision check; does not create a group or training block |
| `setLookingFor` | Level, duration, public venues, dated availability and buddy-matching scope | Saves preferences and bounded matching authority together |
| `findPeople`, `askPerson` | Compatible candidates with level, recorded attendance and shared options | Asks the selected person's agent through the existing agent-contact service; no direct member message |
| `draftSession` | Complete session facts and fee terms | Posts the reviewed session |
| `reviewPlan` | Current shared plan or exact booking terms | Records this member's next approval; booking occurs only after both members approve the plan and matching terms |
| `findSessions`, `joinSession` | Visible upcoming sessions and join rules | Requests or confirms a seat through the normal booking rules |
| `answerRequest` | One owned pending seat request | Approves or declines that request |
| `draftWorkoutPlan` | Planned exercises, sets, units and rest | Saves the plan and starts an empty workout record; an Open workout card leads to the existing timer and set checkoffs |
| `logSet` | An explicitly reported actual result in an authorized owned run | Saves that set, preserving other results and existing sharing settings |
| `myDay`, `myProgress` | Private goal, bounded owned booking records and selected permitted history | Read-only; source flags default to false |
| `checkIn` | Confirmed booking and arrival requirements | Uses fresh device location or a code typed into the card; the model cannot supply check-in evidence |
| `againNextWeek` | The standing weekly commitment derived from an eligible completed session | Creates the recurring slot through existing mutual-attendance rules |
| `recapSession` | Owned booking plus selected permitted records near its time | Read-only; coinciding workout timestamps do not prove participation |

Read tools do not run settlement or close training blocks. Known public venues and authorized shared-plan IDs are available through `readPlanning`. Authorized manual-history results include bounded run and set references so follow-up logging works without asking members for internal IDs. IDs stay out of member-facing prose.

## Conversation continuity

Every mobile turn includes its IANA timezone and device clock. The server clock controls deadlines and eligibility; the device hint only helps interpret relative dates. A validated pending workout draft can be recalled for requests such as “make the second exercise easier,” within the existing conversation size budget. This never treats targets as actual exercise.

The agent's first-run instructions start with the member's goal, then level, public meeting place and available times. Private goals are available at `GET /assistant/goal` and appear in the existing Home opening. Claude owns further presentation and onboarding refinements.

Capable foreground chat views refresh every 15 seconds. A bounded, deduplicated server check adds cards when an authorized shared plan becomes ready, a partner approves, or a real booking is created. It adds at most three updates per poll, skips active model replies, and makes no model or health-history calls. Background notifications continue through the existing notification system; this is foreground polling, not a new WebSocket channel.

## Boundaries and remaining work

- Existing privacy opt-outs and separately authorized Health/manual sources remain respected. HRV, sleep, raw samples and a partner's private health data are not exposed by these tools.
- Jev remains responsible for the existing typed fitness judgments. Conversational GLM drafts and deterministic services handle this action flow; no extra Jev classification is needed to execute a known command.
- Paid mentors, Stripe Connect payouts, hourly holds/releases and tips are not implemented by this change. The conversation must describe them as unavailable.
- Device acceptance of the new chat action flow, physical Health/Watch checks, provider production acceptance and a current standalone TestFlight release remain distinct launch checks. Automated fixtures are not evidence of those checks.
