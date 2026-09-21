# Shared workout plans

SamePace now connects a reusable routine to a buddy session and each member's private workout record. A prescription is never treated as completed activity.

## Member flow

1. Ask the built-in coach for a routine. Its validated draft appears as an exercise/target card with **Review & start**; the full explanation stays under **Coach notes**. Or open **Workout plans** from the assistant or fitness log to create a private template by hand, import a reviewed text/photo draft, or request an editable on-device AI suggestion.
2. Review the full plan, edit exercises and individual set targets as needed, then choose **Save & start workout** or **Save for later**. Editing returns through review before a write. Save/start retries preserve the same identifiers and reviewed content when a response is lost. Set targets support repetitions, time or distance, optional external load, and rest; exercises can be reordered.
3. Open a hosted session's **Our workout plan** and attach the reviewed template. This publishes a fixed copy to confirmed buddies. The first plan can be added before the session starts, including to an agent-arranged meetup that already has a buddy. Once another member requests a seat or anyone starts recording, an existing plan cannot be replaced or removed. Later library edits never change it.
4. Both buddies review the same plan before the meetup. Each can save a private template copy. Within 30 minutes before the session, each explicitly starts their own workout record against the exact plan identity and revision shown. Starting a private template independently also works.
5. Start a foreground exercise timer for a timed set, pause/resume/reset it, and explicitly use the elapsed time in the editable duration field. Save the completed set after review, or record actual values manually or skip it. Planned amounts never prefill actual results; reaching a target does not complete a set. The optional rest timer starts after a completed-set save. Timers pause when leaving the screen or app and are temporary; confirmed entries follow the existing protected recovery and save flow. Finish with a review of completed, skipped and unrecorded sets; partial workouts are valid.
6. Progress sharing is off by default. Choosing to share exposes only name, workout status and completed/skipped/planned set counts to the current session group. It never exposes repetitions, weights, notes or health measurements. Turning it off removes that summary.

Saved results can be corrected with revision checks or deleted. Fitness export includes private plans and workout records. These records remain distinct from HealthKit observations and booking attendance: no calorie estimates, attendance credit, duplicate HealthKit writes or automatic completion is produced.

The fitness log's seven-day summary includes actual saved sets from both individual exercise logs and structured workout results, including unfinished workouts with completed sets. It is independent of which history page is open. Days use the device's calendar time zone, with sets attributed to their log/workout start day; no per-set timestamps are inferred. Skipped and unrecorded sets stay excluded. Reps, entered set time and known external-load volume show their coverage; missing quantities stay unknown and body mass is never estimated.

Already-started workouts can be opened while connected and then logged offline, including multiple sets, notes and a partial finish. The device keeps the fixed prescription, actual entries, pending form and an immutable pending upload together in an encrypted file; its key lives in device-only protected storage. A later edit never changes the payload of a request whose response may have been lost. Server-confirmed weekly totals and buddy progress do not include unsynced changes.

Up to ten opened workouts are retained for seven days from their last device save or refresh. Offline access requires the same stored sign-in token and a successful account check within the last 24 hours; cached responses do not renew that lease. Sign-out/account switching clears the protected data. A **Saved workouts on this iPhone** entry is available even when Home cannot connect. Starting a new workout still requires a connection. Where protected storage is unavailable, the existing online editor remains available with a clear limitation notice.

The foreground editor attempts bounded synchronization and offers retry. A conflicting server revision shows saved and local actuals side by side; the member explicitly discards local edits or reapplies reviewed entries against the latest revision. Sharing changes require connectivity, and conflict reconciliation inherits the current server sharing choice or an explicit private retry. A queued save cannot silently re-enable sharing after another device revokes it. This does not provide background uploads or immediate knowledge of a remotely revoked account while disconnected.

## AI boundaries

- **On-device generation:** Foundation Models produces a separate, bounded suggested prescription from the submitted request. Native and JavaScript validators check its shape. No health readings, account identity or images are sent to a server. Requires an eligible device, available Apple Intelligence model and the new native plan capability; unavailable devices retain the manual editor.
- **Existing photo/text extraction:** the member can hand all reviewed extracted exercises to the plan editor. Missing targets still require review. Extracting a plan never proves that it was performed.
- **Cloud conversation:** a capable client can receive one `workout_plan` review card per reply through the existing private conversation consent. The model's tool can suggest a draft only. The existing time, tool, generation, revocation and privacy controls apply; responses use up to 2,400 tokens for clients supporting plans. Older clients retain the 1,200-token tools and have new plan cards filtered from history/replay.
- **Jev:** the installed TypeSafe integration continues its typed exercise/intent judgments. Freeform routine instructions use a conversational language model. Typed output validates an interface, not correctness or exercise suitability.

The normal coach uses the configured cloud conversational model; explicit on-device drafting does not automatically fall back to cloud processing. Provider access and representative live evaluation remain separate from software validation.

Both authoring models specify an explicit target unit; code converts minutes to seconds and validates the resulting draft. Previews separately total explicit timed targets, planned rest and sets, excluding untimed sets and instruction-only phases. A live synthetic Mac evaluation found a warm-up described only in general instructions, so the review asks members to check every requested phase and duration. See the [dated evaluation, including initial failures](evaluations/workout-plan-local-v1-2026-09-21.md).

Cloud follow-up edits retain one bounded, validated unsaved draft in conversation context. Built-in coaching under the current product Terms can use a bounded recent sample of private prescriptions and member-entered actual results when relevant. Existing privacy opt-outs and older on-request grants remain respected. The existing Apple Health permission still covers only five imported workouts. Manual-record changes clear conversations that used those records and stop outdated replies. See [the independent notices and limits](INTELLIGENCE.md).

## Data and permissions

`0029_workout_plans.sql` adds owner-scoped `workout_plans`, immutable `session_workout_plans`, and owner-scoped `workout_runs`. All routes use ordinary signed-in member sessions, never delegated A2A credentials. A2A-created bookings can use the same host-controlled session flow.

Plan and workout creation use client UUIDs for retries. Updates require the current revision. Workout updates can also carry a `mutationId`: an identical retry of the last write returns the same saved record without another revision or finish timestamp. Reusing that identifier with different content, or retrying after a later edit, requires conflict review. Migration `0031` stores only the last identifier and payload hash on the workout; deletion removes the receipt. Older clients remain compatible. A session has at most one current published plan and one workout record per member. Source-plan identity and revision fence removal, copying and starting. Session access respects membership, bilateral blocks, account deletion and suspension under the same ordered profile/session locks used by booking.

Deleting a template leaves deliberately shared session copies and existing workout snapshots intact. Deleting the author account removes its private plans, results and shared attachment. Another member's already saved copy or private workout snapshot remains their own record. The sharing review explains this copying boundary. Suspended owners can still read, export and delete their private data.

Limits: 500 library templates, 12 exercises per plan, 20 sets per exercise, 120 sets total, and 10 unfinished workouts. These are storage/validation ceilings, not training recommendations. Requests and list pages are bounded; sensitive error bodies and SQL parameters are not logged.

## Acceptance

Automated tests use synthetic routines and members. They cover owner isolation, explicit sharing/revocation, actual-versus-planned fields, immutable session copies, revision races, booking/sharing/blocking/deletion lock order, exports and account cleanup. The A2A protocol test proceeds through mutual proposal confirmation, booking-term approval, first-plan attachment and exact-version workout start. Nine real PostgreSQL concurrency checks and 41 authenticated local HTTP checks passed. Provider adapter tests use the real SDK with mocked model output. Native checks compile against the installed SDK and test parsing; these checks do not demonstrate model quality or physical sensor behavior.

Still require actual-device testing: complete a two-person workout, interrupt connectivity while entering sets, recover unsaved edits, switch accounts, use accessibility tools and review AI-generated routines with representative members. The broader launch checklist remains in [VISION-ROADMAP.md](VISION-ROADMAP.md).

The [dated release checks and signed iPhone build](evaluations/shared-workouts-release-2026-09-21.md) record what was verified and what remains pending.

The [structured coach and timer checks](evaluations/actionable-coach-2026-09-21.md) record the latest rendered flow and its physical-device limits.
