import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import * as pace from "../pace/service.server.ts";
import * as safety from "../pace/safety.server.ts";
import * as assistant from "./assistant.server.ts";
import * as agents from "./service.server.ts";
import * as coordination from "./coordination.server.ts";
import { makeDb, pair, proposal, HOUR } from "./test-helpers.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const rejects = (p: Promise<unknown>, status = 409) =>
  assert.rejects(p, (err: unknown) => err instanceof pace.PaceError && err.status === status);
const prefs = (now: number, venueIds = ["katy", "whiterock"]) => {
  const start = Math.ceil((now + 24 * HOUR) / 900_000) * 900_000;
  return {
    enabled: true,
    activity: "run" as const,
    ability: proposal(now).plan.ability,
    durationMin: 60,
    venueIds,
    approvedIntent: "A relaxed run together",
    availability: [
      { startAt: new Date(start).toISOString(), endAt: new Date(start + HOUR).toISOString() },
    ],
  };
};
async function ready() {
  const f = await pair(sql);
  const hp = await assistant.setPreferences(sql, f.host, prefs(f.now), f.now);
  const pp = await assistant.setPreferences(
    sql,
    f.member,
    prefs(f.now, ["whiterock", "katy"]),
    f.now,
  );
  for (const [user, p] of [
    [f.host, hp],
    [f.member, pp],
  ] as const)
    await coordination.setCoordinationPermission(
      sql,
      user,
      f.room.id,
      { enabled: true, preferenceRevision: p.revision, expectedRevision: 0 },
      f.now,
    );
  return f;
}
const request = (requestId = "start", expectedRevision = 0) => ({ requestId, expectedRevision });

describe("bounded assistant coordination", () => {
  it("requires separate versioned permission from both members and excludes strangers", async () => {
    const f = await pair(sql),
      stranger = await pair(sql);
    const p = await assistant.setPreferences(sql, f.host, prefs(f.now), f.now);
    await assistant.setPreferences(sql, f.member, prefs(f.now), f.now);
    await rejects(
      coordination.setCoordinationPermission(
        sql,
        stranger.host,
        f.room.id,
        { enabled: true, preferenceRevision: 1, expectedRevision: 0 },
        f.now,
      ),
      404,
    );
    await rejects(
      coordination.setCoordinationPermission(
        sql,
        f.host,
        f.room.id,
        { enabled: true, preferenceRevision: 2, expectedRevision: 0 },
        f.now,
      ),
    );
    await coordination.setCoordinationPermission(
      sql,
      f.host,
      f.room.id,
      { enabled: true, preferenceRevision: p.revision, expectedRevision: 0 },
      f.now,
    );
    await rejects(coordination.startCoordination(sql, f.host, f.room.id, request(), f.now));
    assert.equal(
      (await coordination.getCoordination(sql, f.member, f.room.id, f.now)).ready,
      false,
    );
    await assert.rejects(
      coordination.setCoordinationPermission(
        sql,
        f.member,
        f.room.id,
        { enabled: true, preferenceRevision: 1, expectedRevision: 0, healthAccess: true },
        f.now,
      ),
    );
    await assert.rejects(
      coordination.startCoordination(
        sql,
        f.host,
        f.room.id,
        { ...request(), maxSteps: 100 },
        f.now,
      ),
    );
  });

  it("negotiates a real counterproposal, hands off, and never confirms or books", async () => {
    const f = await ready();
    const before = await sql<{ n: number }>`select count(*) n from sessions`;
    const result = await coordination.startCoordination(sql, f.host, f.room.id, request(), f.now);
    assert.equal(result.latestRun?.status, "awaiting_review");
    assert.equal(result.latestRun?.stepsUsed, 3);
    assert.deepEqual(
      result.latestRun?.steps.map((step) => step.action),
      ["proposed", "counterproposed", "ready_for_review"],
    );
    assert.deepEqual(
      result.latestRun?.steps.map((step) => step.memberId),
      [f.host, f.member, f.host],
    );
    const room = await agents.getNegotiation(sql, f.host, f.room.id);
    assert.equal(
      room.plan?.venueId,
      "whiterock",
      "responding member wins an equally fair venue tie",
    );
    assert.equal(room.revision, 2);
    assert.deepEqual(room.confirmations, []);
    assert.deepEqual(room.booking_approvals, []);
    assert.equal(room.state, "open");
    assert.equal(room.result_booking_id, null);
    assert.equal((await sql<{ n: number }>`select count(*) n from sessions`)[0].n, before[0].n);
    const history = await assistant.getHistory(sql, f.host, f.room.id);
    assert.equal(history.filter((event) => event.kind === "proposal").length, 2);
    assert.ok(
      history
        .filter((event) => event.kind === "proposal")
        .every(
          (event) =>
            event.data.agentLabel === "SamePace assistant" && event.data.requiresHumanConfirmation,
        ),
    );
    const replay = await coordination.startCoordination(sql, f.host, f.room.id, request(), f.now);
    assert.equal(replay.latestRun?.id, result.latestRun?.id);
    assert.equal((await agents.getNegotiation(sql, f.host, f.room.id)).revision, 2);
    const [{ n }] = await sql<{ n: number }>`select count(*) n from notifications
      where dedupe_key like ${`agent-run:${result.latestRun!.id}:%:review`}`;
    assert.equal(Number(n), 2);
  });

  it("recovers committed steps and serializes concurrent starts/advances without extra proposals", async () => {
    const f = await ready();
    const starts = await Promise.all(
      Array.from({ length: 6 }, () =>
        coordination.enqueueCoordination(sql, f.host, f.room.id, request(), f.now),
      ),
    );
    assert.equal(new Set(starts).size, 1);
    await rejects(coordination.enqueueCoordination(sql, f.member, f.room.id, request(), f.now));
    await rejects(
      coordination.enqueueCoordination(sql, f.member, f.room.id, request("other"), f.now),
    );
    const first = await coordination.advanceCoordination(sql, starts[0], f.now);
    assert.equal(first?.stepsUsed, 1);
    await Promise.all(
      Array.from({ length: 6 }, () => coordination.advanceCoordination(sql, starts[0], f.now)),
    );
    const finished = await coordination.getCoordination(sql, f.host, f.room.id, f.now);
    assert.equal(finished.latestRun?.stepsUsed, 3);
    assert.equal(finished.latestRun?.status, "awaiting_review");
    assert.equal((await agents.getNegotiation(sql, f.host, f.room.id)).revision, 2);
    assert.deepEqual(await coordination.sweepCoordination(sql, f.now), {
      processed: 0,
      awaitingReview: 0,
      stopped: 0,
      errors: 0,
    });
  });

  it("stops at a fresh preference change without sharing health or inferred state", async () => {
    const f = await ready();
    const id = await coordination.enqueueCoordination(sql, f.host, f.room.id, request(), f.now);
    await coordination.advanceCoordination(sql, id, f.now);
    await assistant.setPreferences(sql, f.member, prefs(f.now), f.now + 1);
    const stopped = await coordination.advanceCoordination(sql, id, f.now + 2);
    assert.equal(stopped?.status, "cancelled");
    assert.match(stopped?.reason ?? "", /preferences or permission changed/i);
    assert.equal((await agents.getNegotiation(sql, f.host, f.room.id)).revision, 1);
    const stale = await ready();
    await sql`update agent_preferences set updated_at = ${new Date(stale.now - 8 * 24 * HOUR).toISOString()}
      where profile_id = ${stale.member}`;
    await rejects(
      coordination.enqueueCoordination(sql, stale.host, stale.room.id, request(), stale.now),
    );
    const view = await coordination.getCoordination(sql, stale.host, stale.room.id, stale.now);
    assert.equal(view.permissions.find((p) => p.memberId === stale.member)?.valid, false);
  });

  it("revocation cancels an active run and is still available after blocking/suspension", async () => {
    const f = await ready();
    const id = await coordination.enqueueCoordination(sql, f.host, f.room.id, request(), f.now);
    await coordination.advanceCoordination(sql, id, f.now);
    await safety.blockMember(sql, f.host, f.member, f.now);
    await sql`update profiles set suspended_at = now() where id = ${f.member}`;
    const withdrawn = await coordination.setCoordinationPermission(
      sql,
      f.member,
      f.room.id,
      { enabled: false },
      f.now,
    );
    assert.equal(withdrawn.ready, false);
    assert.deepEqual(withdrawn.permissions, []);
    assert.equal((await coordination.advanceCoordination(sql, id, f.now))?.status, "cancelled");
    await rejects(coordination.getCoordination(sql, f.host, f.room.id, f.now), 404);
    const other = await ready();
    const queued = await coordination.enqueueCoordination(
      sql,
      other.host,
      other.room.id,
      request(),
      other.now,
    );
    await agents.consentToNegotiation(sql, other.member, other.room.id, false, other.now);
    assert.equal(
      (await coordination.advanceCoordination(sql, queued, other.now))?.status,
      "cancelled",
    );
  });

  it("a human counteroffer or approval stops automatic changes", async () => {
    for (const action of ["counter", "confirm"] as const) {
      const f = await ready();
      const id = await coordination.enqueueCoordination(sql, f.host, f.room.id, request(), f.now);
      await coordination.advanceCoordination(sql, id, f.now);
      if (action === "counter")
        await agents.proposeForMember(
          sql,
          f.member,
          f.room.id,
          {
            messageId: "human",
            expectedRevision: 1,
            plan: { ...proposal(f.now).plan, title: "My own plan" },
          },
          f.now,
        );
      else await agents.confirmProposal(sql, f.member, f.room.id, 1, f.now);
      const prior = await agents.getNegotiation(sql, f.host, f.room.id);
      assert.equal((await coordination.advanceCoordination(sql, id, f.now))?.status, "cancelled");
      const after = await agents.getNegotiation(sql, f.host, f.room.id);
      assert.deepEqual(after.plan, prior.plan);
      assert.deepEqual(after.confirmations, prior.confirmations);
      assert.equal(after.revision, prior.revision);
    }
  });

  it("enforces deadline, permission expiry, step budget and bounded no-match retries", async () => {
    const f = await ready();
    const id = await coordination.enqueueCoordination(sql, f.host, f.room.id, request(), f.now);
    const expired = await coordination.advanceCoordination(sql, id, f.now + 11 * 60_000);
    assert.equal(expired?.status, "expired");
    assert.equal(expired?.stepsUsed, 0);
    await rejects(
      coordination.enqueueCoordination(sql, f.host, f.room.id, request("later"), f.now + 25 * HOUR),
    );
    const bounded = await ready();
    const budget = await coordination.enqueueCoordination(
      sql,
      bounded.host,
      bounded.room.id,
      request(),
      bounded.now,
    );
    await sql`update agent_coordination_runs set max_steps = 1 where id = ${budget}`;
    await coordination.advanceCoordination(sql, budget, bounded.now);
    assert.equal(
      (await coordination.advanceCoordination(sql, budget, bounded.now))?.status,
      "no_match",
    );
    assert.equal((await agents.getNegotiation(sql, bounded.host, bounded.room.id)).revision, 1);
    const none = await pair(sql);
    await assistant.setPreferences(sql, none.host, prefs(none.now, ["katy"]), none.now);
    await assistant.setPreferences(sql, none.member, prefs(none.now, ["trinity"]), none.now);
    for (const user of [none.host, none.member])
      await coordination.setCoordinationPermission(
        sql,
        user,
        none.room.id,
        { enabled: true, preferenceRevision: 1, expectedRevision: 0 },
        none.now,
      );
    for (let i = 0; i < 4; i++)
      assert.equal(
        (
          await coordination.startCoordination(
            sql,
            none.host,
            none.room.id,
            request(`none-${i}`),
            none.now + i,
          )
        ).latestRun?.status,
        "no_match",
      );
    await rejects(
      coordination.startCoordination(sql, none.host, none.room.id, request("fifth"), none.now + 5),
    );
    assert.equal((await agents.getNegotiation(sql, none.host, none.room.id)).revision, 0);
  });

  it("rechecks real schedule changes between agent turns and never books a stale option", async () => {
    const f = await ready();
    const id = await coordination.enqueueCoordination(sql, f.host, f.room.id, request(), f.now);
    await coordination.advanceCoordination(sql, id, f.now);
    const room = await agents.getNegotiation(sql, f.host, f.room.id);
    await pace.postSession(
      sql,
      f.host,
      {
        ...room.plan!,
        detail: "",
        abilityFlex: "strict",
        visibility: "public",
        capacity: 2,
        joinMode: "instant",
        womenOnly: false,
      },
      f.now,
    );
    assert.equal((await coordination.advanceCoordination(sql, id, f.now))?.status, "no_match");
    assert.equal((await agents.getNegotiation(sql, f.host, f.room.id)).result_booking_id, null);
  });
});
