import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { FitnessError } from "../fitness/contracts.ts";
import { PaceError } from "../pace/service.server.ts";
import * as plans from "./service.server.ts";
import { updateRunInput } from "./contracts.ts";
import { completedSet, fixtureMember, fixturePlan, runTime, testNow } from "./fixtures.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (error: unknown) =>
      (error instanceof PaceError || error instanceof FitnessError) && error.status === status,
  );
async function setup() {
  const user = await fixtureMember(sql);
  const plan = await plans.createPlan(sql, user, fixturePlan(), testNow);
  const run = await plans.startRun(
    sql,
    user,
    {
      id: randomUUID(),
      planId: plan.id,
      expectedPlanRevision: plan.revision,
    },
    runTime,
  );
  const input = {
    mutationId: randomUUID(),
    expectedRevision: run.revision,
    results: [completedSet(run)],
    note: "Actual entry saved while offline",
    shareAccountability: false,
    finish: true,
  };
  return { user, run, input };
}
describe("offline workout retry receipts", () => {
  it("acknowledges a lost response without a second write or changed finish time", async () => {
    const { user, run, input } = await setup();
    const first = await plans.updateRun(sql, user, run.id, input, runTime + 1000);
    const replay = await plans.updateRun(sql, user, run.id, input, runTime + 60000);
    assert.deepEqual(replay, first);
    assert.equal(replay.revision, 2);
    assert.equal(replay.results.length, 1);
    assert.equal("last_mutation_hash" in replay, false);
    assert.equal("last_mutation_id" in replay, false);
    const [row] =
      await sql`select last_mutation_id, last_mutation_hash from workout_runs where user_id = ${user} and id = ${run.id}`;
    assert.equal(row.last_mutation_id, input.mutationId);
    assert.match(String(row.last_mutation_hash), /^[0-9a-f]{64}$/);
  });
  it("rejects reused IDs with changed quantities, note, revision or finish", async () => {
    const { user, run, input } = await setup();
    const saved = await plans.updateRun(sql, user, run.id, input, runTime + 1000);
    for (const patch of [
      { results: [{ ...input.results[0], durationSeconds: 53 }] },
      { note: "A different operation" },
      { expectedRevision: 2 },
      { finish: false },
    ])
      await rejects(
        plans.updateRun(sql, user, run.id, { ...input, ...patch }, runTime + 2000),
        409,
      );
    assert.deepEqual(await plans.getRun(sql, user, run.id), saved);
  });
  it("requires review after another device writes, including an older client", async () => {
    for (const legacy of [false, true]) {
      const { user, run, input } = await setup();
      await plans.updateRun(sql, user, run.id, input, runTime + 1000);
      const second = await plans.updateRun(
        sql,
        user,
        run.id,
        {
          ...input,
          mutationId: legacy ? undefined : randomUUID(),
          expectedRevision: 2,
          note: "Correction from another device",
        },
        runTime + 2000,
      );
      await rejects(plans.updateRun(sql, user, run.id, input, runTime + 3000), 409);
      assert.deepEqual(await plans.getRun(sql, user, run.id), second);
    }
  });
  it("does not let a receipt bypass owner, suspension, deletion or result checks", async () => {
    const { user, run, input } = await setup();
    await rejects(
      plans.updateRun(
        sql,
        user,
        run.id,
        {
          ...input,
          results: [{ ...input.results[0], setId: randomUUID() }],
        },
        runTime + 1000,
      ),
      400,
    );
    await plans.updateRun(sql, user, run.id, input, runTime + 1000);
    const other = await fixtureMember(sql);
    await rejects(plans.updateRun(sql, other, run.id, input, runTime + 2000), 404);
    await sql`update profiles set suspended_at = now() where id = ${user}`;
    await rejects(plans.updateRun(sql, user, run.id, input, runTime + 2000), 403);
    await plans.deleteRun(sql, user, run.id);
    await rejects(plans.updateRun(sql, user, run.id, input, runTime + 2000), 404);
    assert.equal((await sql`select 1 from workout_runs where user_id = ${user}`).length, 0);
  });
  it("keeps old clients valid and rejects malformed mutation identifiers", async () => {
    const { input } = await setup();
    const { mutationId: _id, ...legacy } = input;
    assert.equal(updateRunInput.safeParse(legacy).success, true);
    for (const mutationId of [null, "", "invalid", 42])
      assert.equal(updateRunInput.safeParse({ ...input, mutationId }).success, false);
  });
});
