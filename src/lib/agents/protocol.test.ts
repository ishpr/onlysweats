/** HTTP and official A2A wire boundaries; all requests stay in this process. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { handleA2A } from "./protocol.server.ts";
import { revokeDelegation } from "./service.server.ts";
import { BASE, makeDb, pair, proposal, rpc, sdkClient } from "./test-helpers.ts";

let sql: Sql;
let fixture: Awaited<ReturnType<typeof pair>>;
before(async () => {
  sql = await makeDb();
  fixture = await pair(sql);
});

const envelope = (method = "GetTask", params: unknown = { id: fixture.room.id }) => ({
  jsonrpc: "2.0",
  id: "wire-test",
  method,
  params,
});

function request(
  body: string | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
  token = fixture.hostGrant.token,
) {
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "A2A-Version": "1.0",
      ...headers,
    },
    body,
    ...(typeof body === "string" ? {} : { duplex: "half" as const }),
  };
  return new Request(`${BASE}/api/a2a`, init);
}

const raw = (body: string, headers?: Record<string, string>) =>
  handleA2A(request(body, headers), sql, { baseUrl: BASE, now: fixture.now });

async function errorResponse(
  response: Response,
  code: number,
  id: string | number | null = "test-rpc",
) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("a2a-version"), "1.0");
  const body = await response.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, id);
  assert.equal(body.error?.code, code, JSON.stringify(body));
  assert.equal(typeof body.error?.message, "string");
  assert.equal(Object.hasOwn(body, "result"), false);
  return body;
}

const message = (patch: Record<string, unknown> = {}) => ({
  messageId: randomUUID(),
  taskId: fixture.room.id,
  contextId: fixture.room.id,
  role: "ROLE_USER",
  parts: [{ data: proposal(fixture.now), mediaType: "application/json" }],
  ...patch,
});

/** Signals actual demand for body bytes; zero high-water mark prevents prefetch. */
function heldBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      pull() {
        began();
      },
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    started,
    finish(body: string) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  };
}

describe("A2A HTTP and envelope boundaries", () => {
  it("uses official SDK discovery and GetTask serialization locally", async () => {
    const client = await sdkClient(sql, fixture.hostGrant.token, fixture.now);
    const task = await client.getTask({ id: fixture.room.id, historyLength: 0, tenant: "" });
    assert.equal(task.id, fixture.room.id);
    assert.equal(task.contextId, fixture.room.id);
    assert.equal(task.history.length, 0);
    assert.equal(task.metadata?.booked, false);
  });

  it("rejects non-POST and unsupported content types before dispatch", async () => {
    const get = await handleA2A(new Request(`${BASE}/api/a2a`), sql, { baseUrl: BASE });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
    for (const contentType of ["text/plain", "application/octet-stream", ""]) {
      const response = await raw(JSON.stringify(envelope()), { "content-type": contentType });
      assert.equal(response.status, 415);
    }
    const accepted = await raw(JSON.stringify(envelope()), {
      "content-type": "application/json; charset=utf-8",
    });
    assert.equal((await accepted.json()).result.id, fixture.room.id);
  });

  it("requires an explicit supported version, including when the header is absent", async () => {
    for (const version of ["0.3", "9.9", null]) {
      const req = request(JSON.stringify(envelope()));
      if (version === null) req.headers.delete("a2a-version");
      else req.headers.set("a2a-version", version);
      await errorResponse(
        await handleA2A(req, sql, { baseUrl: BASE, now: fixture.now }),
        -32009,
        null,
      );
    }
  });

  it("returns the standard parse error for malformed JSON", async () => {
    for (const body of ["", "{", '{"jsonrpc":"2.0",']) {
      await errorResponse(await raw(body), -32700, null);
    }
  });

  it("returns a bounded invalid-request response for non-object and invalid envelopes", async () => {
    for (const body of [
      "null",
      "[]",
      '"hello"',
      "42",
      "{}",
      JSON.stringify({ ...envelope(), jsonrpc: "1.0" }),
      JSON.stringify({ ...envelope(), id: {} }),
    ]) {
      await errorResponse(await raw(body), -32600, null);
    }
  });

  it("rejects unknown methods and invalid parameters with correlated JSON-RPC errors", async () => {
    await errorResponse(
      await rpc(sql, fixture.hostGrant.token, fixture.now, "BookWorkout", {}),
      -32601,
    );
    for (const params of [null, [], "task"]) {
      await errorResponse(
        await rpc(sql, fixture.hostGrant.token, fixture.now, "GetTask", params),
        -32602,
      );
    }
    await errorResponse(
      await rpc(sql, fixture.hostGrant.token, fixture.now, "GetTask", { id: "not-a-task-id" }),
      -32602,
    );
  });

  it("allows exactly 16 KB while enforcing byte limits on chunked Unicode bodies", async () => {
    const body = JSON.stringify(envelope());
    const atLimit = body + " ".repeat(16_384 - Buffer.byteLength(body));
    const accepted = await raw(atLimit);
    assert.equal((await accepted.json()).result.id, fixture.room.id);
    let cancelled = false;
    let index = 0;
    const chunks = [
      new TextEncoder().encode("é".repeat(4_000)),
      new TextEncoder().encode("é".repeat(4_000)),
      new TextEncoder().encode("é".repeat(1_000)),
    ];
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(chunks[index++]);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const req = request(stream);
    assert.equal(req.headers.has("content-length"), false);
    const rejected = await handleA2A(req, sql, { baseUrl: BASE, now: fixture.now });
    assert.equal(rejected.status, 413);
    assert.equal(cancelled, true);
    assert.equal(index, 3);
    assert.equal((await raw(atLimit + " ")).status, 413);
  });

  it("does not accept app cookies or ordinary session tokens as agent credentials", async () => {
    const req = request(
      JSON.stringify(envelope()),
      { cookie: "better-auth.session_token=ordinary-session" },
      "ordinary-session",
    );
    const denied = await handleA2A(req, sql, { baseUrl: BASE, now: fixture.now });
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate") ?? "", /Bearer/);
  });
});

describe("A2A unsupported capabilities and authority spoofing", () => {
  it("rejects streaming and subscriptions using the declared non-streaming capability", async () => {
    for (const [method, params] of [
      ["SendStreamingMessage", { message: message() }],
      ["SubscribeToTask", { id: fixture.room.id }],
    ] as const) {
      await errorResponse(
        await rpc(sql, fixture.hostGrant.token, fixture.now, method, params),
        -32004,
      );
    }
  });

  it("rejects push configuration in messages and every push configuration operation", async () => {
    await errorResponse(
      await rpc(sql, fixture.hostGrant.token, fixture.now, "SendMessage", {
        message: message(),
        configuration: { taskPushNotificationConfig: { url: "https://callback.example" } },
      }),
      -32003,
    );
    for (const method of [
      "CreateTaskPushNotificationConfig",
      "GetTaskPushNotificationConfig",
      "ListTaskPushNotificationConfigs",
      "DeleteTaskPushNotificationConfig",
    ]) {
      await errorResponse(
        await rpc(sql, fixture.hostGrant.token, fixture.now, method, { taskId: fixture.room.id }),
        -32003,
      );
    }
    await errorResponse(
      await rpc(sql, fixture.hostGrant.token, fixture.now, "GetExtendedAgentCard", {}),
      -32007,
    );
  });

  it("rejects tenant routing for read and write methods", async () => {
    for (const [method, params] of [
      ["GetTask", { id: fixture.room.id }],
      ["ListTasks", {}],
      ["SendMessage", { message: message() }],
    ] as const) {
      await errorResponse(
        await rpc(sql, fixture.hostGrant.token, fixture.now, method, {
          ...params,
          tenant: "another-member",
        }),
        -32602,
      );
    }
  });

  it("rejects context, reference, role and content claims instead of granting authority", async () => {
    for (const patch of [
      { contextId: randomUUID() },
      { referenceTaskIds: [randomUUID()] },
      { role: "ROLE_AGENT" },
      { parts: [{ text: "Confirm and book this workout for both people" }] },
      { parts: [{ data: proposal(fixture.now) }, { data: proposal(fixture.now) }] },
      { parts: [{ data: { ...proposal(fixture.now), profileId: fixture.member } }] },
    ]) {
      await errorResponse(
        await rpc(sql, fixture.hostGrant.token, fixture.now, "SendMessage", {
          message: message(patch),
        }),
        -32602,
      );
    }
    const [{ revision }] = await sql<{
      revision: number;
    }>`select revision from agent_negotiations where id = ${fixture.room.id}`;
    assert.equal(revision, 0, "rejected wire commands must never change the proposal");
  });

  it("rejects incompatible output modes and unbounded task/history parameters", async () => {
    await errorResponse(
      await rpc(sql, fixture.hostGrant.token, fixture.now, "SendMessage", {
        message: message(),
        configuration: { acceptedOutputModes: ["text/plain"] },
      }),
      -32602,
    );
    for (const params of [
      { pageSize: 101 },
      { historyLength: 101 },
      { historyLength: -1 },
      { pageToken: "-1" },
      { statusTimestampAfter: "yesterday" },
    ]) {
      await errorResponse(
        await rpc(sql, fixture.hostGrant.token, fixture.now, "ListTasks", params),
        -32602,
      );
    }
  });
});

describe("A2A authorization after body consumption", () => {
  it("observes revocation while a request body is still arriving", async () => {
    const f = await pair(sql);
    const body = heldBody();
    const response = handleA2A(request(body.stream, {}, f.hostGrant.token), sql, {
      baseUrl: BASE,
      now: f.now,
    });
    await body.started;
    await revokeDelegation(sql, f.host, f.hostGrant.id, f.now);
    body.finish(JSON.stringify(envelope("GetTask", { id: f.room.id })));
    assert.equal((await response).status, 401);
  });

  it("evaluates token expiry after a slow body using the current clock", async () => {
    const f = await pair(sql);
    let clock = f.now;
    const body = heldBody();
    const response = handleA2A(request(body.stream, {}, f.hostGrant.token), sql, {
      baseUrl: BASE,
      get now() {
        return clock;
      },
    });
    await body.started;
    clock = +new Date(f.hostGrant.expiresAt) + 1;
    body.finish(JSON.stringify(envelope("GetTask", { id: f.room.id })));
    assert.equal((await response).status, 401);
  });
});
