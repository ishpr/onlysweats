import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { bookSeat, PaceError } from "../pace/service.server.ts";
import { blockMember, deleteAccount } from "../pace/safety.server.ts";
import { FitnessError } from "../fitness/contracts.ts";
import * as plans from "./service.server.ts";
import { postgresTestDatabase, wrap } from "./postgres-test-db.ts";
import {
  fixtureMember,
  fixturePlan,
  fixtureSession,
  completedSet,
  runTime,
  testNow as now,
} from "./fixtures.ts";
const url = process.env.SAMEPACE_TEST_DATABASE_URL;
function latch<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function within<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out during a database race test.")),
          12000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
function holdProfileLock(sql: Sql) {
  let armed = true;
  const locked = latch<number>(),
    resume = latch();
  return {
    sql: wrap(sql.query, (fn) =>
      sql.transaction(async (tx) => {
        const observed: Sql = wrap(
          async <T>(text: string, values?: unknown[]) => {
            const rows = await tx.query<T>(text, values);
            if (armed && /select.+from profiles[\s\S]+for (?:no key )?update/i.test(text)) {
              armed = false;
              const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
              locked.release(pid);
              await resume.promise;
            }
            return rows;
          },
          (nested) => nested(observed),
        );
        return fn(observed);
      }),
    ),
    locked: locked.promise,
    resume: () => resume.release(),
  };
}
async function blocked(sql: Sql, pid: number) {
  const deadline = Date.now() + 10000;
  do {
    const [{ waiting }] = await sql<{
      waiting: string;
    }>`select count(*)::text waiting from pg_stat_activity
      where application_name = current_setting('application_name') and ${pid} = any(pg_blocking_pids(pid))`;
    if (Number(waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail("Competing operation must actually wait on a PostgreSQL profile lock.");
}
function rejected(result: PromiseSettledResult<unknown>, status: number) {
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.ok(result.reason instanceof PaceError || result.reason instanceof FitnessError);
    assert.equal(result.reason.status, status);
  }
}

test(
  "real Postgres: shared workout plans serialize booking, privacy, revisions and deletion",
  { skip: !url, timeout: 180000 },
  async (t) => {
    const db = await postgresTestDatabase(url!),
      sql = db.sql;
    try {
      await t.test("two edits of one revision wait and only one commits", async () => {
        const user = await fixtureMember(sql),
          input = fixturePlan();
        const saved = await plans.createPlan(sql, user, input, now);
        const { id: _id, ...content } = input;
        const held = holdProfileLock(sql);
        const first = plans.updatePlan(
          held.sql,
          user,
          saved.id,
          { ...content, title: "First edit", expectedRevision: 1 },
          now + 1,
        );
        const firstSettled = Promise.allSettled([first]);
        let both: Promise<PromiseSettledResult<unknown>[]> | undefined;
        try {
          const pid = await within(held.locked);
          const second = plans.updatePlan(
            sql,
            user,
            saved.id,
            { ...content, title: "Stale edit", expectedRevision: 1 },
            now + 2,
          );
          both = Promise.allSettled([first, second]);
          await blocked(sql, pid);
          held.resume();
          const results = await within(both);
          assert.equal(results[0].status, "fulfilled");
          rejected(results[1], 409);
          assert.equal((await plans.getPlan(sql, user, saved.id)).title, "First edit");
        } finally {
          held.resume();
          await (both ?? firstSettled);
        }
      });
      for (const bookingFirst of [false, true])
        await t.test(
          `attachment versus booking: ${bookingFirst ? "booking" : "attachment"} commits first`,
          async () => {
            const host = await fixtureMember(sql),
              buddy = await fixtureMember(sql),
              plan = await plans.createPlan(sql, host, fixturePlan(), now);
            const session = await fixtureSession(sql, host),
              held = holdProfileLock(sql);
            const attach = (client: Sql) =>
              plans.attachSessionPlan(
                client,
                host,
                session.id,
                { planId: plan.id, expectedPlanRevision: 1 },
                now,
              );
            const book = (client: Sql) => bookSeat(client, buddy, session.id, {}, now);
            const first = bookingFirst ? book(held.sql) : attach(held.sql);
            const firstSettled = Promise.allSettled([first]);
            let both: Promise<PromiseSettledResult<unknown>[]> | undefined;
            try {
              const pid = await within(held.locked);
              const second = bookingFirst ? attach(sql) : book(sql);
              both = Promise.allSettled([first, second]);
              await blocked(sql, pid);
              held.resume();
              const results = await within(both);
              assert.equal(results[0].status, "fulfilled");
              if (bookingFirst) {
                // lockSession detected the roster changed while attachment waited.
                // Refreshing the same explicit request may now add the first plan.
                rejected(results[1], 409);
                await attach(sql);
              } else assert.equal(results[1].status, "fulfilled");
              const view = await plans.getSessionPlan(sql, buddy, session.id, now);
              assert.equal(view.plan?.planId, plan.id);
              assert.equal(view.canAttach, false);
            } finally {
              held.resume();
              await (both ?? firstSettled);
            }
          },
        );
      for (const replacementFirst of [false, true])
        await t.test(
          `reviewed start versus replacement: ${replacementFirst ? "replacement" : "start"} commits first`,
          async () => {
            const host = await fixtureMember(sql),
              plan = await plans.createPlan(sql, host, fixturePlan(), now);
            const replacement = await plans.createPlan(
              sql,
              host,
              { ...fixturePlan(), title: "Different prescription" },
              now,
            );
            const session = await fixtureSession(sql, host);
            await plans.attachSessionPlan(
              sql,
              host,
              session.id,
              { planId: plan.id, expectedPlanRevision: 1 },
              now,
            );
            const held = holdProfileLock(sql);
            const start = (client: Sql) =>
              plans.startRun(
                client,
                host,
                {
                  id: randomUUID(),
                  sessionId: session.id,
                  expectedPlanId: plan.id,
                  expectedPlanRevision: 1,
                },
                runTime,
              );
            const replace = (client: Sql) =>
              client.transaction(async (tx) => {
                await plans.removeSessionPlan(
                  tx,
                  host,
                  session.id,
                  { expectedPlanId: plan.id, expectedPlanRevision: 1 },
                  runTime,
                );
                return plans.attachSessionPlan(
                  tx,
                  host,
                  session.id,
                  { planId: replacement.id, expectedPlanRevision: 1 },
                  runTime,
                );
              });
            const first = replacementFirst ? replace(held.sql) : start(held.sql);
            const firstSettled = Promise.allSettled([first]);
            let both: Promise<PromiseSettledResult<unknown>[]> | undefined;
            try {
              const pid = await within(held.locked),
                second = replacementFirst ? start(sql) : replace(sql);
              both = Promise.allSettled([first, second]);
              await blocked(sql, pid);
              held.resume();
              const results = await within(both);
              assert.equal(results[0].status, "fulfilled");
              rejected(results[1], 409);
              const view = await plans.getSessionPlan(sql, host, session.id, runTime);
              assert.equal(view.plan?.planId, replacementFirst ? replacement.id : plan.id);
              assert.equal(view.myRun?.planId ?? null, replacementFirst ? null : plan.id);
            } finally {
              held.resume();
              await (both ?? firstSettled);
            }
          },
        );
      for (const blockFirst of [false, true])
        await t.test(
          `block versus accountability: ${blockFirst ? "block" : "sharing"} commits first`,
          async () => {
            const host = await fixtureMember(sql),
              buddy = await fixtureMember(sql),
              plan = await plans.createPlan(sql, host, fixturePlan(), now);
            const session = await fixtureSession(sql, host);
            await plans.attachSessionPlan(
              sql,
              host,
              session.id,
              { planId: plan.id, expectedPlanRevision: 1 },
              now,
            );
            await bookSeat(sql, buddy, session.id, {}, now);
            const run = await plans.startRun(
              sql,
              buddy,
              {
                id: randomUUID(),
                sessionId: session.id,
                expectedPlanId: plan.id,
                expectedPlanRevision: 1,
              },
              runTime,
            );
            const held = holdProfileLock(sql);
            const share = (client: Sql) =>
              plans.updateRun(
                client,
                buddy,
                run.id,
                {
                  expectedRevision: 1,
                  results: [completedSet(run)],
                  note: "Private",
                  shareAccountability: true,
                  finish: true,
                },
                runTime,
              );
            const block = (client: Sql) => blockMember(client, host, buddy, runTime);
            const first = blockFirst ? block(held.sql) : share(held.sql);
            const firstSettled = Promise.allSettled([first]);
            let both: Promise<PromiseSettledResult<unknown>[]> | undefined;
            try {
              const pid = await within(held.locked);
              const second = blockFirst ? share(sql) : block(sql);
              both = Promise.allSettled([first, second]);
              await blocked(sql, pid);
              held.resume();
              const results = await within(both);
              assert.equal(results[0].status, "fulfilled");
              if (blockFirst) rejected(results[1], 404);
              else assert.equal(results[1].status, "fulfilled");
              await assert.rejects(
                plans.getSessionPlan(sql, buddy, session.id),
                (e: unknown) => e instanceof PaceError && e.status === 404,
              );
              assert.equal((await plans.getRun(sql, buddy, run.id)).id, run.id);
            } finally {
              held.resume();
              await (both ?? firstSettled);
            }
          },
        );
      await t.test(
        "account deletion wins over a queued plan edit and cascades personal records",
        async () => {
          const user = await fixtureMember(sql),
            input = fixturePlan();
          const plan = await plans.createPlan(sql, user, input, now);
          await plans.startRun(
            sql,
            user,
            { id: randomUUID(), planId: plan.id, expectedPlanRevision: 1 },
            now,
          );
          const { id: _id, ...content } = input;
          const held = holdProfileLock(sql),
            first = deleteAccount(held.sql, user, now + 1);
          const firstSettled = Promise.allSettled([first]);
          let both: Promise<PromiseSettledResult<unknown>[]> | undefined;
          try {
            const pid = await within(held.locked);
            const second = plans.updatePlan(
              sql,
              user,
              plan.id,
              { ...content, expectedRevision: 1 },
              now + 2,
            );
            both = Promise.allSettled([first, second]);
            await blocked(sql, pid);
            held.resume();
            const results = await within(both);
            assert.equal(results[0].status, "fulfilled");
            rejected(results[1], 401);
            assert.equal(
              (await sql`select 1 from workout_plans where user_id = ${user}`).length,
              0,
            );
            assert.equal((await sql`select 1 from workout_runs where user_id = ${user}`).length, 0);
          } finally {
            held.resume();
            await (both ?? firstSettled);
          }
        },
      );
    } finally {
      await db.close();
    }
  },
);
