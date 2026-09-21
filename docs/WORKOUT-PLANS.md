# Shared workout plans

SamePace now connects a reusable routine to a buddy session and each member's private workout record. A prescription is never treated as completed activity.

## Member flow

1. Open **Workout plans** from the assistant or fitness log. Create a private template by hand, import a reviewed text/photo draft, or request an editable on-device AI suggestion.
2. Add exercises, instructions and individual set targets: repetitions, time or distance, optional external load, and rest. Reorder exercises or use different targets for each set.
3. Open a hosted session's **Our workout plan** and attach the reviewed template. This publishes a fixed copy to confirmed buddies. The first plan can be added before the session starts, including to an agent-arranged meetup that already has a buddy. Once another member requests a seat or anyone starts recording, an existing plan cannot be replaced or removed. Later library edits never change it.
4. Both buddies review the same plan before the meetup. Each can save a private template copy. Within 30 minutes before the session, each explicitly starts their own workout record against the exact plan identity and revision shown. Starting a private template independently also works.
5. Enter actual results for each set, skip a set, and use the optional foreground rest timer. Planned amounts do not prefill actual results. Finish with a review of completed, skipped and unrecorded sets; partial workouts are valid.
6. Progress sharing is off by default. Choosing to share exposes only name, workout status and completed/skipped/planned set counts to the current session group. It never exposes repetitions, weights, notes or health measurements. Turning it off removes that summary.

Saved results can be corrected with revision checks or deleted. Fitness export includes private plans and workout records. These records remain distinct from HealthKit observations and booking attendance: no calorie estimates, attendance credit, duplicate HealthKit writes or automatic completion is produced.

One pending result form can be recovered from protected device storage for up to 24 hours. Recovery is bound to the signed-in member and workout, requires explicit review, and never overwrites a newer server revision automatically. Sign-out clears it. This preserves interrupted edits; saving results still requires connectivity and it is not an offline queue for an entire workout.

## AI boundaries

- **On-device generation:** Foundation Models produces a separate, bounded suggested prescription from the submitted request. Native and JavaScript validators check its shape. No health readings, account identity or images are sent to a server. Requires an eligible device, available Apple Intelligence model and the new native plan capability; unavailable devices retain the manual editor.
- **Existing photo/text extraction:** the member can hand all reviewed extracted exercises to the plan editor. Missing targets still require review. Extracting a plan never proves that it was performed.
- **Cloud conversation:** a capable client can receive one `workout_plan` review card per reply through the existing private conversation consent. The model's tool can suggest a draft only. The existing time, tool, generation, revocation and privacy controls apply; responses use up to 2,400 tokens for clients supporting plans. Older clients retain the 1,200-token tools and have new plan cards filtered from history/replay.
- **Jev:** the installed TypeSafe integration continues its typed exercise/intent judgments. Freeform routine instructions use a conversational language model. Typed output validates an interface, not correctness or exercise suitability.

No path automatically falls back from local AI to cloud processing. Cloud model activation and representative live evaluation remain separate from software validation.

Both authoring models specify an explicit target unit; code converts minutes to seconds and validates the resulting draft. Previews separately total explicit timed targets, planned rest and sets, excluding untimed sets and instruction-only phases. A live synthetic Mac evaluation found a warm-up described only in general instructions, so the review asks members to check every requested phase and duration. See the [dated evaluation, including initial failures](evaluations/workout-plan-local-v1-2026-09-21.md).

Cloud follow-up edits retain one bounded, validated unsaved draft in conversation context. The assistant does not read saved private plans or manual workout results: its optional fitness-summary tool still covers only the last five imported HealthKit workouts under the existing permission notice.

## Data and permissions

`0029_workout_plans.sql` adds owner-scoped `workout_plans`, immutable `session_workout_plans`, and owner-scoped `workout_runs`. All routes use ordinary signed-in member sessions, never delegated A2A credentials. A2A-created bookings can use the same host-controlled session flow.

Plan and workout creation use client UUIDs for retries. Updates require the current revision. A session has at most one current published plan and one workout record per member. Source-plan identity and revision fence removal, copying and starting. Session access respects membership, bilateral blocks, account deletion and suspension under the same ordered profile/session locks used by booking.

Deleting a template leaves deliberately shared session copies and existing workout snapshots intact. Deleting the author account removes its private plans, results and shared attachment. Another member's already saved copy or private workout snapshot remains their own record. The sharing review explains this copying boundary. Suspended owners can still read, export and delete their private data.

Limits: 500 library templates, 12 exercises per plan, 20 sets per exercise, 120 sets total, and 10 unfinished workouts. These are storage/validation ceilings, not training recommendations. Requests and list pages are bounded; sensitive error bodies and SQL parameters are not logged.

## Acceptance

Automated tests use synthetic routines and members. They cover owner isolation, explicit sharing/revocation, actual-versus-planned fields, immutable session copies, revision races, booking/sharing/blocking/deletion lock order, exports and account cleanup. The A2A protocol test proceeds through mutual proposal confirmation, booking-term approval, first-plan attachment and exact-version workout start. Nine real PostgreSQL concurrency checks and 41 authenticated local HTTP checks passed. Provider adapter tests use the real SDK with mocked model output. Native checks compile against the installed SDK and test parsing; these checks do not demonstrate model quality or physical sensor behavior.

Still require actual-device testing: complete a two-person workout, interrupt connectivity while entering sets, recover unsaved edits, switch accounts, use accessibility tools and review AI-generated routines with representative members. The broader launch checklist remains in [VISION-ROADMAP.md](VISION-ROADMAP.md).

The [dated release checks and signed iPhone build](evaluations/shared-workouts-release-2026-09-21.md) record what was verified and what remains pending.
