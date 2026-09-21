# SamePace local intelligence

This Expo native module uses Apple's on-device Foundation Models on supported, enabled devices running iOS 26 or later. Vision text recognition works without the language model. It does not register background inference, use an API key, upload a photo, call Jev, or silently switch to a cloud model. Jev's existing server integration and consent remain separate.

The application imports the typed API from `mobile/src/lib/intelligence`:

- `getIntelligenceCapability()` reports model availability separately from local photo text recognition.
- `respond(text, history, options)` streams cumulative provisional text with a bounded, memory-only history. There are no model tools, account credentials, schedule reads, or health-store reads.
- `draftText` and `draftPhoto` return editable suggestions. Photo input must be a picked/captured local file inside the app container. The image is downsampled before OCR, never copied to shared storage, and never uploaded by this module.
- `summarizeWorkout` selects from supplied facts; code copies the factual values into the result. Missing readings stay absent and no physiological interpretation is generated.
- `cancelAllIntelligence` cancels active work. Backgrounding and native destruction also cancel work. Native requests have a 30-second deadline; the JavaScript caller has a 35-second cancellation deadline.

Every draft has `requiresReview: true`, a null start date, and a separate planned/completed/unclear interpretation. The model selects exact evidence spans; code checks their presence and parses units/counts/duration. No date, load unit, or absent sensor fact is guessed. A prescription is not evidence of completion. The editor must require a member's explicit review and save action. Structured output and exact evidence checks reduce invention but do not establish general extraction accuracy.

A model that is unavailable leaves a manual draft containing the source note/OCR text. Camera and library permissions are requested by the screen's explicit picker actions, not by this module. A native module rebuild is required; Expo Go and an older installed development client cannot gain these native capabilities through a JavaScript update.

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

The standalone Swift check executable covers exact evidence parsing, missing facts, bounds, cancellation before dispatch, local-file isolation, and actual Vision OCR over a generated synthetic image. It performs no language-model inference. `validation.test.mjs` checks the native result boundary and freshness of workout surface data. These checks are separate from model quality evaluation.

Before release, use a newly built physical iPhone client to verify:

1. Available, disabled, downloading, unsupported, offline, and cancellation states; background/sign-out cancels work and suppresses late output.
2. Local model responses and editable text/photo drafts against a representative set of member-approved examples, including handwritten notes, ambiguous prescriptions, mixed units, varying set schemes, and absent dates.
3. Camera/library denial and cancellation, actual picked image paths, oversized/unreadable images, and manual editing when the language model is unavailable.
4. Shortcuts discovery, Siri deep links, next-session expiry, and returning through authentication.
5. A paired Watch workout, fresh/stale readings, pause/resume/end, disconnect, account switching, Lock Screen/Dynamic Island rendering, and behavior while the iPhone is suspended.
6. Measured request latency, battery use, and thermal behavior on supported devices. Simulator compilation and synthetic OCR do not establish these results.

## Primary references

- [Foundation Models generation](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)
- [Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)
- [App Shortcuts provider](https://developer.apple.com/documentation/appintents/appshortcutsprovider)
- [Expo local modules](https://docs.expo.dev/modules/get-started/)
