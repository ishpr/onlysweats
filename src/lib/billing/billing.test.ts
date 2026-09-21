import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { Sql } from "../db.ts";
import { ensureProfile, PaceError } from "../pace/service.server.ts";
import { makeDb } from "../pace/test-db.ts";
import * as service from "./service.server.ts";
import { handleStripeWebhook, sweepBilling } from "./worker.server.ts";
import { billingConfig, stripeUrl } from "./provider.server.ts";
import { FakeStripe, testConfig } from "./test-provider.ts";
import type { Account, Checkout } from "./store.server.ts";

let sql: Sql;
const provider = new FakeStripe();
const now = Date.now();
const options = { provider, config: testConfig, now };
before(async () => {
  sql = await makeDb();
});
async function member(completed = 2) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Synthetic member', ${`${id}@example.test`}, true)`;
  await ensureProfile(sql, { id, name: "Synthetic member", email: `${id}@example.test` });
  await sql`update profiles set completed_count = ${completed} where id = ${id}`;
  return id;
}
async function feeFor(
  userId: string,
  kind = "no_show_fee",
  status = "assessed",
  chargeable = now - 1000,
) {
  const id = randomUUID();
  await sql`insert into ledger_events (id, profile_id, kind, amount_cents, status, chargeable_at, created_at)
    values (${id}, ${userId}, ${kind}, ${kind === "no_show_fee" ? 1000 : 500}, ${status}, ${new Date(chargeable).toISOString()}, ${new Date(now - 86_400_000).toISOString()})`;
  return id;
}
async function feeCheckout(userId: string, feeId: string, requestId = randomUUID()) {
  const summary = await service.getBilling(sql, userId, options);
  return service.createFeeCheckout(
    sql,
    userId,
    feeId,
    { requestId, termsHash: summary.fees.find((f) => f.id === feeId)!.termsHash },
    options,
  );
}
async function checkoutFor(userId: string, feeId?: string) {
  const [a] = await sql<Account>`select * from billing_accounts where profile_id = ${userId}`;
  const [op] = await sql<Checkout>`select * from billing_checkouts where account_id = ${a.id}
    and (ledger_id = ${feeId ?? null} or (${feeId ?? null}::text is null and kind = 'membership')) order by created_at desc limit 1`;
  return { a, op };
}
const reject = (p: Promise<unknown>, status = 409) =>
  assert.rejects(p, (e: unknown) => e instanceof PaceError && e.status === status);
function event(id: string, type: string, object: Record<string, unknown>, livemode = false) {
  const raw = JSON.stringify({
    id,
    object: "event",
    type,
    livemode,
    created: Math.floor(now / 1000),
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: testConfig.webhookSecret,
    timestamp: Math.floor(now / 1000),
  });
  return { raw, signature };
}
async function sweep() {
  return sweepBilling(sql, now + 100, 20, options);
}

describe("hosted billing and fee support", () => {
  it("rejects signed malformed event data without a storage failure", async () => {
    for (const data of [null, {}, { object: null }, { object: "invalid" }]) {
      const raw = JSON.stringify({
        id: "evt_malformed",
        type: "invoice.paid",
        livemode: false,
        data,
      });
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload: raw,
        secret: testConfig.webhookSecret,
        timestamp: Math.floor(now / 1000),
      });
      assert.deepEqual(await handleStripeWebhook(sql, raw, signature, options), {
        status: 400,
        outcome: "invalid_event",
      });
    }
  });
  it("is disabled by default and requires cluster, free-session, exact-price, and server-term gates", async () => {
    assert.equal(billingConfig({}).enabled, false);
    const user = await member(1);
    const termsHash = (await service.getBilling(sql, user, options)).membershipCheckout.termsHash;
    const body = { requestId: "one", termsHash };
    const before = provider.creations;
    await reject(
      service.createMembershipCheckout(sql, user, body, {
        ...options,
        config: { ...testConfig, enabled: false },
      }),
    );
    await reject(
      service.createMembershipCheckout(sql, user, body, {
        ...options,
        config: { ...testConfig, clusterReady: false },
      }),
    );
    await reject(service.createMembershipCheckout(sql, user, body, options));
    await sql`update profiles set completed_count = 2 where id = ${user}`;
    provider.priceAmount = 1201;
    await reject(service.createMembershipCheckout(sql, user, body, options));
    provider.priceAmount = 1200;
    await reject(
      service.createMembershipCheckout(sql, user, { ...body, termsHash: "0".repeat(64) }, options),
    );
    await assert.rejects(
      service.createMembershipCheckout(
        sql,
        user,
        { ...body, amountCents: 1, returnUrl: "https://evil.test" },
        options,
      ),
    );
    assert.equal(provider.creations, before);
    assert.throws(() => stripeUrl("https://checkout.stripe.com.evil.test/pay", "checkout"));
    assert.throws(() => stripeUrl("https://name@billing.stripe.com/pay", "portal"));
  });

  it("resumes one membership checkout after lost response, concurrent taps and remount", async () => {
    const user = await member();
    const termsHash = (await service.getBilling(sql, user, options)).membershipCheckout.termsHash;
    const before = provider.creations;
    provider.loseCheckoutResponse = true;
    await assert.rejects(
      service.createMembershipCheckout(sql, user, { requestId: "lost", termsHash }, options),
      /lost checkout/,
    );
    const links = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        service.createMembershipCheckout(
          sql,
          user,
          { requestId: `remount-${i}`, termsHash },
          options,
        ),
      ),
    );
    assert.equal(new Set(links.map((l) => l.url)).size, 1);
    assert.equal(provider.creations, before + 1);
    const view = await service.getBilling(sql, user, options);
    assert.equal(view.membershipCheckout.available, true);
    assert.equal(view.membership.active, false, "a hosted URL/return is never proof of payment");
    const { a } = await checkoutFor(user);
    provider.memberships.set(a.customer_id!, {
      status: "past_due",
      subscriptionId: "sub_pastdue",
      periodEnd: Math.floor(now / 1000) + 86400,
      cancelAtPeriodEnd: false,
      creditCents: 0,
    });
    await sweep();
    const failed = await service.getBilling(sql, user, options);
    assert.equal(failed.membership.status, "past_due");
    assert.equal(failed.membership.active, false);
    assert.equal(failed.portalAvailable, true);
    await reject(
      service.createMembershipCheckout(sql, user, { requestId: "new-double", termsHash }, options),
    );
    assert.equal(
      (await service.createPortal(sql, user, { requestId: "manage" }, options)).url.startsWith(
        "https://billing.stripe.com/",
      ),
      true,
    );
  });

  it("uses signed IDs and current provider state for replayed/out-of-order subscription and invoice webhooks", async () => {
    const user = await member();
    const termsHash = (await service.getBilling(sql, user, options)).membershipCheckout.termsHash;
    await service.createMembershipCheckout(
      sql,
      user,
      { requestId: "subscribe", termsHash },
      options,
    );
    const { a } = await checkoutFor(user);
    const bad = event(
      "evt_badmode",
      "customer.subscription.updated",
      { id: "sub_1", customer: a.customer_id },
      true,
    );
    assert.equal((await handleStripeWebhook(sql, bad.raw, bad.signature, options)).status, 400);
    const old = event("evt_old", "customer.subscription.updated", {
      id: "sub_1",
      customer: a.customer_id,
      status: "active",
    });
    assert.equal((await handleStripeWebhook(sql, old.raw, "bad", options)).status, 400);
    assert.equal(
      (await handleStripeWebhook(sql, old.raw, old.signature, { ...options, now: now + 301_000 }))
        .status,
      400,
    );
    provider.memberships.set(a.customer_id!, {
      status: "canceled",
      subscriptionId: "sub_1",
      periodEnd: Math.floor(now / 1000) + 86400,
      cancelAtPeriodEnd: false,
      creditCents: 0,
    });
    await handleStripeWebhook(sql, old.raw, old.signature, options);
    await handleStripeWebhook(sql, old.raw, old.signature, options);
    await sweep();
    assert.equal(
      (await service.getBilling(sql, user, options)).membership.status,
      "canceled",
      "stale active snapshot cannot reactivate membership",
    );
    const [{ n }] = await sql<{
      n: number;
    }>`select count(*) n from billing_webhook_events where id = 'evt_old'`;
    assert.equal(Number(n), 1);
    const invoiceId = `in_${randomUUID().replaceAll("-", "")}`;
    provider.invoices.set(invoiceId, {
      id: invoiceId,
      customerId: a.customer_id!,
      status: "paid",
      currency: "usd",
      amountDue: 1200,
      amountPaid: 1200,
    });
    const failed = event("evt_invoice_old", "invoice.payment_failed", {
      id: invoiceId,
      customer: a.customer_id,
    });
    await handleStripeWebhook(sql, failed.raw, failed.signature, options);
    await sweep();
    assert.equal(
      (
        await sql<{ status: string }>`select status from billing_invoices where id = ${invoiceId}`
      )[0].status,
      "paid",
    );
  });

  it("fee payment is owner scoped, ledger priced, held during disputes, and resumes safely", async () => {
    const user = await member(),
      stranger = await member();
    const id = await feeFor(user),
      held = await feeFor(user, "late_cancel_fee", "assessed", now + 1000);
    const credit = await feeFor(user, "show_up_credit");
    const summary = await service.getBilling(sql, user, options);
    assert.equal(
      summary.fees.some((f) => f.id === credit),
      false,
    );
    await reject(
      service.createFeeCheckout(
        sql,
        stranger,
        id,
        { requestId: "steal", termsHash: summary.fees.find((f) => f.id === id)!.termsHash },
        options,
      ),
      404,
    );
    await reject(feeCheckout(user, held));
    const first = await feeCheckout(user, id);
    assert.equal(
      (await service.getBilling(sql, user, options)).fees.find((f) => f.id === id)?.canPay,
      true,
    );
    assert.equal((await feeCheckout(user, id)).url, first.url);
    const { op } = await checkoutFor(user, id);
    assert.equal(provider.sessions.get(op.session_id!)?.amountTotal, 1000);
    await service.disputeFee(
      sql,
      user,
      id,
      { reason: "I arrived at the correct meeting point." },
      options,
    );
    await reject(feeCheckout(user, id));
    await sweep();
    assert.equal(provider.sessions.get(op.session_id!)?.status, "expired");
  });

  it("a paid fee dispute waits for admin resolution; upheld payment is retained", async () => {
    const user = await member(),
      id = await feeFor(user);
    await feeCheckout(user, id);
    const { op } = await checkoutFor(user, id);
    provider.pay(op.session_id!);
    // Provider completion may precede its webhook/local paid marker.
    const refundsBefore = provider.refundCalls;
    await service.disputeFee(
      sql,
      user,
      id,
      { reason: "Please review whether the attendance record is accurate." },
      options,
    );
    await sweep();
    assert.equal(provider.refundCalls, refundsBefore);
    let view = await service.getBilling(sql, user, options);
    assert.equal(view.fees.find((f) => f.id === id)?.paymentStatus, "paid");
    const disputeId = view.fees.find((f) => f.id === id)!.dispute!.id;
    await service.resolveBillingDispute(
      sql,
      "admin",
      disputeId,
      { resolution: "uphold", note: "Attendance evidence confirms the recorded fee." },
      options,
    );
    await sweep();
    view = await service.getBilling(sql, user, options);
    assert.equal(view.fees.find((f) => f.id === id)?.status, "assessed");
    assert.equal(provider.refundCalls, refundsBefore);
  });

  it("waivers refund paid fees exactly once and payment/expiry races also return the charge", async () => {
    const user = await member(),
      id = await feeFor(user);
    await feeCheckout(user, id);
    const { op } = await checkoutFor(user, id);
    provider.pay(op.session_id!);
    await sweep();
    const before = provider.refundCalls;
    // This is the same ledger transition as an automatic covered-seat waiver.
    await sql`update ledger_events set status = 'waived' where id = ${id}`;
    await sweep();
    await sweep();
    assert.equal(provider.refundCalls, before + 1);
    assert.equal(
      (await service.getBilling(sql, user, options)).fees.find((f) => f.id === id)?.paymentStatus,
      "refunded",
    );
    const raceUser = await member(),
      raceFee = await feeFor(raceUser);
    await feeCheckout(raceUser, raceFee);
    const raced = await checkoutFor(raceUser, raceFee);
    provider.raceOnExpire.add(raced.op.session_id!);
    await service.disputeFee(
      sql,
      raceUser,
      raceFee,
      { reason: "I need to stop this pending payment for review." },
      options,
    );
    await sweep();
    assert.equal(
      (await service.getBilling(sql, raceUser, options)).fees.find((f) => f.id === raceFee)
        ?.paymentStatus,
      "refunded",
    );
    assert.equal(provider.refundCalls, before + 2);
  });

  it("membership credits export once and never become fee payments or cash refunds", async () => {
    const user = await member(),
      id = await feeFor(user, "show_up_credit");
    await sql`update profiles set credit_cents = 500 where id = ${user}`;
    const termsHash = (await service.getBilling(sql, user, options)).membershipCheckout.termsHash;
    await service.createMembershipCheckout(
      sql,
      user,
      { requestId: "credit-member", termsHash },
      options,
    );
    await sweep();
    await sweep();
    assert.equal(provider.credits.has(id), true);
    assert.equal(
      (await sql<{ credit_cents: number }>`select credit_cents from profiles where id = ${user}`)[0]
        .credit_cents,
      0,
    );
    assert.equal((await service.getBilling(sql, user, options)).creditCents, 500);
    await reject(
      service.createFeeCheckout(sql, user, id, { requestId: "cashout", termsHash }, options),
      404,
    );
    await feeFor(user, "show_up_credit");
    await sql`update profiles set credit_cents = 500 where id = ${user}`;
    assert.equal((await service.getBilling(sql, user, options)).creditCents, 1000);
    await sweep();
    assert.equal(
      (await service.getBilling(sql, user, options)).creditCents,
      1000,
      "new credit stays visible when exported from the pending balance to Stripe",
    );
  });

  it("queues cancellation/redaction during deletion and retries provider outages without new charges", async () => {
    const user = await member(),
      id = await feeFor(user);
    await feeCheckout(user, id);
    const { a, op } = await checkoutFor(user, id);
    await sql.transaction(async (tx) => {
      await tx`select id from profiles where id = ${user} for update`;
      await service.queueBillingDeletion(tx, user, now);
      await tx`update profiles set deleted_at = ${new Date(now).toISOString()} where id = ${user}`;
    });
    provider.failDelete = true;
    await sweep();
    assert.equal(
      (
        await sql<{
          status: string;
        }>`select status from billing_deletion_queue where account_id = ${a.id}`
      )[0].status,
      "pending",
    );
    provider.failDelete = false;
    await sweep();
    await sweep();
    assert.equal(provider.deleted.has(a.customer_id!), true);
    assert.equal(provider.sessions.get(op.session_id!)?.status, "expired");
    assert.equal(
      (
        await sql<{
          status: string;
        }>`select status from billing_deletion_queue where account_id = ${a.id}`
      )[0].status,
      "completed",
    );
    await reject(service.getBilling(sql, user, options), 404);
  });

  it("continues a pending refund after deleting the Stripe customer, without duplicating it", async () => {
    const user = await member(),
      id = await feeFor(user);
    await feeCheckout(user, id);
    const { a, op } = await checkoutFor(user, id);
    provider.raceOnExpire.add(op.session_id!);
    provider.refundState = "pending";
    await sql.transaction(async (tx) => {
      await tx`select id from profiles where id = ${user} for update`;
      await service.queueBillingDeletion(tx, user, now);
      await tx`update profiles set deleted_at = ${new Date(now).toISOString()} where id = ${user}`;
    });
    await sweep();
    assert.equal(provider.deleted.has(a.customer_id!), true);
    let [job] = await sql<{
      status: string;
      provider_deleted_at: Date | null;
    }>`select status, provider_deleted_at from billing_deletion_queue where account_id = ${a.id}`;
    assert.equal(job.status, "pending");
    assert.ok(job.provider_deleted_at);
    const count = provider.refundCalls;
    const refund = provider.refunds.get(`samepace-refund-${op.id}`)!;
    assert.equal(refund.status, "pending");
    await sweep();
    assert.equal(provider.refundCalls, count);
    refund.status = "succeeded";
    await sweep();
    [job] = await sql<{
      status: string;
      provider_deleted_at: Date | null;
    }>`select status, provider_deleted_at from billing_deletion_queue where account_id = ${a.id}`;
    assert.equal(job.status, "completed");
    assert.equal(
      (await sql<{ status: string }>`select status from billing_checkouts where id = ${op.id}`)[0]
        .status,
      "refunded",
    );
    assert.equal(provider.refundCalls, count);
    provider.refundState = "succeeded";
  });

  it("cancels a deleted member's subscription despite refund failure, and retries the refund later", async () => {
    const user = await member(),
      id = await feeFor(user);
    await feeCheckout(user, id);
    const { a, op } = await checkoutFor(user, id);
    provider.pay(op.session_id!);
    provider.memberships.set(a.customer_id!, {
      status: "active",
      subscriptionId: "sub_refund_outage",
      periodEnd: Math.floor(now / 1000) + 86400,
      cancelAtPeriodEnd: false,
      creditCents: 0,
    });
    await sql`update ledger_events set status = 'waived' where id = ${id}`;
    provider.failRefund = true;
    try {
      await sweep();
      assert.equal(
        (await service.getBilling(sql, user, options)).membership.active,
        true,
        "an unrelated fee error must not roll back subscription refresh",
      );
      await sql.transaction(async (tx) => {
        await tx`select id from profiles where id = ${user} for update`;
        await service.queueBillingDeletion(tx, user, now);
        await tx`update profiles set deleted_at = ${new Date(now).toISOString()} where id = ${user}`;
      });
      assert.ok((await sweep()).errors > 0);
      assert.equal(provider.deleted.has(a.customer_id!), true);
      assert.equal(provider.memberships.get(a.customer_id!)?.status, "canceled");
      const [job] = await sql<{ status: string; provider_deleted_at: Date | null }>`
        select status, provider_deleted_at from billing_deletion_queue where account_id = ${a.id}`;
      assert.equal(job.status, "pending");
      assert.ok(
        job.provider_deleted_at,
        "cancellation milestone commits despite a later refund failure",
      );
    } finally {
      provider.failRefund = false;
    }
    const count = provider.refundCalls;
    await sweep();
    await sweep();
    assert.equal(provider.refundCalls, count + 1);
    assert.equal(
      (
        await sql<{
          status: string;
        }>`select status from billing_deletion_queue where account_id = ${a.id}`
      )[0].status,
      "completed",
    );
    assert.equal(
      (await sql<{ status: string }>`select status from billing_checkouts where id = ${op.id}`)[0]
        .status,
      "refunded",
    );
  });

  it("recovers financial references after lost checkout and customer-deletion responses", async () => {
    const user = await member(),
      id = await feeFor(user);
    provider.loseCheckoutResponse = true;
    await assert.rejects(feeCheckout(user, id), /lost checkout/);
    const { a, op } = await checkoutFor(user, id);
    assert.equal(a.customer_id, null, "failed checkout rolled back its original customer binding");
    const session = [...provider.sessions.values()].find((s) => s.operationId === op.id)!;
    const customerId = session.customerId!;
    provider.pay(session.id);
    await sql`update ledger_events set status = 'waived' where id = ${id}`;
    await sql.transaction(async (tx) => {
      await tx`select id from profiles where id = ${user} for update`;
      await service.queueBillingDeletion(tx, user, now);
      await tx`update profiles set deleted_at = ${new Date(now).toISOString()} where id = ${user}`;
    });
    provider.loseDeleteResponse = true;
    await sweep();
    assert.equal(provider.deleted.has(customerId), true);
    assert.equal(
      await provider.findCustomer(a.id),
      null,
      "deleted customer metadata is no longer searchable",
    );
    assert.equal(
      (await sql<Account>`select * from billing_accounts where id = ${a.id}`)[0].customer_id,
      customerId,
      "recovered customer reference was committed before deletion",
    );
    assert.equal(provider.sessions.get(session.id)?.customerId, null);
    const count = provider.refundCalls;
    await sweep();
    await sweep();
    assert.equal(provider.refundCalls, count + 1);
    const [recovered] = await sql<Checkout>`select * from billing_checkouts where id = ${op.id}`;
    assert.equal(recovered.session_id, session.id);
    assert.equal(recovered.status, "refunded");
    assert.equal(
      (
        await sql<{
          status: string;
        }>`select status from billing_deletion_queue where account_id = ${a.id}`
      )[0].status,
      "completed",
    );
  });

  it("failed customer recovery cannot starve other accounts' membership reconciliation", async () => {
    const brokenUser = await member(),
      healthyUser = await member();
    const brokenHash = (await service.getBilling(sql, brokenUser, options)).membershipCheckout
      .termsHash;
    provider.loseCustomerResponse = true;
    await assert.rejects(
      service.createMembershipCheckout(
        sql,
        brokenUser,
        { requestId: "lost-customer", termsHash: brokenHash },
        options,
      ),
    );
    const healthyHash = (await service.getBilling(sql, healthyUser, options)).membershipCheckout
      .termsHash;
    await service.createMembershipCheckout(
      sql,
      healthyUser,
      { requestId: "healthy", termsHash: healthyHash },
      options,
    );
    const { a: broken } = await checkoutFor(brokenUser),
      { a: healthy } = await checkoutFor(healthyUser);
    provider.customers.delete(broken.id); // No retrievable provider customer yet.
    provider.memberships.set(healthy.customer_id!, {
      status: "active",
      subscriptionId: "sub_healthy",
      periodEnd: Math.floor(now / 1000) + 86400,
      cancelAtPeriodEnd: false,
      creditCents: 0,
    });
    await sql`update billing_accounts set reconcile_attempt_at = ${new Date(now).toISOString()}`;
    await sql`update billing_accounts set reconcile_attempt_at = null where id in (${broken.id}, ${healthy.id})`;
    await sweepBilling(sql, now + 200, 1, options);
    await sweepBilling(sql, now + 300, 1, options);
    assert.equal((await service.getBilling(sql, healthyUser, options)).membership.active, true);
  });

  it("owner refresh reconciles real payment state and persists its throttle", async () => {
    const user = await member();
    const termsHash = (await service.getBilling(sql, user, options)).membershipCheckout.termsHash;
    await service.createMembershipCheckout(
      sql,
      user,
      { requestId: "refresh-me", termsHash },
      options,
    );
    const { a } = await checkoutFor(user);
    provider.memberships.set(a.customer_id!, {
      status: "active",
      subscriptionId: "sub_refresh",
      periodEnd: Math.floor(now / 1000) + 86400,
      cancelAtPeriodEnd: false,
      creditCents: 0,
    });
    assert.equal((await service.refreshBilling(sql, user, options)).membership.active, true);
    provider.memberships.set(a.customer_id!, {
      status: "canceled",
      subscriptionId: "sub_refresh",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      creditCents: 0,
    });
    assert.equal(
      (await service.refreshBilling(sql, user, { ...options, now: now + 29_000 })).membership
        .active,
      true,
    );
    assert.equal(
      (await service.refreshBilling(sql, user, { ...options, now: now + 31_000 })).membership
        .active,
      false,
    );
  });
});
