import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import type { Sql } from "../db.ts";
import { pair, proposal, HOUR } from "./test-helpers.ts";
import * as assistant from "./assistant.server.ts";
import * as agents from "./service.server.ts";
import * as coordination from "./coordination.server.ts";

type Query = <T>(q: string, p?: unknown[]) => Promise<T[]>;
function wrap(query: Query, transaction: Sql["transaction"]): Sql {
  const sql = (async (s: TemplateStringsArray, ...p: unknown[]) => {
    let q = s[0];
    for (let i = 0; i < p.length; i++) q += `$${i + 1}${s[i + 1]}`;
    return query(q, p);
  }) as Sql;
  sql.query = query;
  sql.transaction = transaction;
  return sql;
}
const url = process.env.SAMEPACE_TEST_DATABASE_URL;
test(
  "real Postgres coordinator: concurrent workers, withdrawal ordering, and atomic recovery",
  { skip: !url, timeout: 30_000 },
  async () => {
    const parsed = new URL(url!);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
      "Disposable local database only.",
    );
    const schema = `coordination_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    parsed.searchParams.set("options", `-c search_path=${schema}`);
    const pool = new pg.Pool({ connectionString: parsed.toString(), max: 8 });
    const sql: Sql = wrap(
      async <T>(q: string, p?: unknown[]) => (await pool.query(q, p)).rows as T[],
      async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("begin");
          const tx: Sql = wrap(
            async <T>(q: string, p?: unknown[]) => (await c.query(q, p)).rows as T[],
            (nested) => nested(tx),
          );
          const result = await fn(tx);
          await c.query("commit");
          return result;
        } catch (err) {
          await c.query("rollback");
          throw err;
        } finally {
          c.release();
        }
      },
    );
    async function ready() {
      const f = await pair(sql);
      const start = Math.ceil((f.now + 24 * HOUR) / 900_000) * 900_000;
      for (const member of [f.host, f.member]) {
        await assistant.setPreferences(
          sql,
          member,
          {
            enabled: true,
            activity: "run",
            ability: proposal(f.now).plan.ability,
            durationMin: 60,
            venueIds: member === f.host ? ["katy", "whiterock"] : ["whiterock", "katy"],
            approvedIntent: "Easy run",
            availability: [
              {
                startAt: new Date(start).toISOString(),
                endAt: new Date(start + HOUR).toISOString(),
              },
            ],
          },
          f.now,
        );
        await coordination.setCoordinationPermission(
          sql,
          member,
          f.room.id,
          { enabled: true, preferenceRevision: 1, expectedRevision: 0 },
          f.now,
        );
      }
      return f;
    }
    try {
      const dir = new URL("../../../migrations/", import.meta.url);
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort())
        await pool.query(await readFile(new URL(file, dir), "utf8"));
      const f = await ready();
      const ids = await Promise.all(
        Array.from({ length: 8 }, () =>
          coordination.enqueueCoordination(
            sql,
            f.host,
            f.room.id,
            { requestId: "same", expectedRevision: 0 },
            f.now,
          ),
        ),
      );
      assert.equal(new Set(ids).size, 1);
      await Promise.all(
        Array.from({ length: 8 }, () => coordination.advanceCoordination(sql, ids[0], f.now)),
      );
      const result = await coordination.getCoordination(sql, f.host, f.room.id, f.now);
      assert.equal(result.latestRun?.status, "awaiting_review");
      assert.equal(result.latestRun?.stepsUsed, 3);
      assert.equal((await agents.getNegotiation(sql, f.host, f.room.id)).revision, 2);
      assert.equal(
        (await assistant.getHistory(sql, f.host, f.room.id)).filter((e) => e.kind === "proposal")
          .length,
        2,
      );

      const withdrawing = await ready();
      const stoppedId = await coordination.enqueueCoordination(
        sql,
        withdrawing.host,
        withdrawing.room.id,
        { requestId: "stop", expectedRevision: 0 },
        withdrawing.now,
      );
      let locked!: (pid: number) => void;
      const held = new Promise<number>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const withdrawal = sql.transaction(async (tx) => {
        await tx`select id from agent_negotiations where id = ${withdrawing.room.id} for update`;
        const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
        locked(pid);
        await gate;
        return coordination.setCoordinationPermission(
          tx,
          withdrawing.member,
          withdrawing.room.id,
          { enabled: false },
          withdrawing.now,
        );
      });
      const pid = await held;
      const pending = coordination.advanceCoordination(sql, stoppedId, withdrawing.now);
      let blocked = false;
      try {
        const until = Date.now() + 5000;
        while (Date.now() < until) {
          const [row] = await sql.query<{ blocked: boolean }>(
            "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) blocked",
            [pid],
          );
          if (row.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
      }
      const [, stopped] = await Promise.all([withdrawal, pending]);
      assert.equal(blocked, true, "worker actually waited on the revocation transaction");
      assert.equal(stopped?.status, "cancelled");
      assert.equal(
        (await agents.getNegotiation(sql, withdrawing.host, withdrawing.room.id)).revision,
        0,
      );

      const crashed = await ready();
      const recoveryId = await coordination.enqueueCoordination(
        sql,
        crashed.host,
        crashed.room.id,
        { requestId: "recover", expectedRevision: 0 },
        crashed.now,
      );
      const broken = wrap(sql.query, (fn) =>
        sql.transaction(async (tx) => {
          const observed: Sql = wrap(
            async <T>(q: string, p?: unknown[]) => {
              assert.doesNotMatch(
                q,
                /\bhealth_(?:workouts|daily_summaries|samples)\b/i,
                "coordination never reads health facts",
              );
              if (/update agent_coordination_runs set status/i.test(q))
                throw new Error("simulated connection loss before step commit");
              return tx.query<T>(q, p);
            },
            (nested) => nested(observed),
          );
          return fn(observed);
        }),
      );
      await assert.rejects(
        coordination.advanceCoordination(broken, recoveryId, crashed.now),
        /simulated connection loss/,
      );
      assert.equal(
        (await agents.getNegotiation(sql, crashed.host, crashed.room.id)).revision,
        0,
        "proposal and run progress roll back together",
      );
      const recovered = await coordination.sweepCoordination(sql, crashed.now);
      assert.equal(recovered.awaitingReview, 1);
      assert.equal(
        (await coordination.getCoordination(sql, crashed.host, crashed.room.id, crashed.now))
          .latestRun?.stepsUsed,
        3,
      );
      assert.equal(
        (await assistant.getHistory(sql, crashed.host, crashed.room.id)).filter(
          (e) => e.kind === "proposal",
        ).length,
        2,
      );
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  },
);
