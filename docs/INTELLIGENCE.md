# SamePace intelligence

The assistant has two explicit conversation modes: **On this iPhone** and **Cloud**. Planning and approvals remain a separate tab. Neither conversation mode can book, send another member a message, enable delegation, charge money, or mark a workout complete. Review cards lead to the existing editor or approval screen.

## Responsibilities

| Layer | Implemented responsibility |
| --- | --- |
| Apple on-device Foundation Models | Private, memory-only conversation; editable text/photo exercise drafts; factual recaps of explicitly supplied workout summaries. Eligible devices on iOS 26+; unavailable states retain manual entry. |
| Vision | Local OCR of a selected or captured workout photo. Exact evidence and deterministic unit/count parsing constrain draft fields. This is photo-to-plan, not measured repetitions or continuous form assessment. |
| Vercel AI Gateway | Authenticated streamed conversation, bounded owner-scoped read tools, and review cards. Separate member permission controls imported workout summaries. |
| Jev / TypeSafe | Existing separately consented typed exercise and workout-note judgments. It does not generate this chat. |
| A2A | Existing scoped, revocable planning negotiation and durable coordination. Both people still approve the plan and booking terms. It receives no raw health records or private chat history. |
| Application code | Measurements, arithmetic, consent, identity, revisions, quotas, idempotency, action construction and execution. |

The app never transfers a local transcript or photo into the cloud conversation automatically. Changing modes cancels active work. Local drafts move to the fitness editor through an account-bound, single-use in-memory handoff; sensitive text is not placed in navigation URLs. Saving requires review, an explicit completion choice, and a member-entered start time. A photographed prescription does not prove exercise happened.

## Cloud configuration

Apply migrations `0027_conversation.sql` and `0028_health_zones.sql` through the normal deployment migration process. Server-only configuration:

| Variable | Purpose |
| --- | --- |
| `ASSISTANT_CHAT_ENABLED=true` | Enables provider calls. Default off. This does not grant a member's consent. |
| `ASSISTANT_CHAT_MODEL` | Gateway model ID; initial default `anthropic/claude-sonnet-5`. Selection remains subject to task evaluation. |
| `AI_GATEWAY_API_KEY` | Optional server credential for local/non-Vercel execution. Never an Expo public variable. |
| `VERCEL_OIDC_TOKEN` | Vercel deployment/development identity supported by Gateway. Do not copy into app builds. |
| `HEALTH_SYNC_ENABLED=true` | Required in addition to separate member fitness-context consent to read imported summaries. |
| `A2A_ENABLED=true` | Required for planning preference/discovery tools; normal A2A permissions remain authoritative. |

Gateway calls require zero data retention and disallow prompt training. The adapter does not weaken these requirements on failure or switch providers behind the member's choice. Team eligibility, credits, model access, and supported routing must all work before enabling cloud chat. Authentication alone is not proof that a model can run.

On September 21, 2026, deployment OIDC authentication and credit lookup worked, but three synthetic model probes were denied because paid Gateway credits had not been added. A $20 one-time purchase was requested separately and is not authorized by this document. No real member content was used in those probes. Keep the feature disabled until the billing/provider test succeeds.

## Private API and limits

All endpoints use the normal signed-in member session under `/api/v1`, with no-store responses. A2A delegation tokens do not authenticate them.

| Endpoint | Behavior |
| --- | --- |
| `GET /assistant/chat` | One consistent settings/history snapshot, at most 40 messages. |
| `PUT /assistant/settings` | Explicit cloud and optional fitness consent with current notice version; clears history and invalidates active replies. |
| `DELETE /assistant/chat` | Removes conversation, rotates history generation, and invalidates active replies. |
| `POST /assistant/chat` | NDJSON `start`, `delta`, `action`, `done` or safe `error`; requires UUID request ID and current consent/history generations. |

Limits: 2,000 input characters, 16 KiB request body, 20 context messages / 16,000 context characters, 1,200 generated tokens, 12,000 result characters, six read/review tool calls, three model steps, twelve deduplicated cards, 45-second server deadline, and fifty attempted turns per UTC day. These bounds constrain spending; they are not a precise dollar budget.

One reply is active per member. Each attempt has its own fenced lease; a late prior attempt cannot release a retry's lease or save over it. Repeating a completed request returns its saved result without another provider call. Failed or cancelled replies do not save partial assistant text. The client holds action cards until a valid complete result, checks account/generation continuity, and drops stale output.

The model can read current entered planning preferences and an aggregate compatible-partner count, view up to eight real public sessions, offer safe review routes, and propose a small editable preference draft. Tools do not accept arbitrary URLs or database operations. Their exceptions are replaced with fixed messages before the AI SDK can serialize them into a model prompt. Tool failures stop generation.

## Health privacy and retention

Cloud fitness permission allows only the five latest imported workout summaries: activity, time, duration, distance, energy, and an available heart-rate summary. Raw samples, sleep and HRV history are excluded. Missing values remain null. Shared planning never inherits this permission.

The service fingerprints the complete authorized summary snapshot and checks it under the same identity lock used by HealthKit mutations before saving an answer. Removing a workout, receiving a relevant source deletion, disconnecting Apple Health, or withdrawing a reading type clears chat that previously used workout summaries and cancels its generation. This removes app history; it cannot retract text already seen by a member or already processed in an authorized provider request. User-typed health details are treated as conversation content and can be removed with **Clear conversation**.

History is owner-scoped, limited to 80 stored messages and 30 days, pruned on reads and scheduled maintenance, and cascades on account deletion. Turning off either consent clears it immediately. Raw provider exceptions and conversation content are not logged as telemetry.

## Native delivery

The build includes the local intelligence module, App Shortcuts, enhanced Live Activities, HealthKit observers, and a native Watch recorder. It requires a new development-client binary; Expo JavaScript refresh cannot add those native capabilities. The source remains compatible with an iOS 16.4 deployment target, and guards newer APIs at runtime. Model support depends on device, OS, enabled Apple Intelligence and model readiness, not an assumed iPhone model name.

HealthKit notifications queue changes locally; automatic uploads resume in the signed-in foreground after explicit opt-in. No authentication token, raw record, or HealthKit anchor is persisted in the native observer. The Watch records offline using actual HealthKit sessions, mirrors available readings to iPhone, and saves workouts to Apple Health for normal import. Heart-rate cues use actual source zone thresholds with freshness, dwell and cooldown rules; they make no LLM calls.

See [Apple Health](APPLE-HEALTH.md), [native intelligence](../mobile/modules/samepace-intelligence/README.md), [Watch recorder](../mobile/watch/README.md), and [physical acceptance](INTELLIGENCE-ACCEPTANCE.md).

The `device-phone` EAS profile excludes the Watch target until a physical Watch is registered and provisioned. It still includes iOS 27 HealthKit, local intelligence, App Shortcuts and widgets. The normal `device` profile includes Watch. Both are development clients, so use the intended Metro server; a simulator's synthetic session must never be used for the physical-phone handoff. The signed Xcode 27 iPhone-first package is available as [Expo build 8594a56c](https://expo.dev/accounts/servesys-corporation/projects/samepace/builds/8594a56c-914d-47e4-8e8b-f5820e4f916a).

For model assessment, the [50-case synthetic harness](evaluations/conversation-v1.md) runs offline unless explicitly invoked with `--run`. Mechanical fixture checks and human assessment of model answers are separate.

## Acceptance boundary

Automated permission, cancellation, retry, deletion, provider-error and native serialization checks establish implementation behavior for their covered cases. Synthetic fixture success is not general model accuracy. Physical iPhone/Watch testing, representative draft review, model quality, latency, battery and thermal measurements remain release acceptance work. PCC requires separate Apple entitlement/eligibility and is never an automatic fallback. Continuous camera form analysis, rep recognition and proprietary readiness scores are not delivered by this implementation.
