/** Opt-in, disposable PostgreSQL acceptance. Every provider is mocked. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import type { Sql } from "../db.ts";
import * as pace from "../pace/service.server.ts";
import * as blocks from "../pace/training-blocks.server.ts";
import * as notify from "../pace/notify.server.ts";
import * as apple from "../auth/apple-revoke.server.ts";
import * as verification from "../pace/verification.server.ts";
import { clusterDate } from "../pace/rules.ts";

const url = process.env.SAMEPACE_TEST_DATABASE_URL;
const MIN = 60_000;
const DAY = 86400_000;
const RUN = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 } as const;
const POINT = { lat: 32.8019, lng: -96.8074 };
type Query = <T>(text: string, values?: unknown[]) => Promise<T[]>;
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
async function database(run: (sql: Sql) => Promise<void>) {
  const parsed = new URL(url!);
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
    "Disposable loopback PostgreSQL only.",
  );
  const schema = `jobs_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`create schema ${schema}`);
  parsed.searchParams.set(
    "options",
    `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000`,
  );
  const pool = new pg.Pool({ connectionString: parsed.toString(), max: 12 });
  const sql: Sql = wrap(
    async <T>(q: string, p?: unknown[]) => (await pool.query(q, p)).rows as T[],
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const tx: Sql = wrap(
          async <T>(q: string, p?: unknown[]) => (await client.query(q, p)).rows as T[],
          (nested) => nested(tx),
        );
        const value = await fn(tx);
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  );
  try {
    const dir = new URL("../../../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort())
      await pool.query(await readFile(new URL(file, dir), "utf8"));
    await run(sql);
  } finally {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
}
function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
/** Observe a real PostgreSQL lock wait, never assume launch order implies contention. */
async function contend(sql: Sql, lock: (tx: Sql) => Promise<unknown>, run: () => Promise<unknown>) {
  const held = gate<number>();
  const release = gate();
  const holder = sql.transaction(async (tx) => {
    await lock(tx);
    const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
    held.resolve(pid);
    await release.promise;
  });
  const pid = await held.promise;
  const work = run();
  let observed = false;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [{ blocked }] = await sql<{
        blocked: boolean;
      }>`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) blocked`;
      if (blocked) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release.resolve();
  }
  await Promise.all([holder, work]);
  assert.equal(observed, true, "workers actually contended on the held database row");
}
function failStatement(sql: Sql, pattern: RegExp): Sql {
  return wrap(sql.query, (fn) =>
    sql.transaction(async (tx) => {
      const injected: Sql = wrap(
        async <T>(q: string, p?: unknown[]) => {
          if (pattern.test(q)) throw new Error("synthetic interrupted transaction");
          return tx.query<T>(q, p);
        },
        (nested) => nested(injected),
      );
      return fn(injected);
    }),
  );
}
async function member(sql: Sql) {
  const id = randomUUID();
  await pace.ensureProfile(sql, { id, name: "Synthetic acceptance member", email: null });
  return id;
}
async function session(sql: Sql, host: string, start: number, capacity = 4) {
  return pace.postSession(
    sql,
    host,
    {
      venueId: "katy",
      activity: "run",
      title: "Synthetic concurrency workout",
      detail: "",
      ability: RUN,
      abilityFlex: "strict",
      startAt: new Date(start).toISOString(),
      durationMin: 40,
      capacity,
      visibility: "public",
      joinMode: "instant",
      womenOnly: false,
    },
    start - 2 * 3600_000,
  );
}
const options = { skip: !url, timeout: 45_000 };

test(
  "real Postgres jobs: concurrent settlement rolls back interruptions and charges a missing host once",
  options,
  async () =>
    database(async (sql) => {
      const start = Date.now() + 2 * 3600_000;
      const host = await member(sql);
      const members = await Promise.all(Array.from({ length: 3 }, () => member(sql)));
      const s = await session(sql, host, start);
      const bookings = [];
      for (const id of members) {
        const booking = await pace.bookSeat(sql, id, s.id, {}, start - 3600_000);
        await pace.checkInGeo(sql, id, booking.id, POINT, start);
        bookings.push(booking.id);
      }
      await assert.rejects(
        pace.settleDue(failStatement(sql, /insert into ledger_events/i), start + 26 * MIN),
        /synthetic interrupted/,
      );
      assert.equal(
        (await sql`select id from bookings where session_id = ${s.id} and status = 'confirmed'`)
          .length,
        3,
      );
      assert.equal((await sql`select id from ledger_events where session_id = ${s.id}`).length, 0);
      await contend(
        sql,
        (tx) => tx`select id from sessions where id = ${s.id} for update`,
        () => Promise.all(Array.from({ length: 8 }, () => pace.settleDue(sql, start + 26 * MIN))),
      );
      const [fee] = await sql<{
        n: string;
        cents: string;
      }>`select count(*) n, sum(amount_cents) cents from ledger_events where profile_id = ${host} and kind = 'no_show_fee'`;
      assert.equal(Number(fee.n), 1);
      assert.equal(Number(fee.cents), 1000);
      assert.equal((await sql`select id from strikes where profile_id = ${host}`).length, 1);
      assert.equal(
        (await sql`select id from bookings where session_id = ${s.id} and status = 'host_no_show'`)
          .length,
        3,
      );
      for (const id of members) {
        const [profile] = await sql<{
          credit_cents: number;
        }>`select credit_cents from profiles where id = ${id}`;
        assert.equal(profile.credit_cents, 500);
        assert.equal(
          (
            await sql`select id from ledger_events where profile_id = ${id} and kind = 'show_up_credit'`
          ).length,
          1,
        );
      }
      assert.equal(
        (await sql`select id from notifications where session_id = ${s.id} and kind = 'no_show'`)
          .length,
        1,
      );
      assert.equal(
        (await sql`select id from notifications where session_id = ${s.id} and kind = 'stood_up'`)
          .length,
        3,
      );
      await pace.settleDue(sql, start + 30 * MIN);
      assert.equal(
        (await sql`select id from ledger_events where booking_id = any(${bookings}::text[])`)
          .length,
        4,
      );
    }),
);

test(
  "real Postgres jobs: training occurrences and final member counters advance once under contention",
  options,
  async () =>
    database(async (sql) => {
      const start = Date.now() + 2 * 3600_000;
      const host = await member(sql);
      const joiner = await member(sql);
      const s = await session(sql, host, start, 2);
      const booking = await pace.bookSeat(sql, joiner, s.id, {}, start - 3600_000);
      await pace.checkInGeo(sql, host, booking.id, POINT, start);
      await pace.checkInGeo(sql, joiner, booking.id, POINT, start);
      const series = await pace.repeatWeekly(sql, host, booking.id, start + 3600_000);
      const block = await blocks.blockFromSeries(
        sql,
        host,
        series.id,
        { goalKind: "race_marathon", goalDate: clusterDate(start + 84 * DAY) },
        start + 3600_000,
      );
      const [next] = await sql<{
        id: string;
        start_at: Date;
      }>`select id, start_at from sessions where series_id = ${series.id} and status = 'open'`;
      const at = next.start_at.getTime();
      // Explicit synthetic arrivals let all workers compete on the same unsettled occurrence.
      await sql`update sessions set host_checked_in_at = ${new Date(at)} where id = ${next.id}`;
      await sql`update bookings set host_checked_in_at = ${new Date(at)}, participant_checked_in_at = ${new Date(at)} where session_id = ${next.id}`;
      await assert.rejects(
        pace.settleDue(failStatement(sql, /insert into sessions/i), at + 26 * MIN),
        /synthetic interrupted/,
      );
      assert.equal(
        (await sql`select id from bookings where session_id = ${next.id} and status = 'confirmed'`)
          .length,
        1,
      );
      await contend(
        sql,
        (tx) => tx`select id from series where id = ${series.id} for update`,
        () => Promise.all(Array.from({ length: 8 }, () => pace.settleDue(sql, at + 26 * MIN))),
      );
      const upcoming = await sql<{
        id: string;
      }>`select id from sessions where series_id = ${series.id} and status = 'open'`;
      assert.equal(upcoming.length, 1);
      assert.equal(
        (await sql`select id from bookings where session_id = ${upcoming[0].id}`).length,
        1,
      );
      const [standing] = await sql<{
        streak: number;
      }>`select streak from series where id = ${series.id}`;
      assert.equal(standing.streak, 1);
      assert.equal(
        (
          await sql`select id from notifications where session_id = ${upcoming[0].id} and kind = 'next_occurrence'`
        ).length,
        2,
      );
      // A synthetic externally cancelled future occurrence does not affect either member's completion.
      await sql`update sessions set status = 'cancelled', cancelled_by = null where id = ${upcoming[0].id}`;
      await sql`update bookings set status = 'cancelled' where session_id = ${upcoming[0].id}`;
      const closing = start + 85 * DAY;
      await assert.rejects(
        blocks.closeDueBlocks(failStatement(sql, /update profiles set blocks_finished/i), closing),
        /synthetic interrupted/,
      );
      const [unchanged] = await sql<{
        status: string;
      }>`select status from training_blocks where id = ${block.id}`;
      assert.equal(unchanged.status, "active");
      await contend(
        sql,
        (tx) => tx`select id from training_blocks where id = ${block.id} for update`,
        () => Promise.all(Array.from({ length: 8 }, () => blocks.closeDueBlocks(sql, closing))),
      );
      const members = await sql<{
        planned_count: number;
        kept_count: number;
        finished: boolean;
      }>`select planned_count, kept_count, finished from training_block_members where block_id = ${block.id}`;
      assert.equal(members.length, 2);
      assert.ok(members.every((m) => m.planned_count === 1 && m.kept_count === 1 && m.finished));
      const counts = await sql<{
        blocks_finished: number;
      }>`select blocks_finished from profiles where id = any(${[host, joiner]}::text[])`;
      assert.ok(counts.every((p) => p.blocks_finished === 1));
      await blocks.closeDueBlocks(sql, closing + 8 * DAY);
      assert.equal(
        (
          await sql<{ status: string }>`select status from training_blocks where id = ${block.id}`
        )[0].status,
        "ended",
      );
    }),
);

test(
  "real Postgres jobs: push claims are exclusive and stale receipt workers cannot disable recovered deliveries",
  options,
  async () =>
    database(async (sql) => {
      const now = Date.now();
      const id = await member(sql);
      // Never let inherited enhanced-security credentials enter the mocked transport.
      delete process.env.EXPO_ACCESS_TOKEN;
      for (const suffix of ["a", "b"])
        await notify.registerDevice(
          sql,
          id,
          { token: `ExponentPushToken[synthetic-${suffix}]`, platform: "ios" },
          now,
        );
      await Promise.all(
        Array.from({ length: 8 }, () =>
          notify.enqueue(
            sql,
            {
              profileId: id,
              kind: "synthetic",
              category: "sessions",
              title: "Synthetic",
              body: "Synthetic",
              dedupeKey: "same-synthetic-event",
            },
            now,
          ),
        ),
      );
      assert.equal((await sql`select id from notifications`).length, 1);
      const started = gate();
      const release = gate();
      let sendCalls = 0;
      const send = async (_url: string, init: RequestInit) => {
        sendCalls++;
        const messages = JSON.parse(String(init.body)) as Array<{ to: string }>;
        started.resolve();
        await release.promise;
        return Response.json({
          data: messages.map((m) => ({ status: "ok", id: `ticket-${m.to}` })),
        });
      };
      const delivering = notify.deliverDue(sql, { fetch: send, now });
      await started.promise;
      await Promise.all(
        Array.from({ length: 7 }, () =>
          notify.deliverDue(sql, {
            fetch: async () => {
              sendCalls++;
              return Response.json({ data: [] });
            },
            now,
          }),
        ),
      );
      release.resolve();
      await delivering;
      assert.equal(sendCalls, 1, "other workers do not resend a live claim");
      assert.equal(
        (await sql`select id from push_deliveries where state = 'ticket' and attempts = 1`).length,
        2,
      );
      const receiptStarted = gate();
      const oldReply = gate();
      let receiptCalls = 0;
      const stale = notify.checkReceipts(sql, {
        now: now + 15 * MIN,
        fetch: async (_url, init) => {
          receiptCalls++;
          receiptStarted.resolve();
          await oldReply.promise;
          const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
          return Response.json({
            data: Object.fromEntries(
              ids.map((ticket) => [
                ticket,
                { status: "error", details: { error: "DeviceNotRegistered" } },
              ]),
            ),
          });
        },
      });
      await receiptStarted.promise;
      await Promise.all(
        Array.from({ length: 7 }, () =>
          notify.checkReceipts(sql, {
            now: now + 15 * MIN,
            fetch: async () => {
              receiptCalls++;
              return Response.json({ data: {} });
            },
          }),
        ),
      );
      assert.equal(receiptCalls, 1, "receipt claim is exclusive until lease expiry");
      await notify.checkReceipts(sql, {
        now: now + 21 * MIN,
        fetch: async (_url, init) => {
          const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
          return Response.json({
            data: Object.fromEntries(ids.map((ticket) => [ticket, { status: "ok" }])),
          });
        },
      });
      oldReply.resolve();
      assert.equal(await stale, 0);
      assert.equal((await sql`select token from push_devices where disabled_at is null`).length, 2);
      assert.equal(
        (await sql`select id from push_deliveries where state = 'delivered' and attempts = 1`)
          .length,
        2,
      );
      assert.equal((await sql`select id from push_tickets`).length, 0);
      await notify.deliverDue(sql, {
        now: now + DAY,
        fetch: async () => assert.fail("delivered devices cannot replay"),
      });
    }),
);

test(
  "real Postgres jobs: Apple token handoff is idempotent and lease recovery cannot restore scrubbed credentials",
  options,
  async () =>
    database(async (sql) => {
      const now = Date.now();
      const id = await member(sql);
      const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
      Object.assign(process.env, {
        BETTER_AUTH_SECRET: "synthetic-test-only",
        APPLE_TEAM_ID: "SYNTHETIC1",
        APPLE_KEY_ID: "SYNTHETIC2",
        APPLE_BUNDLE_ID: "test.synthetic.samepace",
        APPLE_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      });
      await apple.storeAppleAuthorization(sql, id, "synthetic-code", {
        now,
        fetch: async () => Response.json({ refresh_token: "synthetic-refresh" }),
      });
      let calls = 0;
      await Promise.all(
        Array.from({ length: 8 }, () =>
          apple.revokeAppleAccess(sql, id, {
            now,
            fetch: async () => {
              calls++;
              return new Response(null, { status: 503 });
            },
          }),
        ),
      );
      assert.equal(calls, 1);
      assert.equal((await sql`select profile_id from apple_tokens`).length, 0);
      const [job] = await sql<{
        id: string;
        attempts: number;
      }>`select id, attempts from apple_revocation_jobs`;
      assert.equal(job.attempts, 1);
      const began = gate();
      const oldReply = gate();
      const stale = apple.retryAppleRevocations(sql, {
        now: now + 5 * MIN,
        fetch: async () => {
          calls++;
          began.resolve();
          await oldReply.promise;
          return new Response(null, { status: 503 });
        },
      });
      await began.promise;
      await Promise.all(
        Array.from({ length: 7 }, () =>
          apple.retryAppleRevocations(sql, {
            now: now + 5 * MIN,
            fetch: async () => {
              calls++;
              return new Response(null, { status: 503 });
            },
          }),
        ),
      );
      assert.equal(calls, 2, "a live revocation lease is never processed twice");
      const recovered = await apple.retryAppleRevocations(sql, {
        now: now + 11 * MIN,
        fetch: async () => {
          calls++;
          return new Response(null, { status: 200 });
        },
      });
      assert.equal(recovered.revoked, 1);
      oldReply.resolve();
      await stale;
      const [finished] = await sql<{
        state: string;
        refresh_token_enc: string | null;
        attempts: number;
      }>`select state, refresh_token_enc, attempts from apple_revocation_jobs where id = ${job.id}`;
      assert.deepEqual(finished, { state: "succeeded", refresh_token_enc: null, attempts: 3 });
      await apple.retryAppleRevocations(sql, {
        now: now + DAY,
        fetch: async () => assert.fail("scrubbed job cannot be replayed"),
      });
    }),
);

test(
  "real Postgres jobs: Persona deletion survives worker failure and ignores stale completion after recovery",
  options,
  async () =>
    database(async (sql) => {
      const now = Date.now();
      const ref = "inq_synthetic_only";
      const env = { PERSONA_API_KEY: "synthetic-no-network" };
      await sql`insert into persona_redaction_jobs (provider_ref, next_attempt_at) values (${ref}, ${new Date(now)})`;
      // Storage-only setup here models the durable deletion obligation after account removal.
      const began = gate();
      const oldReply = gate();
      let calls = 0;
      const stale = verification.retryPersonaRedactions(sql, now, {
        env,
        fetch: async () => {
          calls++;
          began.resolve();
          await oldReply.promise;
          throw new Error("synthetic offline worker");
        },
      });
      await began.promise;
      await Promise.all(
        Array.from({ length: 7 }, () =>
          verification.retryPersonaRedactions(sql, now, {
            env,
            fetch: async () => {
              calls++;
              return new Response(null, { status: 204 });
            },
          }),
        ),
      );
      assert.equal(calls, 1);
      const [processing] = await sql<{
        state: string;
        attempts: number;
      }>`select state, attempts from persona_redaction_jobs where provider_ref = ${ref}`;
      assert.deepEqual(processing, { state: "processing", attempts: 1 });
      const recovered = await verification.retryPersonaRedactions(sql, now + 61_000, {
        env,
        fetch: async () => {
          calls++;
          return new Response(null, { status: 204 });
        },
      });
      assert.equal(recovered.redacted, 1);
      oldReply.resolve();
      await stale;
      assert.equal((await sql`select provider_ref from persona_redaction_jobs`).length, 0);
      await verification.retryPersonaRedactions(sql, now + DAY, {
        env,
        fetch: async () => assert.fail("redacted inquiry cannot replay"),
      });
      const retryRef = "inq_synthetic_retry";
      await sql`insert into persona_redaction_jobs (provider_ref, next_attempt_at) values (${retryRef}, ${new Date(now)})`;
      await verification.retryPersonaRedactions(sql, now, {
        env,
        fetch: async () => {
          throw new Error("synthetic provider outage");
        },
      });
      const [failed] = await sql<{
        state: string;
        next_attempt_at: Date;
      }>`select state, next_attempt_at from persona_redaction_jobs where provider_ref = ${retryRef}`;
      assert.equal(failed.state, "failed");
      await verification.retryPersonaRedactions(sql, now + 1, {
        env,
        fetch: async () => assert.fail("failure backoff must be honored"),
      });
      await Promise.all(
        Array.from({ length: 8 }, () =>
          verification.retryPersonaRedactions(sql, failed.next_attempt_at.getTime(), {
            env,
            fetch: async () => {
              calls++;
              return new Response(null, { status: 404 });
            },
          }),
        ),
      );
      assert.equal(calls, 3, "already absent inquiry resolves exactly one recovery claim");
      assert.equal((await sql`select provider_ref from persona_redaction_jobs`).length, 0);
    }),
);
