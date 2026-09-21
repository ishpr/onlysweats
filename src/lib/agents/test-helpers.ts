import { randomUUID } from "node:crypto";
import { AgentCard } from "@a2a-js/sdk";
import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory } from "@a2a-js/sdk/client";
import type { Sql } from "../db.ts";
import * as pace from "../pace/service.server.ts";
import * as agents from "./service.server.ts";
import { agentCard, handleA2A } from "./protocol.server.ts";
import { PLAN_SCHEMA } from "./contracts.ts";

export { makeDb } from "../pace/test-db.ts";
export const BASE = "https://samepace.example";
export const HOUR = 3_600_000;
const RUN = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 } as const;

export async function pair(sql: Sql, consent = true) {
  const host = randomUUID();
  const member = randomUUID();
  for (const id of [host, member]) {
    await sql`insert into "user" (id, name, email, "emailVerified")
      values (${id}, ${id}, ${`${id}@example.com`}, true)`;
    await pace.ensureProfile(sql, { id, name: id, email: `${id}@example.com` });
  }
  const now = Date.now() + 31 * 60_000;
  const session = await pace.postSession(sql, host, {
    venueId: "katy", activity: "run", title: "Easy miles", detail: "", ability: RUN,
    abilityFlex: "strict", startAt: new Date(now).toISOString(), durationMin: 40,
    capacity: 2, visibility: "public", joinMode: "instant", womenOnly: false,
  });
  const booking = await pace.bookSeat(sql, member, session.id);
  const point = { lat: 32.8019, lng: -96.8074 };
  await pace.checkInGeo(sql, host, booking.id, point, now);
  await pace.checkInGeo(sql, member, booking.id, point, now);
  const room = await agents.createNegotiation(sql, host, booking.id, now);
  if (consent) await agents.consentToNegotiation(sql, member, room.id, true, now);
  const hostGrant = await agents.createDelegation(sql, host, { label: "Host planner" }, now);
  const memberGrant = await agents.createDelegation(sql, member, { label: "Member planner" }, now);
  return { host, member, now, session, booking, room, hostGrant, memberGrant };
}

export const proposal = (now: number, expectedRevision = 0) => ({
  schema: PLAN_SCHEMA, action: "propose" as const, expectedRevision,
  plan: { title: "Our next easy run", venueId: "katy", activity: "run" as const,
    ability: RUN, startAt: new Date(now + 24 * HOUR).toISOString(), durationMin: 40 },
});

/** Real official-client discovery, serialization and HTTP transport without a network. */
export async function sdkClient(sql: Sql, token: string, now: number) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === "/.well-known/agent-card.json") {
      return Response.json(AgentCard.toJSON(agentCard(BASE)));
    }
    request.headers.set("authorization", `Bearer ${token}`);
    return handleA2A(request, sql, { baseUrl: BASE, now });
  };
  return new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
  }).createFromUrl(BASE);
}

export async function rpc(sql: Sql, token: string, now: number, method: string, params: unknown) {
  return handleA2A(new Request(`${BASE}/api/a2a`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "test-rpc", method, params }),
  }), sql, { baseUrl: BASE, now });
}
