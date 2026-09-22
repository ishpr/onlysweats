import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { PaceError } from "../pace/service.server.ts";
import type { BillingConfig, BillingProvider, ProviderCheckout } from "./provider.server.ts";
import { stripeUrl } from "./provider.server.ts";

export const iso = (n: number | Date) => new Date(n).toISOString();
export type Account = {
  id: string;
  profile_id: string;
  customer_id: string | null;
  livemode: boolean;
  customer_attempt_at: Date | null;
  membership_status: string;
  subscription_id: string | null;
  period_end: Date | null;
  cancel_at_period_end: boolean;
  stripe_credit_cents: number;
  reconciled_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
};
export type Checkout = {
  id: string;
  account_id: string;
  request_id: string;
  kind: "membership" | "fee";
  ledger_id: string | null;
  amount_cents: number;
  terms_hash: string;
  price_id: string | null;
  return_url: string;
  status: string;
  session_id: string | null;
  payment_intent_id: string | null;
  subscription_id: string | null;
  refund_id: string | null;
  cancel_requested: boolean;
  url: string | null;
  expires_at: Date;
  created_at: Date;
};
export type Fee = {
  id: string;
  profile_id: string;
  kind: string;
  amount_cents: number;
  status: string;
  chargeable_at: Date | null;
  created_at: Date;
  booking_id: string | null;
  session_title?: string | null;
};

/** All billing writes use profile -> account -> ledger/operation lock order. */
export async function lockAccount(
  tx: Sql,
  userId: string,
  config: BillingConfig,
  create = false,
  allowDeleted = false,
  now = Date.now(),
) {
  const [person] = await tx<{
    id: string;
    completed_count: number;
    deleted_at: Date | null;
    suspended_at: Date | null;
    credit_cents: number;
  }>`
    select id, completed_count, deleted_at, suspended_at, credit_cents from profiles where id = ${userId} for no key update`;
  if (!person || (!allowDeleted && person.deleted_at))
    throw new PaceError(404, "Billing unavailable.");
  if (create)
    await tx`insert into billing_accounts (id, profile_id, livemode, customer_attempt_at, created_at)
    values (${randomUUID()}, ${userId}, ${config.livemode}, ${iso(now)}, ${iso(now)}) on conflict (profile_id) do nothing`;
  const [account] =
    await tx<Account>`select * from billing_accounts where profile_id = ${userId} for update`;
  if (account && account.livemode !== config.livemode)
    throw new PaceError(409, "Billing environment changed. Contact support before paying.");
  return { person, account };
}
export async function validatePrice(provider: BillingProvider, config: BillingConfig) {
  const price = await provider.price(config.priceId);
  if (
    !price.active ||
    price.currency !== "usd" ||
    price.amount !== 1200 ||
    price.interval !== "month" ||
    price.intervalCount !== 1 ||
    price.livemode !== config.livemode
  )
    throw new PaceError(409, "Membership price is not configured for $12 USD per month.");
}
export async function customer(tx: Sql, a: Account, p: BillingProvider, now: number) {
  if (a.customer_id) return a.customer_id;
  if (a.deleted_at) throw new PaceError(409, "This billing account is closing.");
  const old = !a.customer_attempt_at || now - +new Date(a.customer_attempt_at) > 23 * 3_600_000;
  const id = old
    ? await p.findCustomer(a.id)
    : await p.createCustomer(a.id, `samepace-customer-${a.id}`);
  if (!id)
    throw new PaceError(
      409,
      "An earlier billing setup needs reconciliation. Contact support before retrying.",
    );
  await tx`update billing_accounts set customer_id = ${id} where id = ${a.id}`;
  a.customer_id = id;
  return id;
}
export async function refreshMembership(
  tx: Sql,
  a: Account,
  p: BillingProvider,
  config: BillingConfig,
  now: number,
) {
  if (!a.customer_id || a.deleted_at) return;
  const current = await p.membership(a.customer_id, a.id, config.priceId);
  const end = current.periodEnd === null ? null : iso(current.periodEnd * 1000);
  await tx`update billing_accounts set membership_status = ${current.status}, subscription_id = ${current.subscriptionId},
    period_end = ${end}, cancel_at_period_end = ${current.cancelAtPeriodEnd}, stripe_credit_cents = ${current.creditCents},
    reconciled_at = ${iso(now)} where id = ${a.id}`;
  Object.assign(a, {
    membership_status: current.status,
    subscription_id: current.subscriptionId,
    period_end: end ? new Date(end) : null,
    cancel_at_period_end: current.cancelAtPeriodEnd,
    stripe_credit_cents: current.creditCents,
    reconciled_at: new Date(now),
  });
}
export async function exportCredits(tx: Sql, a: Account, p: BillingProvider, now: number) {
  if (!a.customer_id || a.deleted_at) return;
  const credits =
    await tx<Fee>`select l.* from ledger_events l left join billing_credit_exports e on e.ledger_id = l.id
    where l.profile_id = ${a.profile_id} and l.kind = 'show_up_credit' and l.status = 'assessed'
      and (e.ledger_id is null or e.status = 'pending') order by l.created_at, l.id limit 20`;
  for (const credit of credits) {
    await tx`insert into billing_credit_exports (ledger_id, account_id, amount_cents, created_at)
      values (${credit.id}, ${a.id}, ${credit.amount_cents}, ${iso(now)}) on conflict do nothing`;
    const providerId = await p.credit(a.customer_id, credit.id, credit.amount_cents);
    const changed =
      await tx`update billing_credit_exports set status = 'applied', provider_id = ${providerId}, applied_at = ${iso(now)}
      where ledger_id = ${credit.id} and status = 'pending' returning ledger_id`;
    if (changed.length)
      await tx`update profiles set credit_cents = greatest(0, credit_cents - ${credit.amount_cents}) where id = ${a.profile_id}`;
  }
}
export async function fee(tx: Sql, userId: string, id: string): Promise<Fee> {
  const [f] = await tx<Fee>`select * from ledger_events where id = ${id} and profile_id = ${userId}
    and kind in ('late_cancel_fee','no_show_fee') for update`;
  if (!f) throw new PaceError(404, "No session fee.");
  return f;
}

/** Current provider state is authoritative; webhook snapshots never set paid. */
export async function reconcileCheckout(
  tx: Sql,
  a: Account,
  op: Checkout,
  p: BillingProvider,
  config: BillingConfig,
  now: number,
) {
  let session: ProviderCheckout | null = op.session_id
    ? await p.checkout(op.session_id)
    : a.customer_id
      ? await p.findCheckout(a.customer_id, op.id, +new Date(op.created_at), !!a.deleted_at)
      : null;
  if (!session) return op;
  if (
    session.operationId !== op.id ||
    session.accountId !== a.id ||
    (session.customerId !== a.customer_id && !(a.deleted_at && session.customerId === null)) ||
    session.livemode !== config.livemode ||
    (op.kind === "fee" && (session.amountTotal !== op.amount_cents || session.currency !== "usd"))
  )
    throw new Error("Checkout ownership or amount mismatch.");
  let shouldCancel = op.cancel_requested || op.status === "refund_pending" || !!op.refund_id;
  let refundAllowed = shouldCancel;
  if (op.kind === "fee") {
    const current = await fee(tx, a.profile_id, op.ledger_id!);
    shouldCancel ||= current.status !== "assessed" || current.amount_cents !== op.amount_cents;
    refundAllowed ||= current.status === "waived" || current.amount_cents !== op.amount_cents;
  }
  if (shouldCancel && session.status === "open") {
    // We observed an unpaid checkout after authority was withdrawn. A payment
    // that wins this expiration race is returned regardless of dispute outcome.
    refundAllowed = true;
    await tx`update billing_checkouts set cancel_requested = true where id = ${op.id}`;
    try {
      await p.expireCheckout(session.id);
    } catch {
      /* A concurrent payment may have won. Retrieve it before deciding. */
    }
    session = await p.checkout(session.id);
    if (session.status === "open") throw new Error("Checkout cancellation needs retry.");
  }
  let status = session.status === "expired" ? "expired" : "open";
  if (
    session.status === "complete" &&
    ["paid", "no_payment_required"].includes(session.paymentStatus)
  ) {
    status = "completed";
    if (op.kind === "fee") {
      if (!session.paymentIntentId) throw new Error("Paid fee has no payment reference.");
      const payment = await p.payment(session.paymentIntentId);
      if (
        (payment.customerId !== a.customer_id && !(a.deleted_at && payment.customerId === null)) ||
        payment.amount !== op.amount_cents ||
        payment.currency !== "usd" ||
        payment.status !== "succeeded"
      )
        throw new Error("Fee payment reconciliation mismatch.");
      if (payment.disputed) status = "review_required";
      else if (payment.refunded >= op.amount_cents) status = "refunded";
      else if (refundAllowed) status = "refund_pending";
      else if (payment.refunded > 0) status = "review_required";
    }
  }
  const safeUrl =
    session.status === "open" && session.url && !shouldCancel
      ? stripeUrl(session.url, "checkout")
      : null;
  const [next] = await tx<Checkout>`update billing_checkouts set session_id = ${session.id},
    payment_intent_id = ${session.paymentIntentId}, subscription_id = ${session.subscriptionId},
    status = ${status}, url = ${safeUrl}, updated_at = ${iso(now)} where id = ${op.id} returning *`;
  return next;
}

export async function refundFee(
  tx: Sql,
  a: Account,
  op: Checkout,
  p: BillingProvider,
  now: number,
) {
  // A refund can initially succeed and later fail. Signed refund events must
  // re-check a retained reference even after we displayed "refunded"; the
  // charge's aggregate amount_refunded is not that refund's final status.
  if (!op.payment_intent_id || (op.status !== "refund_pending" && !op.refund_id)) return;
  const payment = await p.payment(op.payment_intent_id);
  // A deleted Stripe customer may no longer be expanded on the payment. The
  // existing, unique app payment reference was verified before this deletion.
  if (
    (payment.customerId !== a.customer_id && !(a.deleted_at && payment.customerId === null)) ||
    payment.amount !== op.amount_cents ||
    payment.currency !== "usd"
  )
    throw new Error("Refund ownership mismatch.");
  if (payment.disputed) {
    await tx`update billing_checkouts set status = 'review_required', updated_at = ${iso(now)} where id = ${op.id}`;
    return;
  }
  let result: { id: string | null; status: string; paymentIntentId?: string | null };
  if (op.refund_id) result = { id: op.refund_id, ...(await p.refundStatus(op.refund_id)) };
  else {
    result =
      payment.refunded >= op.amount_cents
        ? { id: null, status: "succeeded" }
        : await p.refund(
            op.payment_intent_id,
            op.amount_cents - payment.refunded,
            `samepace-refund-${op.id}`,
          );
  }
  if ("paymentIntentId" in result && result.paymentIntentId !== op.payment_intent_id)
    throw new Error("Refund reference mismatch.");
  const state =
    result.status === "succeeded"
      ? "refunded"
      : ["failed", "canceled"].includes(result.status)
        ? "review_required"
        : "refund_pending";
  await tx`update billing_checkouts set refund_id = ${result.id}, status = ${state}, updated_at = ${iso(now)} where id = ${op.id}`;
}
