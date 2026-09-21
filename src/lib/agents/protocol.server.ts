/** A2A 1.0 JSON-RPC adapter. The SDK owns wire serialization and protocol errors. */
import {
  AgentCard,
  Message,
  Role,
  Task,
  TaskState,
  type ListTasksRequest,
  type SendMessageRequest,
} from "@a2a-js/sdk";
import {
  JsonRpcTransportHandler,
  ServerCallContext,
  validateVersion,
  type A2ARequestHandler,
} from "@a2a-js/sdk/server";
import {
  ExtendedAgentCardNotConfiguredError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from "@a2a-js/sdk/errors";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { PaceError } from "../pace/service.server.ts";
import { PLAN_SCHEMA, PROTOCOL_VERSION } from "./contracts.ts";
import * as service from "./service.server.ts";
import { sharedPreferences } from "./assistant.server.ts";

export const enabled = () => process.env.A2A_ENABLED === "true";

export function agentCard(baseUrl = process.env.A2A_BASE_URL || "https://samepace.app"): AgentCard {
  const base = new URL(baseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    (base.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      ))
  ) {
    throw new Error("A2A_BASE_URL must be an HTTPS origin (loopback HTTP is allowed locally).");
  }
  return AgentCard.fromJSON({
    name: "SamePace workout coordinator",
    description:
      "Negotiates a next workout for two members who opted in. Proposals require each member's approval; this agent cannot book or cancel workouts.",
    version: "0.1.0",
    supportedInterfaces: [
      {
        url: `${base.origin}/api/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: PROTOCOL_VERSION,
      },
    ],
    provider: { organization: "SamePace", url: "https://samepace.app" },
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    securitySchemes: {
      memberDelegate: {
        httpAuthSecurityScheme: {
          scheme: "bearer",
          bearerFormat: "SamePace scoped delegation token",
          description:
            "A member issues a revocable token using POST /api/v1/agents/delegations. App-session tokens are not accepted here.",
        },
      },
    },
    securityRequirements: [{ schemes: { memberDelegate: { list: [] } } }],
    skills: [
      {
        id: "negotiate-workout",
        name: "Propose a workout",
        description: `Send one structured ${PLAN_SCHEMA} proposal in a consented task. GetTask and ListTasks retrieve revisions; CancelTask closes only the proposal conversation.`,
        tags: ["workout", "planning", "human-confirmation"],
        examples: ["Propose Thursday at 6:45 PM at our public trail venue."],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  });
}

const historyLength = (n?: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(100)
    .parse(n ?? 20);
const roomId = (s: string) => z.uuid().parse(s);

async function taskFor(
  sql: Sql,
  room: service.Negotiation,
  limit?: number,
  now = Date.now(),
): Promise<Task> {
  const r = service.view(room, now);
  const state =
    r.state === "approved"
      ? TaskState.TASK_STATE_COMPLETED
      : r.state === "cancelled" || r.state === "expired"
        ? TaskState.TASK_STATE_CANCELED
        : TaskState.TASK_STATE_INPUT_REQUIRED;
  const events = await service.history(sql, room, historyLength(limit));
  return Task.fromJSON({
    id: room.id,
    contextId: room.id,
    status: {
      state,
      timestamp: service.statusTimestamp(room, now),
      message: Message.toJSON(
        Message.fromJSON({
          messageId: `status-${room.id}-${room.revision}`,
          taskId: room.id,
          contextId: room.id,
          role: "ROLE_AGENT",
          parts: [
            {
              text:
                state === TaskState.TASK_STATE_COMPLETED
                  ? r.booked
                    ? "Both members separately accepted the booking terms in SamePace. Their workout is booked."
                    : "Both members approved this plan. Booking still requires both members to accept the terms in SamePace."
                  : state === TaskState.TASK_STATE_CANCELED
                    ? "This proposal conversation has ended."
                    : "Waiting for a proposal or both members to confirm the current revision in SamePace.",
            },
          ],
        }),
      ),
    },
    artifacts: r.plan
      ? [
          {
            artifactId: `${room.id}:${room.revision}`,
            name: "Workout proposal",
            parts: [
              {
                data: {
                  schema: PLAN_SCHEMA,
                  revision: r.revision,
                  plan: r.plan,
                  confirmedIds: r.confirmedIds,
                  booked: r.booked,
                },
                mediaType: "application/json",
              },
            ],
          },
        ]
      : [],
    history: events.map((e) => ({
      messageId: e.message_id,
      taskId: room.id,
      contextId: room.id,
      role: "ROLE_AGENT",
      parts: [
        {
          data: { kind: e.kind, actorId: e.profile_id, revision: e.revision, ...e.data },
          mediaType: "application/json",
        },
      ],
    })),
    metadata: {
      revision: r.revision,
      expiresAt: r.expiresAt,
      booked: r.booked,
      confirmationMode: "each-member-in-app",
      sharedPreferences: await sharedPreferences(sql, room.host_id, room.id, now),
    },
  });
}

async function protocolErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PaceError) {
      if (err.status === 404 || err.status === 403) throw new TaskNotFoundError();
      throw new RequestMalformedError(err.message);
    }
    if (err instanceof z.ZodError)
      throw new RequestMalformedError("Invalid proposal or task parameters.");
    throw err;
  }
}

export function requestHandler(
  sql: Sql,
  actor: service.Delegate,
  card: AgentCard,
  now = Date.now(),
): A2ARequestHandler {
  const read = (id: string) => service.getNegotiation(sql, actor.profileId, roomId(id), true);
  const noPush = async (): Promise<never> => {
    throw new PushNotificationNotSupportedError();
  };
  return {
    getAgentCard: async () => card,
    getAuthenticatedExtendedAgentCard: async () => {
      throw new ExtendedAgentCardNotConfiguredError();
    },
    sendMessage: (params: SendMessageRequest) =>
      protocolErrors(async () => {
        const m = params.message;
        if (
          !m ||
          m.role !== Role.ROLE_USER ||
          !m.taskId ||
          m.parts.length !== 1 ||
          m.parts[0].content?.$case !== "data" ||
          m.referenceTaskIds.length ||
          params.tenant ||
          (m.contextId && m.contextId !== m.taskId)
        ) {
          throw new RequestMalformedError(
            "Send one structured proposal for an existing consented task.",
          );
        }
        if (params.configuration?.taskPushNotificationConfig)
          throw new PushNotificationNotSupportedError();
        const modes = params.configuration?.acceptedOutputModes ?? [];
        if (modes.length && !modes.includes("application/json"))
          throw new RequestMalformedError("Accept application/json.");
        const limit = historyLength(params.configuration?.historyLength);
        const r = await service.propose(
          sql,
          actor,
          roomId(m.taskId),
          m.messageId,
          m.parts[0].content.value,
          now,
        );
        return taskFor(sql, r, limit, now);
      }),
    getTask: (params) =>
      protocolErrors(async () => taskFor(sql, await read(params.id), params.historyLength, now)),
    cancelTask: (params) =>
      protocolErrors(async () => {
        const r = await read(params.id);
        if (r.state === "approved" || +new Date(r.expires_at) <= now)
          throw new TaskNotCancelableError();
        return taskFor(
          sql,
          await service.cancelNegotiation(sql, actor.profileId, r.id, actor, now),
          undefined,
          now,
        );
      }),
    listTasks: (params: ListTasksRequest) =>
      protocolErrors(async () => {
        const size = z
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(params.pageSize ?? 50);
        const offset = params.pageToken
          ? z
              .string()
              .regex(/^\d{1,6}$/)
              .transform(Number)
              .parse(params.pageToken)
          : 0;
        const limit = historyLength(params.historyLength);
        const after = params.statusTimestampAfter
          ? z.iso.datetime({ offset: true }).parse(params.statusTimestampAfter)
          : undefined;
        const state = !params.status
          ? undefined
          : params.status === TaskState.TASK_STATE_INPUT_REQUIRED
            ? "open"
            : params.status === TaskState.TASK_STATE_COMPLETED
              ? "approved"
              : params.status === TaskState.TASK_STATE_CANCELED
                ? "cancelled"
                : "unsupported";
        const { rooms, total } = await service.listAgentNegotiations(
          sql,
          actor.profileId,
          {
            pageSize: size,
            offset,
            contextId: params.contextId || undefined,
            state,
            statusTimestampAfter: after,
          },
          now,
        );
        const tasks = await Promise.all(rooms.map((r) => taskFor(sql, r, limit, now)));
        return {
          tasks: tasks.map((t) => (params.includeArtifacts ? t : { ...t, artifacts: [] })),
          pageSize: size,
          totalSize: total,
          nextPageToken: offset + size < total ? String(offset + size) : "",
        };
      }),
    sendMessageStream: async function* () {
      yield await Promise.reject<never>(new UnsupportedOperationError());
    },
    resubscribe: async function* () {
      yield await Promise.reject<never>(new UnsupportedOperationError());
    },
    createTaskPushNotificationConfig: noPush,
    getTaskPushNotificationConfig: noPush,
    listTaskPushNotificationConfigs: noPush,
    deleteTaskPushNotificationConfig: noPush,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "A2A-Version": PROTOCOL_VERSION, ...headers },
  });

/** Bounded reads cover chunked requests as well as Content-Length requests. */
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The HTTP adapter accepts scoped delegation tokens only, never app cookies. */
export async function handleA2A(
  request: Request,
  sql: Sql,
  options: { baseUrl?: string; now?: number } = {},
) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "Use application/json." }, 415);
  }
  const body = await readBody(request);
  if (body === null) return json({ error: "Request too large." }, 413);
  // Authenticate after consuming the bounded body: a slow sender cannot preserve an expired grant.
  const now = options.now ?? Date.now();
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1] ?? "";
  const actor = await service.authenticateDelegate(sql, token, now);
  if (!actor)
    return json({ error: "A valid SamePace agent delegation is required." }, 401, {
      "www-authenticate": 'Bearer realm="samepace-agent"',
    });
  const card = agentCard(options.baseUrl);
  const version = request.headers.get("a2a-version") ?? "0.3";
  const context = new ServerCallContext({
    requestedVersion: version,
    user: { isAuthenticated: true, userName: actor.profileId },
  });
  try {
    validateVersion(version, card, "JSONRPC");
  } catch (err) {
    return json({
      jsonrpc: "2.0",
      id: null,
      error: JsonRpcTransportHandler.mapToJSONRPCError(err),
    });
  }
  // Validate the JSON-RPC envelope before SDK decoding. SDK 1.2 does not safely
  // handle JSON null and maps parse errors to invalid-params errors.
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !("jsonrpc" in input) ||
    input.jsonrpc !== "2.0" ||
    !("method" in input) ||
    typeof input.method !== "string" ||
    !("id" in input) ||
    (typeof input.id !== "string" && typeof input.id !== "number" && input.id !== null)
  ) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
  }
  if (
    "params" in input &&
    (input.params === null || typeof input.params !== "object" || Array.isArray(input.params))
  ) {
    return json({
      jsonrpc: "2.0",
      id: input.id,
      error: { code: -32602, message: "Invalid params" },
    });
  }
  // Tenant is intentionally unsupported: authorization always comes from the token.
  if ("params" in input && (input as { params?: { tenant?: unknown } }).params?.tenant) {
    return json({
      jsonrpc: "2.0",
      id: input.id,
      error: JsonRpcTransportHandler.mapToJSONRPCError(
        new RequestMalformedError("Tenant routing is unsupported."),
      ),
    });
  }
  const response = await new JsonRpcTransportHandler(requestHandler(sql, actor, card, now)).handle(
    body,
    context,
  );
  if (Symbol.asyncIterator in response) return json({ error: "Streaming is unsupported." }, 400);
  return json(response);
}
