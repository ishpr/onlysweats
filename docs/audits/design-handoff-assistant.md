# Design handoff: assistant, Today and fitness surfaces

For whoever builds features on these screens (Codex's `codex/intelligence-experience`
work in particular: the conversational assistant, health zones, watch, Live Activity).
The aim is one product, not two styles. Everything below is already on `main` or in
the PR that adds this file. All of it is presentational — no data or network inside.

## Rules that apply everywhere
- Tokens only: colours from `useTheme()`, spacing/radius from `constants/theme`. No hex,
  no inline `gap: 14`. Check **light and dark**; light has no black slabs.
- Show, don't list. A reading gets a chart or a tile; a plan gets a photo card; progress
  gets a track. Paragraphs are for consent text only.
- Detail lives one tap away (a modal/sheet), not on Home. Home's first screen must fit
  above the tab bar.
- The assistant never acts alone: every action is a card the member approves.
- Member-facing words: buddy, session, spot, meeting point, plan. Never "revision N",
  "negotiation", "proposal revision", "consent changed", "partner".
- No red for anything that isn't an error. Health readings are facts compared with the
  member's own week — never a score, never advice.

## The kit
| Need | Use | File |
| --- | --- | --- |
| Assistant status at the top of its screen | `AssistantHero`, `assistantStatus()` | `components/assistant-hero.tsx` |
| The assistant's face (pulses while working) | `AssistantOrb` | same |
| Home row for the assistant | `AssistantSpot` | same |
| Chat message | `ChatBubble from="me" \| "assistant" source="On this iPhone"` | `components/assistant-kit.tsx` |
| Streaming / thinking | `TypingDots` inside an assistant `ChatBubble` (not the text "Thinking…") | same |
| A tool request the member must approve | `ActionCard` (icon, title, fact chips, one-line note, primary/secondary) | same |
| Message box | `Composer` (send turns into stop while streaming) | same |
| Mode switch (On this iPhone / Cloud; Chat / Plans) | `Segmented` — not a row of `Chip`s | same |
| A plan (proposed, option, agreed) | `PlanCard` — same photo card a session gets | `components/assistant-plan.tsx` |
| Where a plan stands | `PlanTrack done={0..5}` (Joined · Plan · Approved · Terms · Booked) | same |
| Who has approved | `Approvals` | same |
| What happened / what each agent did | `TimelineItem` (coordination steps should use this too) | same |
| A reading over a day or week | `AreaChart`, `WeekBars`, `StageBar`, `DayDial` | `components/charts.tsx` |
| Fitness log header and entries | `FitnessSummary`, `LogCard` | `components/fitness-kit.tsx` |
| Sections and settings rows | `SectionTitle`, `ListCard`, `ListRow` | `components/list.tsx` |

## How the chat should sit on the assistant screen
1. `AssistantHero` stays first — it answers "what is it doing for me right now".
2. Under it, one `Segmented`: **Chat** · **Plans**. (Today that is two chips.)
3. Chat pane: messages as `ChatBubble`s, newest at the bottom; tool requests as
   `ActionCard`s in the assistant bubble's `footer`; `Composer` last. Privacy choices
   and "delete conversation" go in **Controls** at the bottom (a `ListRow` each), not
   in a card above the messages.
4. On-device vs cloud is a small `Segmented` above the composer, and each assistant
   bubble says which one spoke via `source`.
5. An imported draft in the fitness log is an `ActionCard` at the top of the editor
   ("Imported from your plan — confirm the sets you actually did").

## Health zones, RMSSD, watch
- Zones: a `StageBar` (one segment per zone, coolest to warmest using `stand`,
  `exercise`, `accent`, `move` at reduced alpha — not a rainbow) plus minutes per zone
  as chips. Put it in the workout detail and as a tile in the Today sheet.
- RMSSD is a second HRV tile beside SDNN in the Today sheet, labelled by what it is
  ("HRV · RMSSD"), each with its own `AreaChart`. Don't merge the two.
- `GET /health/today` (`src/lib/health/today.server.ts`) is where new day-level
  reductions belong; `shared/today.ts` holds the types and the plain-language read.
- Live Activity / watch faces: gauge language from `DayDial` (fills up, never red).

## Rebase notes
- `migrations/0026_health_glucose.sql` is on `main`. New migrations start at `0027`.
- `blood_glucose` was added to `shared/health.ts`, `contracts.ts`, `HealthKitReader.swift`.
- `mobile/src/app/assistant.tsx`: the main component was rebuilt around the hero (plans
  in progress → find a new buddy → past buddy → Controls). `PlanDetails` now renders a
  `PlanCard`; the conversation header is a `PlanTrack`; history is a timeline.
- `mobile/src/app/fitness.tsx`: summary first, editor second, saved exercises as
  `LogCard`, and the AI/study permissions moved to the bottom under "Assistance and
  privacy". `LogEditor` itself is untouched.
- The phone build (`device` profile) talks to production; only the simulator uses a
  local API. Two Metro servers run side by side (`:8081` design, `:8093` backlog).
