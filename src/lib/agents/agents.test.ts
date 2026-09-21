import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CancelTaskRequest, GetTaskRequest, ListTasksRequest, SendMessageRequest, TaskState, type Task } from "@a2a-js/sdk";
import type { Sql } from "../db.ts";
import * as pace from "../pace/service.server.ts";
import * as safety from "../pace/safety.server.ts";
import * as agents from "./service.server.ts";
import { makeDb, pair, proposal, sdkClient, rpc, HOUR } from "./test-helpers.ts";

let sql: Sql;
before(async () => { sql = await makeDb(); });
const get = (id: string) => GetTaskRequest.fromJSON({ id });
const send = (id: string, messageId: string, command: unknown) => SendMessageRequest.fromJSON({
  message: { taskId: id, contextId: id, messageId, role: "ROLE_USER",
    parts: [{ data: command, mediaType: "application/json" }] },
});
const rejects = (promise: Promise<unknown>, status: number) => assert.rejects(promise,
  (err: unknown) => err instanceof pace.PaceError && err.status === status);
const task = (value: Task | unknown): Task => {
  assert.ok(value && typeof value === "object" && "status" in value);
  return value as Task;
};

describe("A2A workout negotiation", () => {
  it("two official SDK clients discover, counter, and await separate human approvals without booking", async () => {
    const f = await pair(sql);
    const first = await sdkClient(sql, f.hostGrant.token, f.now);
    const second = await sdkClient(sql, f.memberGrant.token, f.now);
    const before = await sql`select (select count(*) from sessions) sessions,
      (select count(*) from bookings) bookings, (select count(*) from ledger_events) ledger`;
    const initial = await first.getTask(get(f.room.id));
    assert.equal(initial.status?.state, TaskState.TASK_STATE_INPUT_REQUIRED);
    const p1 = proposal(f.now);
    const proposed = task(await first.sendMessage(send(f.room.id, "proposal-1", p1)));
    assert.equal(proposed.metadata?.revision, 1);
    assert.equal(proposed.artifacts.length, 1);
    const replay = task(await first.sendMessage(send(f.room.id, "proposal-1", p1)));
    assert.equal(replay.metadata?.revision, 1);
    await assert.rejects(first.sendMessage(send(f.room.id, "proposal-1", proposal(f.now, 1))));
    await assert.rejects(second.sendMessage(send(f.room.id, "stale", p1)));
    await agents.confirmProposal(sql, f.host, f.room.id, 1, f.now);
    assert.equal((await second.getTask(get(f.room.id))).status?.state, TaskState.TASK_STATE_INPUT_REQUIRED);
    const p2 = proposal(f.now, 1);
    p2.plan.startAt = new Date(f.now + 25 * HOUR).toISOString();
    const counter = task(await second.sendMessage(send(f.room.id, "proposal-2", p2)));
    assert.equal(counter.metadata?.revision, 2);
    assert.deepEqual((await agents.getNegotiation(sql, f.host, f.room.id)).confirmations, []);
    await rejects(agents.confirmProposal(sql, f.host, f.room.id, 1, f.now), 409);
    await assert.rejects(first.sendMessage(send(f.room.id, "fake-confirm", { action: "confirm", revision: 2 })));
    await agents.confirmProposal(sql, f.host, f.room.id, 2, f.now);
    await agents.confirmProposal(sql, f.member, f.room.id, 2, f.now);
    const final = await second.getTask(GetTaskRequest.fromJSON({ id: f.room.id, historyLength: 0 }));
    assert.equal(final.status?.state, TaskState.TASK_STATE_COMPLETED);
    assert.equal(final.metadata?.booked, false);
    assert.equal(final.history.length, 0);
    const listed = await first.listTasks(ListTasksRequest.fromJSON({ contextId: f.room.id, includeArtifacts: true }));
    assert.equal(listed.totalSize, 1);
    assert.equal(listed.tasks[0].id, f.room.id);
    await assert.rejects(first.cancelTask(CancelTaskRequest.fromJSON({ id: f.room.id })));
    assert.deepEqual(await sql`select (select count(*) from sessions) sessions,
      (select count(*) from bookings) bookings, (select count(*) from ledger_events) ledger`, before);
    const events = await agents.history(sql, await agents.getNegotiation(sql, f.host, f.room.id));
    assert.equal(events.filter(e => e.kind === "proposal").length, 2);
  });

  it("requires both members' opt-in and excludes strangers", async () => {
    const f = await pair(sql, false);
    const c = await sdkClient(sql, f.hostGrant.token, f.now);
    await assert.rejects(c.getTask(get(f.room.id)));
    await assert.rejects(c.sendMessage(send(f.room.id, "no-consent", proposal(f.now))));
    assert.equal((await c.listTasks(ListTasksRequest.fromJSON({}))).totalSize, 0);
    await rejects(agents.consentToNegotiation(sql, "stranger", f.room.id, true, f.now), 404);
    await agents.consentToNegotiation(sql, f.member, f.room.id, true, f.now);
    assert.equal((await c.getTask(get(f.room.id))).id, f.room.id);
    const stranger = await pair(sql);
    const other = await sdkClient(sql, stranger.hostGrant.token, f.now);
    await assert.rejects(other.getTask(get(f.room.id)));
    await assert.rejects(other.sendMessage(send(f.room.id, "stranger", proposal(f.now))));
    const same = await Promise.all([agents.createNegotiation(sql, f.host, f.booking.id, f.now),
      agents.createNegotiation(sql, f.member, f.booking.id, f.now)]);
    assert.deepEqual(same.map(r => r.id), [f.room.id, f.room.id]);
  });

  it("stores only credential hashes, isolates revocation, and rechecks grants on mutations", async () => {
    const f = await pair(sql);
    const actor = await agents.authenticateDelegate(sql, f.hostGrant.token, f.now);
    assert.ok(actor);
    const [stored] = await sql`select token_hash from agent_delegations where id = ${f.hostGrant.id}`;
    assert.equal(String(stored.token_hash).length, 64);
    assert.notEqual(stored.token_hash, f.hostGrant.token);
    assert.ok(!JSON.stringify(await agents.listDelegations(sql, f.host)).includes(f.hostGrant.token));
    await agents.revokeDelegation(sql, f.member, f.hostGrant.id, f.now);
    assert.ok(await agents.authenticateDelegate(sql, f.hostGrant.token, f.now));
    await agents.revokeDelegation(sql, f.host, f.hostGrant.id, f.now);
    assert.equal(await agents.authenticateDelegate(sql, f.hostGrant.token, f.now), null);
    await rejects(agents.propose(sql, actor, f.room.id, "revoked", proposal(f.now), f.now), 403);
    await rejects(agents.cancelNegotiation(sql, f.host, f.room.id, actor, f.now), 403);
    for (const token of [f.hostGrant.token, "ordinary-session-token", ""]) {
      assert.equal((await rpc(sql, token, f.now, "GetTask", { id: f.room.id })).status, 401);
    }
    assert.equal((await rpc(sql, f.memberGrant.token, f.now + 25 * HOUR, "GetTask", { id: f.room.id })).status, 401);
  });

  it("withdrawal immediately removes agent access even after approval", async () => {
    const f = await pair(sql);
    const actor = (await agents.authenticateDelegate(sql, f.hostGrant.token, f.now))!;
    await agents.propose(sql, actor, f.room.id, "p", proposal(f.now), f.now);
    await agents.confirmProposal(sql, f.host, f.room.id, 1, f.now);
    await agents.confirmProposal(sql, f.member, f.room.id, 1, f.now);
    const withdrawn = await agents.consentToNegotiation(sql, f.member, f.room.id, false, f.now);
    assert.equal(withdrawn.state, "cancelled");
    assert.deepEqual(withdrawn.confirmations, []);
    await rejects(agents.getNegotiation(sql, f.host, f.room.id, true), 404);
    assert.equal((await agents.listNegotiations(sql, f.host, true)).length, 0);
  });

  it("rejects invalid plans and expired proposals without changing revisions", async () => {
    const f = await pair(sql);
    const actor = (await agents.authenticateDelegate(sql, f.hostGrant.token, f.now))!;
    for (const patch of [{ venueId: "private-home" }, { startAt: new Date(f.now).toISOString() },
      { startAt: new Date(f.now + 15 * 24 * HOUR).toISOString() }, { activity: "ride" }]) {
      const p = proposal(f.now);
      await rejects(agents.propose(sql, actor, f.room.id, "bad", { ...p, plan: { ...p.plan, ...patch } }, f.now), 400);
    }
    assert.equal((await agents.getNegotiation(sql, f.host, f.room.id)).revision, 0);
    await agents.propose(sql, actor, f.room.id, "good", proposal(f.now), f.now);
    await rejects(agents.confirmProposal(sql, f.host, f.room.id, 1, f.now + 24 * HOUR), 400);
    await sql`update agent_negotiations set expires_at = ${new Date(f.now - 1).toISOString()} where id = ${f.room.id}`;
    await rejects(agents.propose(sql, actor, f.room.id, "ended", proposal(f.now, 1), f.now), 409);
    await rejects(agents.confirmProposal(sql, f.member, f.room.id, 1, f.now), 409);
    assert.equal(agents.view(await agents.getNegotiation(sql, f.host, f.room.id), f.now).state, "expired");
    await agents.consentToNegotiation(sql, f.host, f.room.id, false, f.now);
  });

  it("blocking and suspension remove access and account deletion erases agent data", async () => {
    const f = await pair(sql);
    await safety.blockMember(sql, f.host, f.member);
    await rejects(agents.getNegotiation(sql, f.host, f.room.id, true), 404);
    assert.equal((await agents.listNegotiations(sql, f.member, true)).length, 0);
    const s = await pair(sql);
    await sql`update profiles set suspended_at = now() where id = ${s.member}`;
    await rejects(agents.getNegotiation(sql, s.host, s.room.id, true), 404);
    assert.equal(await agents.authenticateDelegate(sql, s.memberGrant.token, s.now), null);
    const d = await pair(sql);
    await safety.deleteAccount(sql, d.host);
    assert.equal((await sql`select id from agent_delegations where profile_id = ${d.host}`).length, 0);
    assert.equal((await sql`select id from agent_negotiations where id = ${d.room.id}`).length, 0);
    assert.equal((await sql`select sequence from agent_negotiation_events where negotiation_id = ${d.room.id}`).length, 0);
  });

  it("CancelTask closes only the negotiation and is idempotent", async () => {
    const f = await pair(sql);
    const client = await sdkClient(sql, f.memberGrant.token, f.now);
    for (let i = 0; i < 2; i++) {
      const r = await client.cancelTask(CancelTaskRequest.fromJSON({ id: f.room.id }));
      assert.equal(r.status?.state, TaskState.TASK_STATE_CANCELED);
    }
    assert.equal((await pace.getBooking(sql, f.host, f.booking.id)).status, "completed");
  });
});
