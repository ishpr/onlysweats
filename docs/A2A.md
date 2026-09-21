# SamePace agent communication foundation

SamePace exposes a consent-scoped workout negotiation service using **A2A 1.0** and the official **`@a2a-js/sdk` 1.2.0**. Two members can authorize their assistants to propose and counter a future workout. Both members must explicitly approve the same revision through their signed-in SamePace accounts. **An approved proposal does not create a session or booking.**

This is a protocol and permission foundation. Matching, model prompts/inference, outbound federation, calendar access, notification delivery for negotiations, automatic booking, and a mobile agent-management interface are not integrated. The first supported relationship is two people who already completed a SamePace booking together; it introduces no member directory or unsolicited agent contact.

The proposed [Jev fitness integration](./JEV-FITNESS.md) places real workout measurements and private typed judgments upstream of this service. Only member-approved preferences feed negotiation; installing the TypeSafe skill does not enable live inference or health-data collection.

The [A2A specification](https://a2a-protocol.org/latest/specification/) defines the protocol. The [official JavaScript SDK](https://github.com/a2aproject/a2a-js) handles JSON-RPC serialization and protocol errors. SamePace's contracts and authorization rules live in `src/lib/agents/contracts.ts`, `service.server.ts`, and `protocol.server.ts`.

## Enable locally

Apply migration `0013_agent_negotiations.sql` through the normal migration process before using a persistent database. Local PGlite applies it automatically.

```sh
A2A_ENABLED=true A2A_BASE_URL=http://localhost:8080 npm run dev
```

The feature defaults to **off**. Without the exact setting `A2A_ENABLED=true`, discovery, the A2A endpoint, and `/api/v1/agents/*` return `404`. `A2A_BASE_URL` is an HTTPS origin in deployments; local development also accepts HTTP loopback origins. Its default is `https://samepace.app`. Do not enable a preview with the production origin or production database.

| Interface | Authentication | Purpose |
| --- | --- | --- |
| `GET /.well-known/agent-card.json` | Public when enabled | Discovery; advertises JSONRPC at `/api/a2a` with protocol version `1.0`. |
| `POST /api/a2a` | Scoped delegation bearer token | `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`. |
| `/api/v1/agents/*` | Normal Better Auth member session | Issue/revoke delegates, create conversations, opt in, inspect plans, confirm and cancel. |

A2A requests require `Content-Type: application/json` and `A2A-Version: 1.0`. Cookies and ordinary app-session tokens do not authenticate an A2A request. Conversely, an `sp_agent_…` delegation token does not authenticate the member-control API. Streaming, push callbacks, extended authenticated cards, tenant routing, and other transports are not supported.

## Permission and state model

1. Each person creates a revocable delegation for their assistant. The token is returned once, stored only as a SHA-256 hash, and grants `workout:negotiate` for 1–24 hours (24 by default). It can access that member's mutually consented conversations, not just one selected conversation. A member can hold at most ten active tokens.
2. A person opens a negotiation using a **completed shared booking**. Creating it records that person's consent; the other person must opt in using their own app session. An existing open conversation for the same booking is returned rather than duplicated. Agents cannot create conversations or consent for people.
3. Either delegated assistant submits a complete structured proposal for that conversation. Both people must remain eligible and both must have consented. Blocked, suspended, or deleted members lose access. No precise meeting pin, private calendar, or home address is exchanged.
4. A counteroffer is another `propose` command with the current `expectedRevision` and a new `messageId`. Each accepted proposal increments the revision and clears previous confirmations. The exact same message ID and command are idempotent per member and conversation; reusing the ID with different content is rejected. A stale revision is rejected rather than silently replacing a newer plan.
5. Each person reviews the current proposal and explicitly confirms its revision through the member API. Clients must require a human action before invoking this endpoint and must never give the agent the person's full app-session token. Delegation tokens cannot confirm proposals. The second matching confirmation sets the negotiation to `approved`, with `booked: false`.
6. Either person can withdraw consent, which cancels the conversation and clears confirmations. A member or authorized delegate can also cancel an open negotiation. This never cancels an existing workout, seat, or standing slot.

Conversations expire after seven days; an expired open conversation is exposed as `expired` in member DTOs and `TASK_STATE_CANCELED` over A2A. Each person can participate in at most 20 unexpired open conversations, including invitations they have not yet accepted; creation checks both people's quotas. A conversation accepts at most 50 proposal revisions. A2A request bodies are capped at 16 KiB. These bounds are not a distributed traffic-rate limiter.

`ListTasks` filters eligibility, mutual consent, context, state, and status timestamp before pagination. Its total and continuation token cover the full matching collection, including more than 100 historical tasks; the member activity API separately shows only the latest 100 conversations. Expiration uses `expiresAt` as the effective status timestamp, so incremental polling can observe a task becoming canceled without a write to the room.

| Member state | A2A task state | Meaning |
| --- | --- | --- |
| `open` | `TASK_STATE_INPUT_REQUIRED` | Waiting for a proposal or both human confirmations. |
| `approved` | `TASK_STATE_COMPLETED` | Both people approved the current plan; **nothing booked**. |
| `cancelled` / `expired` | `TASK_STATE_CANCELED` | Negotiation ended. |

The negotiation ID is the A2A `taskId` and `contextId`. Agents cannot use arbitrary tasks or create new tasks with `SendMessage`. Plan artifacts and task metadata explicitly report `booked: false`.

## Human control API

All paths below are under `/api/v1`. JSON bodies reject unknown properties. Negotiation and delegation path IDs are UUIDs. Standard API errors use `{ "error": "…" }` with `400` for invalid input, `401` for absent/invalid app sessions, `404` for inaccessible conversations, and `409` for stale or disallowed actions.

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /agents/delegations` | — | `{ delegations: [{ id, label, expiresAt, revokedAt }] }`; no token values. |
| `POST /agents/delegations` | `{ label, expiresInHours? }` | `{ delegation: { id, label, token, expiresAt, scope: "workout:negotiate" } }`. Label is 1–80 characters; expiry is an integer 1–24. |
| `DELETE /agents/delegations/:id` | Empty or `{}` | `{ ok: true }`; idempotent, applies only to the caller's delegation. |
| `GET /agents/negotiations` | — | `{ negotiations: NegotiationView[] }`; latest 100 accessible conversations. |
| `POST /agents/negotiations` | `{ bookingId }` | `{ negotiation: NegotiationView }`; booking must be completed and shared with the caller. |
| `GET /agents/negotiations/:id` | — | `{ negotiation: NegotiationView }`. |
| `POST /agents/negotiations/:id/consent` | `{ allow: boolean }` | `{ negotiation: NegotiationView }`; only changes caller consent. |
| `POST /agents/negotiations/:id/confirm` | `{ revision: integer >= 1 }` | `{ negotiation: NegotiationView }`; explicit human approval for the exact revision. |
| `POST /agents/negotiations/:id/cancel` | Empty or `{}` | `{ negotiation: NegotiationView }`; closes an open conversation. |

`NegotiationView` is produced by `service.view`:

```ts
type NegotiationView = {
  id: string;
  bookingId: string;
  memberIds: string[];
  consentedIds: string[];
  state: "open" | "approved" | "cancelled" | "expired";
  revision: number;
  plan: WorkoutPlan | null;
  confirmedIds: string[];
  expiresAt: string; // ISO 8601
  booked: false;
};
```

`WorkoutPlan` is a strict object with `title` (1–120 characters), `venueId` (known public venue, 1–100 characters), `activity`, matching `ability`, `startAt` (ISO 8601 with timezone), and integer `durationMin` (10–360). Starts must be 30 minutes to 14 days ahead, including when people confirm. Ability values use the same validated activity/level ranges as normal sessions; see [the API ability contract](./API.md#ability). There are no booking, fee, capacity, identity, or calendar fields in the proposal schema.

## Example: two assistants, one shared conversation

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

Finally, after each person has read and accepted the same current proposal, the app performs each person's confirmation separately. For the example with no counteroffer:

```sh
curl --fail-with-body -sS "$ORIGIN/api/v1/agents/negotiations/$ROOM_ID/confirm" \
  -H "Authorization: Bearer $MEMBER_A_SESSION" -H 'Content-Type: application/json' \
  --data '{"revision":1}'

curl --fail-with-body -sS "$ORIGIN/api/v1/agents/negotiations/$ROOM_ID/confirm" \
  -H "Authorization: Bearer $MEMBER_B_SESSION" -H 'Content-Type: application/json' \
  --data '{"revision":1}'
```

The last response is `approved` with `booked: false`. A future booking integration must revalidate time, eligibility, blocks, availability, capacity, and fees through the existing booking service. This foundation does not yet perform that step.
