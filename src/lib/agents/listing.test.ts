/** A2A listing must paginate the full eligible collection and expose expiry. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import { GetTaskRequest, ListTasksRequest, TaskState } from "@a2a-js/sdk";
import type { Sql } from "../db.ts";
import * as agents from "./service.server.ts";
import { PaceError } from "../pace/service.server.ts";
import { makeDb, pair, sdkClient, HOUR } from "./test-helpers.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});

describe("A2A collection limits", () => {
  it("paginates beyond 100 and applies context/status filters before the page limit", async () => {
    const f = await pair(sql);
    // A closed historical room may share a booking; only open rooms are unique.
    const ids = Array.from({ length: 105 }, () => randomUUID());
    await sql.query(
      `insert into agent_negotiations
      (id, booking_id, host_id, participant_id, host_consented, participant_consented,
       state, expires_at, updated_at)
      select id, $2, $3, $4, true, true, 'cancelled', $5, $6 from unnest($1::text[]) id`,
      [
        ids,
        f.booking.id,
        f.host,
        f.member,
        new Date(f.now + HOUR).toISOString(),
        new Date(f.now + 1).toISOString(),
      ],
    );
    const client = await sdkClient(sql, f.hostGrant.token, f.now);
    const first = await client.listTasks(
      ListTasksRequest.fromJSON({ pageSize: 100, historyLength: 0 }),
    );
    assert.equal(first.totalSize, 106);
    assert.equal(first.tasks.length, 100);
    assert.equal(first.nextPageToken, "100");
    const second = await client.listTasks(
      ListTasksRequest.fromJSON({
        pageSize: 100,
        pageToken: first.nextPageToken,
        historyLength: 0,
      }),
    );
    assert.equal(second.totalSize, 106);
    assert.equal(second.tasks.length, 6);
    assert.equal(second.nextPageToken, "");
    assert.equal(new Set([...first.tasks, ...second.tasks].map((task) => task.id)).size, 106);
    const filtered = await client.listTasks(
      ListTasksRequest.fromJSON({
        contextId: f.room.id,
        status: "TASK_STATE_INPUT_REQUIRED",
        pageSize: 1,
        historyLength: 0,
      }),
    );
    assert.equal(filtered.totalSize, 1);
    assert.equal(
      filtered.tasks[0].id,
      f.room.id,
      "oldest matching room survives context/status filtering",
    );
    assert.equal(
      (await agents.listNegotiations(sql, f.host)).length,
      100,
      "human activity cap stays bounded",
    );
    const pastEnd = await client.listTasks(
      ListTasksRequest.fromJSON({ pageToken: "106", historyLength: 0 }),
    );
    assert.equal(pastEnd.tasks.length, 0);
    assert.equal(pastEnd.totalSize, 106, "empty pages retain the actual collection count");
  });

  it("filters unconsented and ineligible relationships out of totals before paging", async () => {
    const f = await pair(sql);
    const other = await pair(sql);
    const roomIds = Array.from({ length: 4 }, () => randomUUID());
    const add = async (roomId: string, member: string, consent: boolean) => sql`
      insert into agent_negotiations
        (id, booking_id, host_id, participant_id, host_consented, participant_consented,
          state, expires_at)
      values (${roomId}, ${f.booking.id}, ${f.host}, ${member}, true, ${consent},
        'cancelled', ${new Date(f.now + HOUR).toISOString()})`;
    await add(roomIds[0], f.member, false);
    await add(roomIds[1], other.host, true);
    await add(roomIds[2], other.member, true);
    await add(roomIds[3], other.member, true);
    await sql`insert into blocks (blocker_id, blocked_id) values (${other.host}, ${f.host})`;
    await sql`update profiles set suspended_at = now() where id = ${other.member}`;
    const client = await sdkClient(sql, f.hostGrant.token, f.now);
    const listed = await client.listTasks(
      ListTasksRequest.fromJSON({ pageSize: 1, historyLength: 0 }),
    );
    assert.equal(listed.totalSize, 1);
    assert.deepEqual(
      listed.tasks.map((task) => task.id),
      [f.room.id],
    );
    assert.equal(listed.nextPageToken, "");
    await sql`update profiles set suspended_at = null, deleted_at = now() where id = ${other.member}`;
    assert.equal((await client.listTasks(ListTasksRequest.fromJSON({}))).totalSize, 1);
  });

  it("uses the expiration time for state timestamps, incremental filters and ordering", async () => {
    const f = await pair(sql);
    const expiry = f.now - 1_000;
    await sql`update agent_negotiations set expires_at = ${new Date(expiry).toISOString()},
      updated_at = ${new Date(f.now - HOUR).toISOString()} where id = ${f.room.id}`;
    const oldCancelled = randomUUID();
    await sql`insert into agent_negotiations
      (id, booking_id, host_id, participant_id, host_consented, participant_consented,
       state, expires_at, updated_at)
      values (${oldCancelled}, ${f.booking.id}, ${f.host}, ${f.member}, true, true,
        'cancelled', ${new Date(f.now + HOUR).toISOString()}, ${new Date(f.now - 2_000).toISOString()})`;
    const client = await sdkClient(sql, f.hostGrant.token, f.now);
    const expired = await client.getTask(
      GetTaskRequest.fromJSON({ id: f.room.id, historyLength: 0 }),
    );
    assert.equal(expired.status?.state, TaskState.TASK_STATE_CANCELED);
    assert.equal(expired.status?.timestamp, new Date(expiry).toISOString());
    const fresh = await client.listTasks(
      ListTasksRequest.fromJSON({
        status: "TASK_STATE_CANCELED",
        statusTimestampAfter: new Date(f.now - 1_500).toISOString(),
        historyLength: 0,
      }),
    );
    assert.equal(fresh.totalSize, 1);
    assert.equal(fresh.tasks[0].id, f.room.id);
    const all = await client.listTasks(ListTasksRequest.fromJSON({ historyLength: 0 }));
    assert.deepEqual(
      all.tasks.map((task) => task.id),
      [f.room.id, oldCancelled],
    );
  });

  it("enforces the 20-room quota for either member, including incoming conversations", async () => {
    const f = await pair(sql);
    const other = await pair(sql);
    // Free this booking's open-room slot, then fill only the other member's
    // quota with separate synthetic completed bookings. The caller has none.
    await agents.cancelNegotiation(sql, f.host, f.room.id, false, f.now);
    for (let i = 0; i < 20; i += 1) {
      const bookingId = `quota_${randomUUID()}`;
      const sessionId = `quota_session_${randomUUID()}`;
      await sql`insert into sessions (id, host_id, venue_id, activity, title, ability,
        start_at, duration_min, capacity, visibility, join_mode, status, code)
        select ${sessionId}, host_id, venue_id, activity, title, ability,
          start_at, duration_min, capacity, visibility, join_mode, 'completed', code
        from sessions where id = ${other.session.id}`;
      await sql`insert into bookings (id, session_id, participant_id, status)
        values (${bookingId}, ${sessionId}, ${f.member}, 'completed')`;
      await sql`insert into agent_negotiations
        (id, booking_id, host_id, participant_id, host_consented, participant_consented, expires_at)
        values (${randomUUID()}, ${bookingId}, ${other.host}, ${f.member}, true, true,
          ${new Date(f.now + HOUR).toISOString()})`;
    }
    await assert.rejects(
      agents.createNegotiation(sql, f.host, f.booking.id, f.now),
      (err: unknown) => err instanceof PaceError && err.status === 409,
    );
    const [{ n }] = await sql<{ n: number }>`select count(*) as n from agent_negotiations
      where participant_id = ${f.member} and state = 'open'`;
    assert.equal(Number(n), 20);
  });
});
