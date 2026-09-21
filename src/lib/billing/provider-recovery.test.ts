import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { ensureProfile } from "../pace/service.server.ts";
import * as billing from "./service.server.ts";
import { handleStripeWebhook, sweepBilling } from "./worker.server.ts";
import { FakeStripe, testConfig } from "./test-provider.ts";
import type { Account, Checkout } from "./store.server.ts";

/** Isolated synthetic provider and embedded database; no external provider calls. */
async function setup() {
  const sql = await makeDb();
  const provider = new FakeStripe();
  const now = Date.now();
  const id = randomUUID();
  const options = { provider, config: testConfig, now };
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Recovery fixture', ${`${id}@example.test`}, true)`;
  await ensureProfile(sql, { id, name: "Recovery fixture", email: `${id}@example.test` });
  await sql`update profiles set completed_count = 2 where id = ${id}`;
  return { sql, provider, now, id, options };
}

async function webhook(
  sql: Sql,
  options: Awaited<ReturnType<typeof setup>>["options"],
  id: string,
  type: string,
  object: Record<string, unknown>,
) {
  const raw = JSON.stringify({
    id,
    type,
    livemode: false,
    created: Math.floor(options.now / 1000),
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: testConfig.webhookSecret,
    timestamp: Math.floor(options.now / 1000),
  });
  assert.equal((await handleStripeWebhook(sql, raw, signature, options)).status, 200);
}

test("failed renewal survives an outage, stale delivery, and later paid recovery without another checkout", async () => {
  const { sql, provider, now, id, options } = await setup();
  const termsHash = (await billing.getBilling(sql, id, options)).membershipCheckout.termsHash;
  await billing.createMembershipCheckout(sql, id, { requestId: "membership", termsHash }, options);
  const [account] = await sql<Account>`select * from billing_accounts where profile_id = ${id}`;
  const [checkout] =
    await sql<Checkout>`select * from billing_checkouts where account_id = ${account.id}`;
  assert.ok(account.customer_id);
  assert.ok(checkout.session_id);
  provider.pay(checkout.session_id);
  const paid = {
    status: "active",
    subscriptionId: "sub_recovery",
    periodEnd: Math.floor(now / 1000) + 2 * 86400,
    cancelAtPeriodEnd: false,
    creditCents: 0,
  };
  provider.memberships.set(account.customer_id, paid);
  await sweepBilling(sql, now, 10, options);
  assert.equal((await billing.getBilling(sql, id, options)).membership.active, true);

  // The current provider state changes while retrieval is unavailable. Intake
  // must keep the event pending and must not renew the last-good timestamp.
  provider.memberships.set(account.customer_id, { ...paid, status: "past_due" });
  const actualMembership = provider.membership.bind(provider);
  let unavailable = true;
  provider.membership = async (...args) => {
    if (unavailable) throw new Error("Synthetic outage");
    return actualMembership(...args);
  };
  await webhook(sql, options, "evt_failed", "customer.subscription.updated", {
    id: "sub_recovery",
    customer: account.customer_id,
    status: "past_due",
  });
  const before = provider.creations;
  const outage = await sweepBilling(sql, now + 100, 10, options);
  assert.ok(outage.errors > 0);
  assert.equal(
    (
      await sql<{
        status: string;
      }>`select status from billing_webhook_events where id = 'evt_failed'`
    )[0].status,
    "pending",
  );
  const [stale] = await sql<Account>`select * from billing_accounts where id = ${account.id}`;
  assert.equal(stale.reconciled_at?.getTime(), now);

  // A stale success cannot hide the failed renewal when the worker recovers.
  unavailable = false;
  await webhook(sql, options, "evt_stale_active", "customer.subscription.updated", {
    id: "sub_recovery",
    customer: account.customer_id,
    status: "active",
  });
  await sweepBilling(sql, now + 200, 10, options);
  let summary = await billing.getBilling(sql, id, options);
  assert.equal(summary.membership.active, false);
  assert.equal(summary.membership.status, "past_due");
  assert.equal(summary.portalAvailable, true);
  assert.equal(summary.membershipCheckout.available, false);

  // Conversely, a late failure cannot undo a payment that has since recovered.
  provider.memberships.set(account.customer_id, paid);
  await webhook(sql, options, "evt_stale_failed", "customer.subscription.updated", {
    id: "sub_recovery",
    customer: account.customer_id,
    status: "past_due",
  });
  await sweepBilling(sql, now + 300, 10, options);
  summary = await billing.getBilling(sql, id, options);
  assert.equal(summary.membership.active, true);
  assert.equal(summary.membership.status, "active");
  assert.equal(
    (await sql`select id from billing_webhook_events where status = 'processed'`).length,
    3,
  );
  assert.equal(
    (await sql`select id from billing_webhook_events where status = 'pending'`).length,
    0,
  );
  assert.equal(provider.creations, before);
});

test("a lost pending-refund response is recovered by operation metadata without issuing a second refund", async () => {
  const { sql, provider, now, id, options } = await setup();
  const feeId = randomUUID();
  await sql`insert into ledger_events (id, profile_id, kind, amount_cents, status, chargeable_at)
    values (${feeId}, ${id}, 'no_show_fee', 1000, 'assessed', ${new Date(now - 1000).toISOString()})`;
  const termsHash = (await billing.getBilling(sql, id, options)).fees[0].termsHash;
  await billing.createFeeCheckout(sql, id, feeId, { requestId: "fee", termsHash }, options);
  const [op] = await sql<Checkout>`select * from billing_checkouts where ledger_id = ${feeId}`;
  assert.ok(op.session_id);
  provider.pay(op.session_id);
  await sweepBilling(sql, now, 10, options);
  await sql`update ledger_events set status = 'waived' where id = ${feeId}`;

  // Stripe accepts the refund, but its response is lost before its ID commits.
  provider.refundState = "pending";
  const actualRefund = provider.refund.bind(provider);
  let requests = 0;
  provider.refund = async (...args) => {
    const result = await actualRefund(...args);
    if (++requests === 1) throw new Error("Lost response after refund accepted");
    return result;
  };
  const outage = await sweepBilling(sql, now + 100, 10, options);
  assert.ok(outage.errors > 0);
  assert.equal(provider.refundCalls, 1);
  assert.equal(
    (await sql<Checkout>`select * from billing_checkouts where id = ${op.id}`)[0].refund_id,
    null,
  );

  await sweepBilling(sql, now + 200, 10, options);
  assert.equal(requests, 2);
  assert.equal(provider.refundCalls, 1);
  const [recovered] = await sql<Checkout>`select * from billing_checkouts where id = ${op.id}`;
  assert.ok(recovered.refund_id);
  assert.equal(recovered.status, "refund_pending");

  const refund = provider.refunds.get(`samepace-refund-${op.id}`);
  assert.ok(refund);
  refund.status = "succeeded";
  await sweepBilling(sql, now + 300, 10, options);
  assert.equal(requests, 2, "once its ID commits, recovery retrieves that refund directly");
  assert.equal(provider.refundCalls, 1);
  assert.equal((await billing.getBilling(sql, id, options)).fees[0].paymentStatus, "refunded");
});
