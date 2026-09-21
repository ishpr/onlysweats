# Actionable coach, text and timers — September 21, 2026

This release builds on PR #37 and incorporates Claude's design consistency pass from PR #38. It changes mobile JavaScript only; there are no native modules, server APIs, database migrations or model changes.

## Member experience

- Today shows labeled sleep, resting heart rate and steps, with full detail one tap away. Zero remains a value, missing readings stay absent, and history-only data is distinguished from no recent readings. The accessibility label names every displayed reading.
- Native Markdown renders headings, paragraphs, emphasis, nested lists, quotes, tables, code and links for final and streaming replies, including on-device chat. User messages remain plain text. HTML is inert, images cannot load remotely, and links become tappable only after a complete reply. Malformed tables and overly deep nesting preserve readable source instead of dropping facts.
- A validated workout draft leads the coach reply with exercises, targets and **Review & start**. Full explanatory prose remains under **Coach notes**. The complete plan opens for review, can be edited, and offers **Save & start workout** or **Save for later**. Save/start retries keep the same identifiers and reviewed content after an uncertain response.
- Timed sets offer a stopwatch with a planned target, pause/resume/reset, and explicit elapsed-duration review. Saving the completed set remains a separate confirmation. Reaching the planned time never records activity. Actual reps, load and distance remain independently entered or unknown. Rest timers use the same foreground behavior.

The existing conversational model already returns validated structured workout drafts, so this path does not parse generated prose or call Jev a second time. The TypeSafe skill and live value-extraction/building guidance were reviewed: typed semantic decisions remain appropriate for ambiguous source notes; application code owns timing, counts, identifiers and record writes.

## Rendered checks

The actual mobile web application was exercised against a loopback-only, in-memory synthetic API. No test activity was written to a real member or production service.

- At 440 × 852, the compact Today readings and bottom shortcut cards fit. At 320 × 740, readings wrap without clipping. Zero/missing readings, history-only data and the empty state were checked, including their accessibility labels.
- A coach routine displayed three exercise rows and six planned sets ahead of its notes. Expanded notes rendered real headings, bold, nested numbered/bullet lists and a quote without raw formatting markers.
- Opening and editing the draft made no writes. Editing a 60-second target to two seconds, returning through review, and choosing Save & start created one plan and one empty workout record with that exact target.
- Passing the planned target made no completion write. Pausing at eight seconds and choosing Use duration filled only actual seconds. Save completed set then recorded eight seconds, with reps, weight and distance still null.
- One completed set, one skipped set and four unrecorded sets remained distinct through partial finish. Editing another actual field during a running timer preserved elapsed time. After the final lifecycle fixes, saving a timed set automatically started rest; its countdown advanced from 15 to 11 seconds before pausing.

The browser uses the online fallback because protected native storage is unavailable. Automated offline storage/sync checks cover those code paths; this browser exercise does not establish physical-device offline behavior. Existing unrelated brand SVG development warnings remain.

## Verification and limits

The focused parser tests cover streamed prefixes, nested formatting, malformed tables, source fact retention, literal HTML, remote images and link schemes. Submission tests cover lost plan/run responses, immutable retry content and stale/aborted sessions. Timer checks cover confirmed time, unknown actuals, reset, bounds and account/set changes. All 188 mobile tests, 14 focused workout service tests, the final mobile type check, changed-source lint and iOS JavaScript export passed. The 13 timer tests include a real prepareUpload/acknowledgeUpload composition: syncing an earlier set preserves the current set’s timer. They also cover a rest timer mounting while save is busy, delayed initial start, cancellation on blur/background, and no automatic resume. Both regressions were found and fixed during independent review.

A physical iPhone screenshot before this update showed a live cloud reply and a validated workout draft. It does not establish completion of the new native plan/timer flow. Full physical workout/offline, paired-member and HealthKit acceptance remain tracked in [the functional handoff](../FUNCTIONAL-HANDOFF.md). Timers are foreground aids: they pause when leaving the screen/app and do not provide background alarms or durable elapsed-time recovery. Confirmed entries use the existing protected recovery and save behavior.

The renderer adds pinned pure-JavaScript `marked` and `entities` dependencies. The live Expo checkout must install them before serving this release. The existing installed development client can receive these changes without a new native build.
