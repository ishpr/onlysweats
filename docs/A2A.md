# SamePace workout assistants and A2A

SamePace uses **A2A 1.0** and the official **`@a2a-js/sdk` 1.2.0** for scoped workout negotiation. Chats is a readable history of agent exchanges. Members do not write direct messages to one another or manually send first-contact invitations. The private coach remains available for talking with your own assistant.

Current product Terms authorize bounded first-party matching from saved activity, ability, public venues and available windows. A member’s agent can find a compatible partner, initiate contact, and exchange a workout proposal with the other member’s agent. Both members need current Terms, enabled fresh preferences and current matching authority. Previous privacy opt-outs are retained. The migration enrolls nobody; accepting the new Terms creates the authority record.

The planner enumerates a bounded set of feasible options and uses deterministic ranking. It makes no model calls and does not share private coach conversations, imported HealthKit data or private workout results. TypeSafe/Jev remains available for typed fitness interpretations, separate from matching permissions. **Agents cannot approve a workout or payment: both people must explicitly confirm the exact plan and booking terms before one ordinary session is created.**

First-party agents call the same durable negotiation service backing the A2A HTTP adapter. Their contact/check records contain real structured A2A 1.0 messages (`ROLE_AGENT`, JSON data parts) and explicit provenance. They do not manufacture conversational LLM text. Outside assistants use scoped revocable credentials; outbound federation and connected calendars remain unimplemented. Notifications use the existing durable delivery queue.

The [A2A specification](https://a2a-protocol.org/latest/specification/) defines the protocol. The [official JavaScript SDK](https://github.com/a2aproject/a2a-js) handles JSON-RPC serialization and protocol errors. SamePace's contracts and authorization rules live in `src/lib/agents/contracts.ts`, `service.server.ts`, `assistant.server.ts`, and `protocol.server.ts`. Shared mobile wire types live in `shared/assistant.ts`.

## Enable locally

Apply all shipped migrations through the normal migration process before using a persistent database. Agent features use `0013_agent_negotiations.sql`, `0016_assistant.sql`, `0019_agent_runs.sql` `0023_discovery.sql` and `0034_agent_contacts.sql`. Local PGlite applies them automatically.

```sh
A2A_ENABLED=true A2A_BASE_URL=http://localhost:8080 npm run dev
```

The feature defaults to **off**. Without the exact setting `A2A_ENABLED=true`, discovery, the A2A endpoint, and `/api/v1/agents/*` return `404`. `A2A_BASE_URL` is an HTTPS origin in deployments; local development also accepts HTTP loopback origins. Its default is `https://samepace.app`. Do not enable a preview with the production origin or production database.

| Interface                          | Authentication                    | Purpose                                                                                                            |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /.well-known/agent-card.json` | Public when enabled               | Discovery; advertises JSONRPC at `/api/a2a` with protocol version `1.0`.                                           |
| `POST /api/a2a`                    | Scoped delegation bearer token    | `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`.                                                               |
| `/api/v1/agents/*`                 | Normal Better Auth member session | Manage preferences/delegates, matching status, inspect history, confirm plans, accept booking terms, and withdraw. |

A2A requests require `Content-Type: application/json` and `A2A-Version: 1.0`. Cookies and ordinary app-session tokens do not authenticate an A2A request. Conversely, an `sp_agent_…` delegation token does not authenticate the member-control API. Streaming, push callbacks, extended authenticated cards, tenant routing, and other transports are not supported.

## Permission and state model

1. Accepting the current Terms initializes a versioned contact authority unless a prior choice disables it. Saving planning preferences triggers a bounded matching check; the ten-minute cron also scans due members. The first configured save enables sharing under the disclosed Terms; existing disabled preferences remain disabled.
2. Contact creation holds both members’ ordered profile locks, rechecks Terms/permissions, verification, blocks, audience, preference freshness, overlapping workouts, quotas and cooldowns, then atomically creates one room, two planning permissions and one recoverable run. Both agents’ contact/check actions are recorded. No human confirmation is recorded by this process.
3. The first-party coordinator proposes a feasible workout. Outside assistants may also read/propose through a separately issued delegation token (`workout:negotiate`, 1–24 hours, at most ten active credentials). Delegates cannot create matching authority or human approvals. Historical rooms created from a completed booking keep their existing explicit room permissions.
4. A delegated counteroffer uses the current `expectedRevision` and a fresh `messageId`. Each proposal increments the revision and clears prior plan and booking approvals. Identical message retries are idempotent; reused IDs with changed content and stale revisions are rejected. Member-facing proposal and first-contact POST routes return `409 agent_chat_only`; members edit their own planning preferences instead.

5. Each person reviews the current proposal and explicitly confirms its revision through the member API. Clients must require a human action before invoking this endpoint and must never give the agent the person's full app-session token. Delegation tokens cannot confirm proposals. The second matching confirmation sets the negotiation to `approved`, with `booked: false`.
6. Each person fetches the booking terms, then explicitly accepts their `revision` and `termsHash`. The hash binds the plan, roles, current terms and both preference revisions. After one acceptance, nothing is booked. The second matching acceptance rechecks consent, eligibility, blocks, venue, time, entered availability and overlapping workouts, then uses the existing session/booking services to create one unlisted two-person workout. A changed preference or term requires both people to accept again. Concurrent or repeated execution returns the same booking.
7. Either person can withdraw consent, which cancels the conversation and clears approvals. A member or authorized delegate can cancel an open negotiation; a member can also cancel an approved plan before booking. Removing authority remains available after blocking or suspension. Revoking a credential or ending a conversation never cancels an existing workout, seat, or standing slot; ordinary workout cancellation handles that separately.

Conversations created from shared bookings expire after seven days; first-time discovery conversations expire after one day, including after the invitation is accepted. An expired open conversation is exposed as `expired` in member DTOs and `TASK_STATE_CANCELED` over A2A. An approved plan keeps its historical `approved` state, but cannot first book after the conversation deadline. Completed booking receipts remain readable subject to member access. Each person can participate in at most 20 unexpired open conversations, including invitations they have not yet accepted; creation checks both people's quotas. A conversation accepts at most 50 proposal revisions. A2A request bodies are capped at 16 KiB. These bounds are not a distributed traffic-rate limiter.

`ListTasks` filters eligibility, mutual consent, context, state, and status timestamp before pagination. Its total and continuation token cover the full matching collection, including more than 100 historical tasks; the member activity API separately shows only the latest 100 conversations. Expiration uses `expiresAt` as the effective status timestamp, so incremental polling can observe a task becoming canceled without a write to the room.

| Member state            | A2A task state              | Meaning                                                                                           |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `open`                  | `TASK_STATE_INPUT_REQUIRED` | Waiting for a proposal or both human confirmations.                                               |
| `approved`              | `TASK_STATE_COMPLETED`      | Both people approved the plan. Check `booked`: separate booking acceptance may still be required. |
| `cancelled` / `expired` | `TASK_STATE_CANCELED`       | Negotiation ended; any existing normal booking is unaffected.                                     |

The negotiation ID is the A2A `taskId` and `contextId`. Agents cannot use arbitrary tasks or create new tasks with `SendMessage`. Plan artifacts and task metadata report the actual `booked` boolean. Metadata may include `sharedPreferences: [{memberId, preferences}]`; disabled preferences and preferences from ended, expired or booked conversations are omitted. There is no A2A booking or human-approval method.

## Human control API

All paths below are under `/api/v1`. JSON bodies reject unknown properties. Negotiation and delegation path IDs are UUIDs. Standard API errors use `{ "error": "…" }` with `400` for invalid input, `401` for absent/invalid app sessions, `404` for inaccessible conversations, and `409` for stale or disallowed actions.

| Method and path                              | Body                                    | Response                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /agents/delegations`                    | —                                       | `{ delegations: [{ id, label, expiresAt, revokedAt }] }`; no token values.                                                                                     |
| `POST /agents/delegations`                   | `{ label, expiresInHours? }`            | `{ delegation: { id, label, token, expiresAt, scope: "workout:negotiate" } }`. Label is 1–80 characters; expiry is an integer 1–24.                            |
| `DELETE /agents/delegations/:id`             | Empty or `{}`                           | `{ ok: true }`; idempotent, applies only to the caller's delegation.                                                                                           |
| `GET /agents/preferences`                    | —                                       | `{ preferences: AssistantPreferences }`; owner-only.                                                                                                           |
| `PUT /agents/preferences`                    | `AssistantPreferencesInput`             | `{ preferences: AssistantPreferences }`; saves explicit sharing choices and increments their revision.                                                         |
| `GET /agents/negotiations`                   | —                                       | `{ negotiations: NegotiationView[] }`; latest 100 accessible conversations.                                                                                    |
| `POST /agents/negotiations`                  | `{ bookingId }`                         | `{ negotiation: NegotiationView }`; booking must be completed and shared with the caller.                                                                      |
| `GET /agents/negotiations/:id`               | —                                       | `{ negotiation: NegotiationView }`.                                                                                                                            |
| `GET /agents/negotiations/:id/candidates`    | —                                       | `{ candidates: WorkoutPlan[], reason: string \| null, preferenceRevision, partnerPreferenceRevision }`; at most five options, no proposal or booking mutation. |
| `POST /agents/negotiations/:id/proposal`     | `{ messageId, expectedRevision, plan }` | `{ negotiation: NegotiationView }`; member proposal/counteroffer, using the same revision and idempotency rules as A2A.                                        |
| `GET /agents/negotiations/:id/history`       | —                                       | `{ events: [{ sequence, actorId, kind, revision, data, createdAt }] }`; latest 100 events in sequence order.                                                   |
| `POST /agents/negotiations/:id/consent`      | `{ allow: boolean }`                    | `{ negotiation: NegotiationView }`; only changes caller consent.                                                                                               |
| `POST /agents/negotiations/:id/confirm`      | `{ revision: integer >= 1 }`            | `{ negotiation: NegotiationView }`; explicit human approval for the exact revision.                                                                            |
| `POST /agents/negotiations/:id/cancel`       | Empty or `{}`                           | `{ negotiation: NegotiationView }`; closes an open or approved unbooked conversation.                                                                          |
| `GET /agents/negotiations/:id/booking-terms` | —                                       | `AssistantBookingReview`; reads current terms or the existing booking receipt.                                                                                 |
| `POST /agents/negotiations/:id/book`         | `{ revision: integer >= 1, termsHash }` | `AssistantBookingReview`; records only this member's explicit acceptance and books when both match.                                                            |

`NegotiationView` is produced by `service.view`:

```ts
type NegotiationView = {
  id: string;
  bookingId: string | null; // null for first-time discovery invitations
  memberIds: string[];
  memberNames?: Record<string, string>; // human views only; omitted from delegated-agent responses
  consentedIds: string[];
  state: "open" | "approved" | "cancelled" | "expired";
  revision: number;
  plan: WorkoutPlan | null;
  confirmedIds: string[];
  expiresAt: string; // ISO 8601
  booked: boolean;
  sessionId: string | null;
  resultBookingId: string | null; // new booking, distinct from the shared origin bookingId
};
```

`WorkoutPlan` is a strict object with `title` (1–120 characters), `venueId` (known public venue, 1–100 characters), `activity`, matching `ability`, `startAt` (ISO 8601 with timezone), and integer `durationMin` (10–360). Starts must be 30 minutes to 14 days ahead, including when people confirm. Ability values use the same validated activity/level ranges as normal sessions; see [the API ability contract](./API.md#ability). There are no booking, fee, capacity, identity, or calendar fields in the proposal schema.

### Entered preferences and bounded planning

`AssistantPreferencesInput` is a strict object:

```ts
type AssistantPreferencesInput = {
  enabled: boolean;
  activity: Activity;
  ability: Ability;
  durationMin: number; // integer 10–360; upper bound for generated options
  venueIds: string[]; // at most 10 distinct known public venues
  availability: { startAt: string; endAt: string }[]; // at most 12 ISO windows
  approvedIntent: string; // member-reviewed text, at most 240 characters
};
type AssistantPreferences = AssistantPreferencesInput & {
  revision: number;
  updatedAt: string | null;
};
```

Missing preferences contain no shared information. The mobile first-save flow enables newly entered planning preferences under current Terms; an existing disabled choice stays disabled. Enabling requires at least one venue and available window. Each window must be within the next 14 days, long enough for the entered workout length, and at most 24 hours. Disabling remains possible with expired saved windows or a suspended account. Normal delegation and conversation consent remain separate controls.

Candidate enumeration requires both people to opt in and enable their preferences. Code intersects venues and availability, checks activity and compatible ability, treats duration and distance as upper bounds, excludes existing workouts, and examines at most 192 candidate times. It returns at most five options or a reason to adjust the preferences together. A generated run must allow at least `miles * paceMinSec` seconds; a ride must allow at least `miles / mphMax * 60` minutes. These are consistency checks on the entered plan, not claims about either person's fitness. Other activities do not infer an unprovided speed. The free-text `approvedIntent` is available to authorized external assistants but is not interpreted by this deterministic planner.

### Separate booking acceptance

```ts
type AssistantBookingReview = {
  terms: {
    revision: number;
    termsHash: string;
    hostId: string;
    participantId: string;
    plan: WorkoutPlan;
    visibility: "unlisted";
    capacity: 2;
    lateCancelFeeCents: number;
    noShowFeeCents: number;
    lateCancelHours: number;
    currency: "USD";
    chargeNowCents: 0;
    paymentCollectionEnabled: false;
  };
  approvedIds: string[];
  booked: boolean;
  sessionId: string | null;
  bookingId: string | null;
};
```

The current terms reflect the existing $5 late-cancellation policy within 12 hours and $10 no-show policy. This endpoint collects no payment and writes no fee assessment. It creates a normal workout whose later attendance/cancellation follows the ordinary rules. Both people must see the exact plan, their host/participant role and terms before accepting; clients must not invoke `/book` from an assistant, automatic refresh, or model output.

Execution serializes with ordinary posting/joining using member locks, then locks the conversation. The stored booking IDs and transaction prevent duplicate execution. Ordinary and training-block booking paths honor an existing assistant reservation. If generation of a recurring occurrence conflicts with an assistant reservation, that occurrence is not created and a deduplicated review notification is queued; the standing slot remains active. This does not read connected calendars or reserve external venues.

The tests include real disposable PostgreSQL checks of concurrent term acceptances and both orderings of ordinary posting versus the final assistant booking acceptance. See `src/lib/operations/postgres-release.test.ts`; these checks do not replace physical-device or production-provider acceptance.

## Automatic matching and bounded planning

`GET /agents/matching` returns `{matching}` with enabled/ready status, a reason, required next step, last check time and women-only settings. `PUT` changes pause/resume/audience controls. `POST /agents/matching/check` with `{}` requests a bounded check and respects scan limits. GETs never initiate contact.

The cron checks at most ten due members per tick. Each scan considers a rotating pool of at most 30 eligible candidates and initiates at most one contact. Limits include five outgoing and ten incoming contacts per day, 20 open rooms per member and a seven-day pair cooldown. Preferences expire for matching after seven days. New rooms expire after one day; their planning grants last at most 24 hours. Runs have at most three steps. Automatic-contact runs have a 30-minute deadline for recovery across cron ticks and advance immediately after contact; legacy manually started runs retain a ten-minute deadline. Contact creation and run enqueue commit together; proposal writes and step progress also commit together. Failed work remains recoverable. Agent jobs execute before push delivery in the same tick, and are gated by `A2A_ENABLED=true`.

Identical preference-save retries refresh freshness without changing the preference revision, clearing approvals or consuming another planning run.

Saving changed preferences also revisits up to three existing automatic conversations per check. The same room is reused: obsolete plans and approvals are invalidated with a recorded `preferences_changed` event, derived planning grants follow current preference revisions, and the agents produce a fresh proposal. Explicit room stops, cancelled/expired rooms and completed bookings are not restarted. A later save can recover from no shared option; daily/room limits stay enforced and appear in the readable planning status. Cron recovers unfinished continuations without creating duplicate rooms.

Pause, old-client discovery withdrawal, changed authority, blocks and account restrictions stop automatic sharing. Matching pause cancels unbooked automatic rooms and queued runs. It does not cancel completed bookings. New Terms versions fence old authority; reaccepting never restores an explicit opt-out. Legacy discovery grants alone cannot authorize automatic contact.

`agent_message` events distinguish contact, matched preferences, proposal checks and ready-for-review actions. Proposal provenance distinguishes first-party agents, delegated agents and historical member proposals. Human consent, plan confirmation and booking approval remain human actions. Historical member messages stay read-only and retain original authors; the direct-message POST endpoint refuses new writes, and bookings no longer insert pretend host greetings. Chats opens `/agent-chat/:id`; old `/assistant?negotiationId=...` links redirect.

Shared contracts live in `shared/assistant.ts`, `shared/agent-matching.ts` and `shared/agent-transcript.ts`. Embedded and real PostgreSQL tests cover authority boundaries, duplicate workers, withdrawal races and transactional recovery. Synthetic UI evidence does not replace real two-member/device acceptance.

## External delegation example: legacy completed-booking conversation

The commands use `curl`, `jq`, and Node.js. Start the enabled local server and set `ORIGIN=http://localhost:8080`. Set `MEMBER_A_SESSION` and `MEMBER_B_SESSION` to the two people's Better Auth session tokens, and `COMPLETED_BOOKING_ID` to a booking those people completed together. Do not supply member-session credentials to delegated assistants.

First, each person issues their own assistant credential through the member API:

```sh
AGENT_A_TOKEN=$(curl --fail-with-body -sS "$ORIGIN/api/v1/agents/delegations" \
  -H "Authorization: Bearer $MEMBER_A_SESSION" -H 'Content-Type: application/json' \
  --data '{"label":"My workout assistant","expiresInHours":24}' | jq -er '.delegation.token')

AGENT_B_TOKEN=$(curl --fail-with-body -sS "$ORIGIN/api/v1/agents/delegations" \
  -H "Authorization: Bearer $MEMBER_B_SESSION" -H 'Content-Type: application/json' \
  --data '{"label":"My workout assistant","expiresInHours":24}' | jq -er '.delegation.token')
```

Person A opens the conversation; person B explicitly opts in:

```sh
ROOM_ID=$(jq -n --arg booking "$COMPLETED_BOOKING_ID" '{bookingId:$booking}' | \
  curl --fail-with-body -sS "$ORIGIN/api/v1/agents/negotiations" \
    -H "Authorization: Bearer $MEMBER_A_SESSION" -H 'Content-Type: application/json' \
    --data-binary @- | jq -er '.negotiation.id')

curl --fail-with-body -sS "$ORIGIN/api/v1/agents/negotiations/$ROOM_ID/consent" \
  -H "Authorization: Bearer $MEMBER_B_SESSION" -H 'Content-Type: application/json' \
  --data '{"allow":true}'
```

The assistant discovers the public card and sends its first proposal. This wire shape was checked against `SendMessageRequest.toJSON` in the installed SDK: the method is `SendMessage`, the role is `ROLE_USER`, and a data part contains `data` plus `mediaType`.

```sh
curl --fail-with-body -sS "$ORIGIN/.well-known/agent-card.json"
START_AT=$(node -p 'new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()')

jq -n --arg room "$ROOM_ID" --arg start "$START_AT" '{
  jsonrpc: "2.0",
  id: "request-1",
  method: "SendMessage",
  params: {
    message: {
      messageId: "proposal-1",
      contextId: $room,
      taskId: $room,
      role: "ROLE_USER",
      parts: [{
        mediaType: "application/json",
        data: {
          schema: "samepace.workout-proposal.v1",
          action: "propose",
          expectedRevision: 0,
          plan: {
            title: "Easy trail miles",
            venueId: "katy",
            activity: "run",
            ability: {kind:"run", paceMinSec:570, paceMaxSec:600, miles:5},
            startAt: $start,
            durationMin: 50
          }
        }
      }]
    },
    configuration: {acceptedOutputModes:["application/json"], historyLength:20}
  }
}' | curl --fail-with-body -sS "$ORIGIN/api/a2a" \
  -H "Authorization: Bearer $AGENT_A_TOKEN" \
  -H 'A2A-Version: 1.0' -H 'Content-Type: application/json' --data-binary @-
```

The successful JSON-RPC result contains `result.task`; its metadata has `revision: 1` and `booked: false`. JSON-RPC application errors are in the response's `error` member, so inspect it even when HTTP succeeded.

Person B's assistant reads the task using its own scoped token:

```sh
jq -n --arg room "$ROOM_ID" '{
  jsonrpc:"2.0", id:"read-1", method:"GetTask",
  params:{id:$room, historyLength:20}
}' | curl --fail-with-body -sS "$ORIGIN/api/a2a" \
  -H "Authorization: Bearer $AGENT_B_TOKEN" \
  -H 'A2A-Version: 1.0' -H 'Content-Type: application/json' --data-binary @-
```

`GetTask` returns the task directly as `result`. To counter, send the complete changed plan through the same `SendMessage` shape using `AGENT_B_TOKEN`, a fresh message ID, and `expectedRevision: 1`. That creates revision 2. Repeating the original request unchanged is safe and returns the current task without making another revision.

After each person has read and accepted the same current proposal, the app performs each person's plan confirmation separately. For the example with no counteroffer:

```sh
curl --fail-with-body -sS "$ORIGIN/api/v1/agents/negotiations/$ROOM_ID/confirm" \
  -H "Authorization: Bearer $MEMBER_A_SESSION" -H 'Content-Type: application/json' \
  --data '{"revision":1}'

curl --fail-with-body -sS "$ORIGIN/api/v1/agents/negotiations/$ROOM_ID/confirm" \
  -H "Authorization: Bearer $MEMBER_B_SESSION" -H 'Content-Type: application/json' \
  --data '{"revision":1}'
```

The last response is `approved` with `booked: false`. To proceed, both people must have saved enabled preferences that include this plan's activity, venue, duration and start/end time. Each member then separately reads `GET /agents/negotiations/$ROOM_ID/booking-terms`, reviews the returned plan and terms, and deliberately submits its `revision` and `termsHash` to `POST /agents/negotiations/$ROOM_ID/book` using their own member session. The second matching acceptance returns `booked: true` with the new session and booking IDs. Changes or a new scheduling conflict return an error for a fresh review; agents cannot complete this human acceptance step.
