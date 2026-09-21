import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Stripe from "stripe";
import { stripeProvider, stripeUrl } from "./provider.server.ts";
import { testConfig } from "./test-provider.ts";

test("membership recognizes portal cancellation timestamps without extending paid access", async () => {
  const periodEnd = 2_000_000_000;
  const subscription = {
    id: "sub_portal",
    status: "active",
    created: 1,
    metadata: { samepace_account: "account-portal" },
    items: {
      data: [{ price: { id: "price_membership" }, quantity: 1, current_period_end: periodEnd }],
    },
    cancel_at: null as number | null,
    cancel_at_period_end: false,
  };
  const sdk = {
    customers: { retrieve: async () => ({ id: "cus_portal", balance: 0 }) },
    subscriptions: { list: async () => ({ data: [subscription], has_more: false }) },
  } as unknown as Stripe;
  const provider = stripeProvider(testConfig, sdk);
  for (const scenario of [
    { label: "no cancellation", cancelAt: null, legacy: false, ends: false, end: periodEnd },
    {
      label: "legacy period-end cancellation",
      cancelAt: null,
      legacy: true,
      ends: true,
      end: periodEnd,
    },
    {
      label: "portal timestamp at period end",
      cancelAt: periodEnd,
      legacy: false,
      ends: true,
      end: periodEnd,
    },
    {
      label: "earlier cancellation caps access",
      cancelAt: periodEnd - 3600,
      legacy: false,
      ends: true,
      end: periodEnd - 3600,
    },
    {
      label: "later cancellation does not extend access",
      cancelAt: periodEnd + 3600,
      legacy: false,
      ends: false,
      end: periodEnd,
    },
    {
      label: "removing cancellation restores renewal",
      cancelAt: null,
      legacy: false,
      ends: false,
      end: periodEnd,
    },
  ]) {
    subscription.cancel_at = scenario.cancelAt;
    subscription.cancel_at_period_end = scenario.legacy;
    const result = await provider.membership("cus_portal", "account-portal", "price_membership");
    assert.equal(result.status, "active", scenario.label);
    assert.equal(result.periodEnd, scenario.end, scenario.label);
    assert.equal(result.cancelAtPeriodEnd, scenario.ends, scenario.label);
  }
});

test("official Stripe adapter sends server-owned hosted checkout, portal, credits and idempotent refund requests", async () => {
  const requests: {
    method: string;
    path: string;
    body: URLSearchParams;
    query: URLSearchParams;
    key: string | undefined;
  }[] = [];
  let session: Record<string, unknown>;
  let deleted = false;
  const refunds: Record<string, unknown>[] = [],
    credits: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    const path = new URL(req.url!, "http://localhost").pathname;
    const method = req.method!;
    requests.push({
      method,
      path,
      body,
      query: new URL(req.url!, "http://localhost").searchParams,
      key: req.headers["idempotency-key"] as string | undefined,
    });
    let result: unknown;
    if (path === "/v1/prices/price_membership")
      result = {
        id: "price_membership",
        active: true,
        currency: "usd",
        unit_amount: 1200,
        recurring: { interval: "month", interval_count: 1 },
        livemode: false,
      };
    else if (path === "/v1/customers" && method === "POST") result = { id: "cus_wire" };
    else if (path === "/v1/customers/search")
      result = { data: [{ id: "cus_wire" }], has_more: false };
    else if (path === "/v1/customers/cus_wire" && method === "DELETE") {
      deleted = true;
      if (session) session.customer = null;
      result = { id: "cus_wire", deleted: true };
    } else if (path === "/v1/customers/cus_wire")
      result = deleted ? { id: "cus_wire", deleted: true } : { id: "cus_wire", balance: -500 };
    else if (path === "/v1/checkout/sessions" && method === "POST") {
      session = {
        id: "cs_test_wire",
        customer: body.get("customer"),
        client_reference_id: body.get("client_reference_id"),
        metadata: { samepace_account: body.get("metadata[samepace_account]") },
        status: "open",
        payment_status: "unpaid",
        amount_total: Number(body.get("line_items[0][price_data][unit_amount]")),
        currency: "usd",
        payment_intent: null,
        subscription: null,
        url: "https://checkout.stripe.com/c/pay/cs_test_wire",
        livemode: false,
      };
      result = session;
    } else if (path === "/v1/checkout/sessions/cs_test_wire") result = session;
    else if (path === "/v1/checkout/sessions") result = { data: [session], has_more: false };
    else if (path === "/v1/billing_portal/configurations/bpc_test")
      result = {
        active: true,
        features: {
          subscription_update: { enabled: false },
          subscription_cancel: { enabled: true },
          payment_method_update: { enabled: true },
        },
      };
    else if (path === "/v1/billing_portal/sessions")
      result = { url: "https://billing.stripe.com/p/session/wire" };
    else if (path === "/v1/refunds" && method === "POST") {
      const r = {
        id: "re_wire",
        status: "succeeded",
        metadata: { samepace_refund: body.get("metadata[samepace_refund]") },
        payment_intent: body.get("payment_intent"),
      };
      refunds.push(r);
      result = r;
    } else if (path === "/v1/refunds") result = { data: refunds, has_more: false };
    else if (path.endsWith("/balance_transactions") && method === "POST") {
      const c = {
        id: "cbtxn_wire",
        metadata: { samepace_credit: body.get("metadata[samepace_credit]") },
      };
      credits.push(c);
      result = c;
    } else if (path.endsWith("/balance_transactions")) result = { data: credits, has_more: false };
    else if (path === "/v1/subscriptions")
      result = {
        data: [
          {
            id: "sub_wire",
            status: "active",
            created: 1,
            metadata: { samepace_account: "account-wire" },
            items: {
              data: [
                {
                  price: { id: "price_membership" },
                  quantity: 1,
                  current_period_end: 2_000_000_000,
                },
              ],
            },
            cancel_at_period_end: false,
          },
        ],
        has_more: false,
      };
    else {
      res.statusCode = 404;
      result = { error: { message: "Unexpected synthetic endpoint" } };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const sdk = new Stripe(testConfig.secretKey, {
    host: "127.0.0.1",
    port: address.port,
    protocol: "http",
    maxNetworkRetries: 0,
  });
  const p = stripeProvider(testConfig, sdk);
  try {
    assert.equal((await p.price("price_membership")).amount, 1200);
    assert.equal(await p.createCustomer("account-wire", "customer-operation"), "cus_wire");
    const created = await p.createCheckout(
      {
        id: "operation-wire",
        accountId: "account-wire",
        customerId: "cus_wire",
        kind: "fee",
        amountCents: 1000,
        priceId: null,
        returnUrl: testConfig.returnUrl,
        expiresAt: Date.now() + 3600_000,
      },
      "checkout-operation",
    );
    assert.equal(created.operationId, "operation-wire");
    assert.equal(created.customerId, "cus_wire");
    const checkout = requests.find(
      (r) => r.method === "POST" && r.path === "/v1/checkout/sessions",
    )!;
    assert.equal(checkout.body.get("line_items[0][price_data][unit_amount]"), "1000");
    assert.equal(checkout.body.get("mode"), "payment");
    assert.equal(checkout.body.get("payment_method_types[0]"), "card");
    assert.equal(checkout.body.has("off_session"), false);
    assert.equal(checkout.key, "checkout-operation");
    assert.equal((await p.findCheckout("cus_wire", "operation-wire", Date.now()))?.id, created.id);
    assert.equal(
      (await p.membership("cus_wire", "account-wire", "price_membership")).status,
      "active",
    );
    assert.equal(
      (await p.portal("cus_wire", "bpc_test", testConfig.returnUrl, "portal-operation")).startsWith(
        "https://billing.stripe.com/",
      ),
      true,
    );
    await p.refund("pi_wire", 1000, "refund-operation");
    await p.refund("pi_wire", 1000, "refund-operation");
    assert.equal(requests.filter((r) => r.method === "POST" && r.path === "/v1/refunds").length, 1);
    await p.credit("cus_wire", "credit-ledger", 500);
    await p.credit("cus_wire", "credit-ledger", 500);
    const creditPosts = requests.filter(
      (r) => r.method === "POST" && r.path.endsWith("/balance_transactions"),
    );
    assert.equal(creditPosts.length, 1);
    assert.equal(
      creditPosts[0].body.get("amount"),
      "-500",
      "credit goes to invoice balance, never a cash payout",
    );
    await p.deleteCustomer("cus_wire");
    await p.deleteCustomer("cus_wire");
    assert.equal(requests.filter((r) => r.method === "DELETE").length, 1);
    const recovered = await p.findCheckout("cus_wire", "operation-wire", Date.now(), true);
    assert.equal(recovered?.id, created.id);
    assert.equal(recovered?.customerId, null);
    assert.equal(
      requests.at(-1)!.query.has("customer"),
      false,
      "recovery uses durable operation metadata when provider deletion clears the customer reference",
    );
    assert.throws(() => stripeUrl("http://checkout.stripe.com/pay", "checkout"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
