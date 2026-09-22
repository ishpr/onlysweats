import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Sql } from "../db.ts";
import { postgresTestDatabase, wrap } from "../workout-plans/postgres-test-db.ts";
import {
  fixtureMember,
  fixturePlan,
  fixtureSession,
  completedSet,
} from "../workout-plans/fixtures.ts";
import * as pace from "../pace/service.server.ts";
import * as workouts from "../workout-plans/service.server.ts";
import {
  prepareAgentTool,
  lockAgentCommandProfiles,
  executeAgentCommand,
  type AgentCommand,
} from "./agent-tools.server.ts";

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function pauseAfterParticipants(sql: Sql) {
  const entered = latch(),
    resume = latch();
  let armed = true;
  const observed = wrap(sql.query, (fn) =>
    sql.transaction(async (tx) => {
      const inner: Sql = wrap(
        async <T>(text: string, args?: unknown[]) => {
          const rows = await tx.query<T>(text, args);
          if (armed && /union select m.profile_id as id from series_members/.test(text)) {
            armed = false;
            entered.release();
            await resume.promise;
          }
          return rows;
        },
        (nested) => nested(inner),
      );
      return fn(inner);
    }),
  );
  return { sql: observed, entered: entered.promise, resume: resume.release };
}
async function series(sql: Sql, host: string, sessionId: string, members: string[]) {
  const id = `ser_${randomUUID()}`;
  await sql`insert into series(id,created_by) values(${id},${host})`;
  await sql`update sessions set series_id=${id} where id=${sessionId}`;
  for (const member of members)
    await sql`insert into series_members(series_id,profile_id) values(${id},${member})`;
  return id;
}
test(
  "real Postgres: agent commands prelock the complete profile set before identity and domain execution",
  { skip: !process.env.SAMEPACE_TEST_DATABASE_URL, timeout: 60000 },
  async (t) => {
    const db = await postgresTestDatabase(process.env.SAMEPACE_TEST_DATABASE_URL!);
    const sql = db.sql,
      now = Date.now();
    try {
      await t.test(
        "shared workout set locks host, all booked participants and active series members",
        async () => {
          const host = await fixtureMember(sql),
            guest = await fixtureMember(sql),
            other = await fixtureMember(sql),
            regular = await fixtureMember(sql),
            left = await fixtureMember(sql);
          const session = await fixtureSession(sql, host, now),
            plan = await workouts.createPlan(sql, host, fixturePlan(), now);
          await workouts.attachSessionPlan(
            sql,
            host,
            session.id,
            { planId: plan.id, expectedPlanRevision: 1 },
            now,
          );
          await pace.bookSeat(sql, guest, session.id, {}, now);
          await pace.bookSeat(sql, other, session.id, {}, now);
          const seriesId = await series(sql, host, session.id, [host, guest, regular, left]);
          await sql`update series_members set left_at=${new Date(now)} where series_id=${seriesId} and profile_id=${left}`;
          const run = await workouts.startRun(
            sql,
            guest,
            {
              id: randomUUID(),
              sessionId: session.id,
              expectedPlanId: plan.id,
              expectedPlanRevision: 1,
            },
            now + 31 * 60000,
          );
          const command: AgentCommand = {
            kind: "log_set",
            runId: run.id,
            input: {
              expectedRevision: 1,
              mutationId: randomUUID(),
              results: [completedSet(run)],
              note: "",
              shareAccountability: true,
              finish: false,
            },
          };
          const held = latch(),
            resume = latch();
          const execute = sql.transaction(async (tx) => {
            await lockAgentCommandProfiles(tx, guest, command);
            held.release();
            await resume.promise;
            await tx`select id from "user" where id=${guest} for update`;
            return executeAgentCommand(tx, guest, command, undefined, now + 31 * 60000 + 1);
          });
          await held.promise;
          try {
            for (const id of [host, guest, other, regular])
              await assert.rejects(
                sql.transaction(
                  (tx) => tx`select id from profiles where id=${id} for no key update nowait`,
                ),
                /55P03/,
              );
            await sql.transaction(
              (tx) => tx`select id from profiles where id=${left} for no key update nowait`,
            );
          } finally {
            resume.release();
          }
          assert.equal((await execute).related?.targetId, run.id);
          assert.equal((await workouts.getRun(sql, guest, run.id)).results[0].durationSeconds, 52);
        },
      );
      for (const gain of ["booking", "series member"] as const)
        await t.test(
          `rejects gained ${gain} before acquiring identity or extending the ordered lock set`,
          async () => {
            const host = await fixtureMember(sql),
              guest = await fixtureMember(sql),
              newMember = await fixtureMember(sql);
            const session = await fixtureSession(sql, host, now),
              booking = await pace.bookSeat(sql, guest, session.id, {}, now);
            const seriesId =
              gain === "series member"
                ? await series(sql, host, session.id, [host, guest])
                : undefined;
            const { drafts } = await prepareAgentTool(
              sql,
              guest,
              "checkIn",
              { bookingId: booking.id },
              {
                now,
                timeZone: "UTC",
                readManualWorkouts: async () => ({ available: false }),
                readWorkoutSummaries: async () => ({ available: false }),
              },
            );
            const paused = pauseAfterParticipants(sql);
            let identityReached = false;
            const pending = paused.sql.transaction(async (tx) => {
              await lockAgentCommandProfiles(tx, guest, drafts[0].command);
              identityReached = true;
              await tx`select id from "user" where id=${guest} for update`;
            });
            const rejected = assert.rejects(
              pending,
              (e) => e instanceof pace.PaceError && e.status === 409,
            );
            await paused.entered;
            try {
              if (gain === "booking") await pace.bookSeat(sql, newMember, session.id, {}, now + 1);
              else
                await sql.transaction(async (tx) => {
                  await pace.lockSession(tx, session.id, [newMember]);
                  await tx`insert into series_members(series_id,profile_id) values(${seriesId!},${newMember})`;
                });
            } finally {
              paused.resume();
            }
            await rejected;
            assert.equal(identityReached, false);
            await sql.transaction(async (tx) => {
              await lockAgentCommandProfiles(tx, guest, drafts[0].command);
              await tx`select id from "user" where id=${guest} for update`;
            });
          },
        );
    } finally {
      await db.close();
    }
  },
);
