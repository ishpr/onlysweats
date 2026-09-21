import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import type { Sql } from "../db.ts";
import { ensureProfile, PaceError } from "../pace/service.server.ts";
import * as billing from "./service.server.ts";
import { sweepBilling } from "./worker.server.ts";
import { FakeStripe, testConfig } from "./test-provider.ts";
import type { Account, Checkout } from "./store.server.ts";

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
  "real Postgres billing: checkout recovery, withdrawal ordering, refunds, and fresh invoice state",
  {
    skip: !url,
    timeout: 30_000,
  },
  async () => {
    const parsed = new URL(url!);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
      "Disposable local database only.",
    );
    const schema = `billing_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    parsed.searchParams.set("options", `-c search_path=${schema}`);
    const pool = new pg.Pool({ connectionString: parsed.toString(), max: 10 });
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
    const provider = new FakeStripe(),
      now = Date.now();
    const options = { provider, config: testConfig, now };
    async function heldProfile(userId: string, work: (tx: Sql) => Promise<void>) {
      let locked!: (pid: number) => void, release!: () => void;
      const acquired = new Promise<number>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const done = sql.transaction(async (tx) => {
        await tx`select id from profiles where id = ${userId} for no key update`;
        const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
        locked(pid);
        await gate;
        await work(tx);
      });
      return { pid: await acquired, release, done };
    }
    async function assertWaiting(pid: number) {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const [r] = await sql.query<{ blocked: boolean }>(
          "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) blocked",
          [pid],
        );
        if (r.blocked) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail("The competing billing transaction must actually wait for the profile lock.");
    }
    try {
      const dir = new URL("../../../migrations/", import.meta.url);
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort())
        await pool.query(await readFile(new URL(file, dir), "utf8"));
      const user = randomUUID(),
        feeId = randomUUID();
      await sql`insert into "user" (id, name, email, "emailVerified") values (${user}, 'Synthetic member', ${`${user}@example.test`}, true)`;
      await ensureProfile(sql, {
        id: user,
        name: "Synthetic member",
        email: `${user}@example.test`,
      });
      await sql`update profiles set completed_count = 2 where id = ${user}`;
      await sql`insert into ledger_events (id, profile_id, kind, amount_cents, status, chargeable_at)
      values (${feeId}, ${user}, 'no_show_fee', 1000, 'assessed', ${new Date(now - 1000).toISOString()})`;
      const termsHash = (await billing.getBilling(sql, user, options)).fees[0].termsHash;
      provider.loseCheckoutResponse = true;
      await assert.rejects(
        billing.createFeeCheckout(
          sql,
          user,
          feeId,
          { requestId: "lost-response", termsHash },
          options,
        ),
        /lost checkout/,
      );
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          billing.createFeeCheckout(
            sql,
            user,
            feeId,
            { requestId: `retry-${i}`, termsHash },
            options,
          ),
        ),
      );
      assert.equal(new Set(results.map((r) => r.url)).size, 1);
      assert.equal(provider.creations, 1);
      assert.equal(provider.customerCalls, 1);
      const [account] =
        await sql<Account>`select * from billing_accounts where profile_id = ${user}`;
      const ops =
        await sql<Checkout>`select * from billing_checkouts where account_id = ${account.id}`;
      assert.equal(
        ops.length,
        1,
        "different request IDs still share the one durable fee operation",
      );
      provider.pay(ops[0].session_id!);
      await sweepBilling(sql, now, 10, options);

      // A committed waiver wins the real row lock before an open-link retry. No
      // second charge is created, and competing workers return the paid fee once.
      const hold = await heldProfile(user, async (tx) => {
        await tx`update ledger_events set status = 'waived' where id = ${feeId}`;
      });
      const retry = billing.createFeeCheckout(
        sql,
        user,
        feeId,
        { requestId: "stale-fee", termsHash },
        options,
      );
      const rejected = assert.rejects(
        retry,
        (e: unknown) => e instanceof PaceError && e.status === 409,
      );
      try {
        await assertWaiting(hold.pid);
      } finally {
        hold.release();
      }
      await Promise.all([hold.done, rejected]);
      await Promise.all(Array.from({ length: 6 }, () => sweepBilling(sql, now + 1, 10, options)));
      assert.equal(provider.refundCalls, 1);
      assert.equal(provider.creations, 1);
      assert.equal(
        (await billing.getBilling(sql, user, options)).fees[0].paymentStatus,
        "refunded",
      );

      // Route an old invoice while blocked. Stripe changes to paid before the
      // account lock is acquired; only the state fetched inside that lock may persist.
      provider.invoices.set("in_race", {
        id: "in_race",
        customerId: account.customer_id!,
        status: "open",
        currency: "usd",
        amountDue: 1200,
        amountPaid: 0,
      });
      await sql`insert into billing_webhook_events (id, type, object_id, customer_id) values ('evt_invoice_race', 'invoice.updated', 'in_race', ${account.customer_id})`;
      const invoiceHold = await heldProfile(user, async () => {});
      const worker = sweepBilling(sql, now + 2, 10, options);
      try {
        await assertWaiting(invoiceHold.pid);
        provider.invoices.set("in_race", {
          id: "in_race",
          customerId: account.customer_id!,
          status: "paid",
          currency: "usd",
          amountDue: 1200,
          amountPaid: 1200,
        });
      } finally {
        invoiceHold.release();
      }
      await Promise.all([invoiceHold.done, worker]);
      const [invoice] = await sql<{
        status: string;
        amount_paid: number;
      }>`select status, amount_paid from billing_invoices where id = 'in_race'`;
      assert.deepEqual(invoice, { status: "paid", amount_paid: 1200 });
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  },
);
