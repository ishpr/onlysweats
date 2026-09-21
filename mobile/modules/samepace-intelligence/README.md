# SamePace local intelligence

This Expo native module uses Apple's on-device Foundation Models on supported, enabled devices running iOS 26 or later. Vision text recognition works without the language model. It does not register background inference, use an API key, upload a photo, call Jev, or silently switch to a cloud model. Jev's existing server integration and consent remain separate.

The application imports the typed API from `mobile/src/lib/intelligence`:

- `getIntelligenceCapability()` reports model availability separately from local photo text recognition.
- `respond(text, history, options)` streams cumulative provisional text with a bounded, memory-only history. There are no model tools, account credentials, schedule reads, or health-store reads.
- `draftText` and `draftPhoto` return editable suggestions. Photo input must be a picked/captured local file inside the app container. The image is downsampled before OCR, never copied to shared storage, and never uploaded by this module.
- `draftWorkoutPlan` is a separate **generative prescription** API. Only the explicitly submitted description (up to 1,000 characters) reaches a fresh on-device session. It uses guided generation for a short multi-exercise plan, then validates its targets and instructions in native code and at the JavaScript boundary. It reads no health history, does not assign external loads, and never creates a log, saves, shares, books, or marks an exercise complete. `planContentFromAIDraft` assigns UUIDs and expands proposed set counts in application code; the editor requires review and an explicit save.
- `summarizeWorkout` selects from supplied facts; code copies the factual values into the result. Missing readings stay absent and no physiological interpretation is generated.
- `cancelAllIntelligence` cancels active work. Backgrounding and native destruction also cancel work. Native requests have a 30-second deadline; the JavaScript caller has a 35-second cancellation deadline.

Every draft has `requiresReview: true`, a null start date, and a separate planned/completed/unclear interpretation. The model selects exact evidence spans; code checks their presence and parses units/counts/duration. No date, load unit, or absent sensor fact is guessed. A prescription is not evidence of completion. The editor must require a member's explicit review and save action. Structured output and exact evidence checks reduce invention but do not establish general extraction accuracy.

A model that is unavailable leaves a manual draft containing the source note/OCR text. Camera and library permissions are requested by the screen's explicit picker actions, not by this module. A native module rebuild is required; Expo Go and an older installed development client cannot gain these native capabilities through a JavaScript update.

Whole-plan generation is gated by the separate `planDrafting` capability. Older clients return no such capability and the JavaScript adapter reports `plan_build_required`; the manual plan editor remains available. Unlike evidence extraction, generation does not return an apparently generated blank plan when the model is unavailable. There is no cloud fallback. Generated plans contain 1–12 exercises, 1–20 sets each, at most 120 sets in total, and a positive repetitions or duration target for every exercise. Overall instructions are bounded to 1,000 characters and exercise instructions to 500. These are input/output limits, not exercise recommendations or evidence of suitability. Requests for medical or injury rehabilitation are outside the generation prompt's scope. Native output has `requiresReview: true`; structured output does not establish model quality or fitness suitability.

Internally, generation selects a target unit (`repetitions`, `seconds`, or `minutes`) and a positive amount. Application code converts minutes to seconds and emits exactly one rep/time target. This prevents empty or zero-rep placeholders for timed holds and keeps arithmetic out of model text. Setup notes must not introduce additional unstructured workout phases; the prompt puts warm-ups and cool-downs into the exercise list. These instructions still need qualitative review.

## Optional Private Cloud Compute adapter

The separate `getPrivateCloudCapability` and `respondWithPrivateCloud` APIs provide a text-only iOS 27 adapter. **It is disabled in every current build**, is not a local fallback, and is not wired into the current assistant modes. The default native implementation returns `entitlement_not_configured` without constructing a PCC model. There is no image upload, health-store read, A2A execution, or API key in this adapter.

Before enabling it, the developer account must satisfy [Apple's PCC eligibility rules](https://developer.apple.com/private-cloud-compute/) and receive the managed `com.apple.developer.private-cloud-compute` entitlement. The distribution profile must actually include that grant. Only then may the native pod be compiled with `SAMEPACE_PCC_ENTITLEMENT_ENABLED` and a properly provisioned app entitlement. This plugin never applies either setting. The flag is a build gate, not evidence that Apple granted access; the OS still enforces the entitlement.

A future PCC UI must show `PRIVATE_CLOUD_NOTICE`, create a separate memory-only conversation, and call `respondWithPrivateCloud` only after an explicit send action with `allowAppleCloud: true`. It must not migrate local/photo history or attach health records. Capability distinguishes quota approaching/reached states and a known reset time; request failures have bounded codes and never silently route to another model. Streaming is provisional until success, cancellation/background/sign-out cancels native work, and requests have the same 30/35-second deadlines as local assistance.

The enabled adapter has been typechecked against the actual iOS 27 SDK, while default-disabled tests verify rejection before inference and per-request authorization. No PCC inference or entitlement-backed distribution has been tested. Before exposing the mode, verify signed-device availability, quota simulation, offline handling, cancellation, locale support, and representative response quality. See [Apple's PCC integration guide](https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute).

## Shortcuts and surfaces

`with-intelligence.js` copies the App Intents source into the main application target, where Xcode discovers its metadata. The three App Shortcuts open the assistant, the next session, or the workout-photo drafting controls. They do not take photos, read a library, record a workout, book, or check in automatically.

Only an opaque next-session route and expiry are placed in the existing `group.app.samepace` app group. It contains no authentication token, member name, title, workout measurements, or model transcript. Signing out clears it. The route opens a screen that retains its normal authentication/authorization checks.

`syncWorkoutLiveActivity(ownerId, snapshot)` receives an explicit Watch measurement snapshot. A running workout takes precedence over the arrival/check-in activity. The bridge keeps a single SamePace activity, does not predict heart rate, and removes missing or stale metrics. Native stale-state rendering masks measurements after 60 seconds even if JavaScript is suspended. Ending a workout, losing its mirror, switching accounts, and signing out clear the activity. These are ordinary ActivityKit surfaces; the app does not choose how many Dynamic Island slots the system allocates.

## Verification and remaining acceptance

The SDK 57 project uses `expo` 57.0.24 and `expo-build-properties` 57.0.21 with `ios.enableSceneSupport: true`. This is required for a binary built with Xcode 27 to launch correctly on iOS 27. The generated app delegate and scene manifest must be retained through prebuild. See [Expo's SDK 57 scene migration guidance](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27).

As of September 21, 2026, [Expo's current EAS announcement](https://expo.dev/changelog/sdk-58-beta) says Xcode 27 cloud images are still forthcoming and `latest` uses Xcode 26.6. Do not invent an image name or assume `auto` includes the 27 SDK. Local Xcode 27 builds include the new SDK features; older-toolchain builds compile out PCC and the HealthKit 27 capture additions. The local model path requires an SDK containing Foundation Models (Xcode 26 or later), even though the application still gracefully runs below iOS 26 without inference.

The standalone Swift check executable covers exact evidence parsing, missing facts, prescription bounds and explicit nulls, cancellation before dispatch, local-file isolation, and actual Vision OCR over a generated synthetic image. It performs no language-model inference. `validation.test.mjs` checks the native result boundary and freshness of workout surface data. `plan-draft.test.mjs` checks strict generation boundaries, identifier creation, no invented actuals or loads, and compatibility with the server's plan schema. These checks are separate from model quality evaluation.

Run `mobile/modules/samepace-intelligence/tests/run-checks.sh` from the repository on a Mac with the current Xcode SDK. It typechecks the native engine and shortcuts against the iOS SDK, checks the opt-in PCC source without executing it, and runs the default-disabled synthetic checks in a temporary directory. The Expo module wrapper and App Intents metadata are additionally verified by the aggregate application build.

For an explicitly requested **actual on-device model** smoke run on a supported Mac, run `mobile/modules/samepace-intelligence/tests/run-plan-evaluation.sh --run /tmp/samepace-local-plan-results.jsonl`. This separate harness uses four fixed synthetic prompts and the same request deadlines. It does not read health, accept member data, or call a cloud provider. Responses go to a new file with private permissions and require qualitative review. A successful exit only means the harness finished; inspect each result's status and instructions. Do not put generated response artifacts in Git.

Before release, use a newly built physical iPhone client to verify:

1. Available, disabled, downloading, unsupported, offline, and cancellation states; background/sign-out cancels work and suppresses late output.
2. Local model responses and editable text/photo drafts against a representative set of member-approved examples, including handwritten notes, ambiguous prescriptions, mixed units, varying set schemes, and absent dates.
3. Camera/library denial and cancellation, actual picked image paths, oversized/unreadable images, and manual editing when the language model is unavailable.
4. Shortcuts discovery, Siri deep links, next-session expiry, and returning through authentication.
5. A paired Watch workout, fresh/stale readings, pause/resume/end, disconnect, account switching, Lock Screen/Dynamic Island rendering, and behavior while the iPhone is suspended.
6. Measured request latency, battery use, and thermal behavior on supported devices. Simulator compilation and synthetic OCR do not establish these results.
7. Whole-plan generation from representative short requests, including equipment restrictions, timed exercises, mixed exercise plans, ambiguous requests, and requests involving medical rehabilitation. Confirm every generated field remains editable, saving creates a prescription only, cancellation/background/sign-out suppress late output, and an older client offers manual entry without calling a model.

## Primary references

- [Foundation Models generation](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)
- [Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)
- [App Shortcuts provider](https://developer.apple.com/documentation/appintents/appshortcutsprovider)
- [Expo local modules](https://docs.expo.dev/modules/get-started/)
