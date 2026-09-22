/** Official Stripe SDK adapter; no payment details enter the SamePace server. */
import Stripe from "stripe";

export type BillingConfig = {
  enabled: boolean;
  clusterReady: boolean;
  enforced: boolean;
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  portalConfigurationId: string;
  returnUrl: string;
  livemode: boolean;
  configured: boolean;
};
export function billingConfig(
  env: Record<string, string | undefined> = process.env,
): BillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const returnUrl = env.BILLING_RETURN_URL?.trim() ?? "";
  let safeReturn = false;
  try {
    const u = new URL(returnUrl);
    safeReturn = u.protocol === "https:" && !u.username && !u.password;
  } catch {
    /* Unconfigured. */
  }
  const config = {
    enabled: env.BILLING_ENABLED === "true",
    clusterReady: env.BILLING_CLUSTER_READY === "true",
    enforced: env.BILLING_ENFORCED === "true",
    secretKey,
    returnUrl,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
    priceId: env.STRIPE_MEMBERSHIP_PRICE_ID?.trim() ?? "",
    portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() ?? "",
    livemode: /^(?:sk|rk)_live_/.test(secretKey),
    configured: false,
  };
  config.configured =
    /^(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]+$/.test(secretKey) &&
    config.webhookSecret.startsWith("whsec_") &&
    config.priceId.startsWith("price_") &&
    config.portalConfigurationId.startsWith("bpc_") &&
    safeReturn;
  return config;
}
export type ProviderCheckout = {
  id: string;
  customerId: string | null;
  operationId: string | null;
  accountId: string | null;
  status: "open" | "complete" | "expired";
  paymentStatus: string;
  url: string | null;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  livemode: boolean;
};
export type ProviderInvoice = {
  id: string;
  customerId: string;
  status: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
};
export interface BillingProvider {
  price(id: string): Promise<{
    active: boolean;
    currency: string;
    amount: number | null;
    interval: string | null;
    intervalCount: number | null;
    livemode: boolean;
  }>;
  createCustomer(accountId: string, key: string): Promise<string>;
  findCustomer(accountId: string): Promise<string | null>;
  createCheckout(
    input: {
      id: string;
      accountId: string;
      customerId: string;
      kind: "membership" | "fee";
      amountCents: number;
      priceId: string | null;
      returnUrl: string;
      expiresAt: number;
    },
    key: string,
  ): Promise<ProviderCheckout>;
  checkout(id: string): Promise<ProviderCheckout>;
  findCheckout(
    customerId: string,
    operationId: string,
    createdAfter: number,
    customerDeleted?: boolean,
  ): Promise<ProviderCheckout | null>;
  expireCheckout(id: string): Promise<void>;
  portal(
    customerId: string,
    configuration: string,
    returnUrl: string,
    key: string,
  ): Promise<string>;
  membership(
    customerId: string,
    accountId: string,
    priceId: string,
  ): Promise<{
    status: string;
    subscriptionId: string | null;
    periodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    creditCents: number;
  }>;
  invoice(id: string): Promise<ProviderInvoice>;
  payment(id: string): Promise<{
    customerId: string | null;
    status: string;
    amount: number;
    currency: string;
    refunded: number;
    disputed: boolean;
  }>;
  refund(
    paymentIntentId: string,
    amount: number,
    key: string,
  ): Promise<{ id: string; status: string }>;
  refundStatus(id: string): Promise<{ status: string; paymentIntentId: string | null }>;
  paymentReference(type: string, objectId: string): Promise<string | null>;
  credit(customerId: string, ledgerId: string, amount: number): Promise<string>;
  deleteCustomer(customerId: string): Promise<void>;
}

function ref(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}
function checkoutView(s: Stripe.Checkout.Session): ProviderCheckout {
  if (s.status !== "open" && s.status !== "complete" && s.status !== "expired")
    throw new Error("Unrecognized checkout state.");
  return {
    id: s.id,
    customerId: ref(s.customer),
    operationId: s.client_reference_id,
    accountId: s.metadata?.samepace_account ?? null,
    status: s.status === "open" ? "open" : s.status === "complete" ? "complete" : "expired",
    paymentStatus: s.payment_status,
    url: s.url,
    amountTotal: s.amount_total,
    currency: s.currency,
    paymentIntentId: ref(s.payment_intent),
    subscriptionId: ref(s.subscription),
    livemode: s.livemode,
  };
}
/** Never return arbitrary provider redirects to a member. */
export function stripeUrl(raw: string, kind: "checkout" | "portal") {
  const url = new URL(raw);
  const host = kind === "checkout" ? "checkout.stripe.com" : "billing.stripe.com";
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Unexpected hosted payment URL.");
  return raw;
}

export function stripeProvider(
  config: BillingConfig,
  stripe = new Stripe(config.secretKey, { timeout: 8000, maxNetworkRetries: 0 }),
): BillingProvider {
  return {
    async price(id) {
      const p = await stripe.prices.retrieve(id);
      return {
        active: p.active,
        currency: p.currency,
        amount: p.unit_amount,
        interval: p.recurring?.interval ?? null,
        intervalCount: p.recurring?.interval_count ?? null,
        livemode: p.livemode,
      };
    },
    async createCustomer(accountId, key) {
      return (
        await stripe.customers.create(
          { metadata: { samepace_account: accountId } },
          { idempotencyKey: key },
        )
      ).id;
    },
    async findCustomer(accountId) {
      if (!/^[a-zA-Z0-9-]+$/.test(accountId)) throw new Error("Invalid account reference.");
      const found = await stripe.customers.search({
        query: `metadata['samepace_account']:'${accountId}'`,
        limit: 10,
      });
      if (found.has_more || found.data.length > 1)
        throw new Error("Customer reconciliation needs review.");
      return found.data[0]?.id ?? null;
    },
    async createCheckout(input, key) {
      const returnUrl = new URL(input.returnUrl);
      returnUrl.searchParams.set("billing", "returned");
      const metadata = { samepace_account: input.accountId, samepace_checkout: input.id };
      const s = await stripe.checkout.sessions.create(
        {
          customer: input.customerId,
          client_reference_id: input.id,
          metadata,
          mode: input.kind === "membership" ? "subscription" : "payment",
          payment_method_types: ["card"],
          line_items: [
            input.kind === "membership"
              ? { price: input.priceId!, quantity: 1 }
              : {
                  price_data: {
                    currency: "usd",
                    unit_amount: input.amountCents,
                    product_data: { name: "SamePace session fee" },
                  },
                  quantity: 1,
                },
          ],
          ...(input.kind === "membership"
            ? { subscription_data: { metadata } }
            : { payment_intent_data: { metadata } }),
          success_url: returnUrl.toString(),
          cancel_url: input.returnUrl,
          expires_at: Math.floor(input.expiresAt / 1000),
          allow_promotion_codes: false,
          automatic_tax: { enabled: false },
        },
        { idempotencyKey: key },
      );
      return checkoutView(s);
    },
    async checkout(id) {
      return checkoutView(await stripe.checkout.sessions.retrieve(id));
    },
    async findCheckout(customerId, operationId, createdAfter, customerDeleted = false) {
      const sessions = await stripe.checkout.sessions.list({
        // Deleted customers can be cleared from retained Checkout objects. The
        // durable app operation/account metadata remains the ownership boundary.
        ...(customerDeleted ? {} : { customer: customerId }),
        created: { gte: Math.floor(createdAfter / 1000) - 5 },
        limit: 100,
      });
      const matching = sessions.data.filter((s) => s.client_reference_id === operationId);
      if (matching.length > 1 || (sessions.has_more && !matching.length))
        throw new Error("Checkout reconciliation needs review.");
      return matching[0] ? checkoutView(matching[0]) : null;
    },
    async expireCheckout(id) {
      const s = await stripe.checkout.sessions.retrieve(id);
      if (s.status === "open") await stripe.checkout.sessions.expire(id);
    },
    async portal(customerId, configuration, returnUrl, key) {
      const c = await stripe.billingPortal.configurations.retrieve(configuration);
      if (
        !c.active ||
        c.features.subscription_update.enabled ||
        !c.features.subscription_cancel.enabled ||
        !c.features.payment_method_update.enabled
      )
        throw new Error("Portal must allow cancellation/payment updates and disable plan changes.");
      const p = await stripe.billingPortal.sessions.create(
        { customer: customerId, configuration, return_url: returnUrl },
        { idempotencyKey: key },
      );
      return stripeUrl(p.url, "portal");
    },
    async membership(customerId, accountId, priceId) {
      const [customer, subs] = await Promise.all([
        stripe.customers.retrieve(customerId),
        stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 }),
      ]);
      if (customer.deleted)
        return {
          status: "canceled",
          subscriptionId: null,
          periodEnd: null,
          cancelAtPeriodEnd: true,
          creditCents: 0,
        };
      if (subs.has_more) throw new Error("Subscription reconciliation needs review.");
      const ours = subs.data
        .filter((s) => s.metadata.samepace_account === accountId)
        .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
      const running = ours.filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
      if (running.length > 1) throw new Error("Multiple memberships need review.");
      const s = running[0] ?? ours[0];
      if (
        s &&
        (s.items.data.length !== 1 ||
          s.items.data[0].price.id !== priceId ||
          s.items.data[0].quantity !== 1)
      )
        throw new Error("Membership price changed unexpectedly.");
      const periodEnd = s?.items.data[0]?.current_period_end ?? null;
      const cancelAt = s?.cancel_at ?? null;
      // The portal can schedule cancellation with cancel_at while leaving
      // cancel_at_period_end false. Never extend access beyond the paid period.
      const endsThisPeriod = cancelAt !== null && periodEnd !== null && cancelAt <= periodEnd;
      return {
        status: s?.status ?? "none",
        subscriptionId: s?.id ?? null,
        periodEnd: endsThisPeriod ? cancelAt : periodEnd,
        cancelAtPeriodEnd: (s?.cancel_at_period_end ?? false) || endsThisPeriod,
        creditCents: Math.max(0, -customer.balance),
      };
    },
    async invoice(id) {
      const i = await stripe.invoices.retrieve(id);
      return {
        id: i.id,
        customerId: ref(i.customer)!,
        status: i.status ?? "draft",
        currency: i.currency,
        amountDue: i.amount_due,
        amountPaid: i.amount_paid,
      };
    },
    async payment(id) {
      const p = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
      const charge = typeof p.latest_charge === "object" ? p.latest_charge : null;
      return {
        customerId: ref(p.customer),
        status: p.status,
        amount: p.amount_received,
        currency: p.currency,
        refunded: charge?.amount_refunded ?? 0,
        disputed: charge?.disputed ?? false,
      };
    },
    async refund(paymentIntentId, amount, key) {
      // Search the payment's existing refund metadata before retrying beyond the
      // provider's 24-hour idempotency retention period.
      const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
      const prior = existing.data.find((r) => r.metadata?.samepace_refund === key);
      if (prior) return { id: prior.id, status: prior.status ?? "pending" };
      if (existing.has_more) throw new Error("Refund reconciliation needs review.");
      const r = await stripe.refunds.create(
        { payment_intent: paymentIntentId, amount, metadata: { samepace_refund: key } },
        { idempotencyKey: key },
      );
      return { id: r.id, status: r.status ?? "pending" };
    },
    async refundStatus(id) {
      const r = await stripe.refunds.retrieve(id);
      return { status: r.status ?? "pending", paymentIntentId: ref(r.payment_intent) };
    },
    async paymentReference(type, objectId) {
      if (type.startsWith("refund."))
        return ref((await stripe.refunds.retrieve(objectId)).payment_intent);
      const chargeId = type.startsWith("charge.dispute.")
        ? ref((await stripe.disputes.retrieve(objectId)).charge)
        : objectId;
      return chargeId ? ref((await stripe.charges.retrieve(chargeId)).payment_intent) : null;
    },
    async credit(customerId, ledgerId, amount) {
      const balance = await stripe.customers.listBalanceTransactions(customerId, { limit: 100 });
      const prior = balance.data.find((t) => t.metadata?.samepace_credit === ledgerId);
      if (prior) return prior.id;
      if (balance.has_more) throw new Error("Credit reconciliation needs review.");
      return (
        await stripe.customers.createBalanceTransaction(
          customerId,
          {
            amount: -amount,
            currency: "usd",
            description: "SamePace membership credit",
            metadata: { samepace_credit: ledgerId },
          },
          { idempotencyKey: `samepace-credit-${ledgerId}` },
        )
      ).id;
    },
    async deleteCustomer(customerId) {
      const existing = await stripe.customers.retrieve(customerId);
      if (!existing.deleted) await stripe.customers.del(customerId);
    },
  };
}

/** Official raw-byte signature verification, including timestamp tolerance. */
export function stripeEvent(
  raw: string,
  signature: string,
  config: BillingConfig,
  now = Date.now(),
) {
  const timestamp = Number(
    signature
      .split(",")
      .find((v) => v.startsWith("t="))
      ?.slice(2),
  );
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300)
    throw new Error("Stale webhook timestamp.");
  const stripe = new Stripe(config.secretKey || "sk_test_webhook_only");
  return stripe.webhooks.constructEvent(raw, signature, config.webhookSecret, 300, undefined, now);
}
