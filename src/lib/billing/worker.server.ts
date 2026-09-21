import type { Sql } from "../db.ts";
import {
  billingConfig,
  stripeEvent,
  stripeProvider,
  type BillingConfig,
  type BillingProvider,
} from "./provider.server.ts";
import {
  customer,
  exportCredits,
  iso,
  lockAccount,
  reconcileCheckout,
  refreshMembership,
  refundFee,
  type Account,
  type Checkout,
} from "./store.server.ts";
import type { BillingOptions } from "./service.server.ts";

const EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.updated",
  "invoice.voided",
  "invoice.finalized",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "refund.created",
  "refund.updated",
  "refund.failed",
]);
/** Intake stores only signed event/object IDs, never payloads with billing/card data. */
export async function handleStripeWebhook(
  sql: Sql,
  raw: string,
  signature: string | null,
  options: BillingOptions = {},
) {
  const config = options.config ?? billingConfig(),
    now = options.now ?? Date.now();
  if (!config.webhookSecret) return { status: 503, outcome: "not_configured" };
  if (!signature || Buffer.byteLength(raw) > 262_144)
    return { status: 400, outcome: "invalid_signature" };
  let event;
  try {
    event = stripeEvent(raw, signature, config, now);
  } catch {
    return { status: 400, outcome: "invalid_signature" };
  }
  if (!event || typeof event !== "object" || typeof event.type !== "string")
    return { status: 400, outcome: "invalid_event" };
  if (event.livemode !== config.livemode || event.account)
    return { status: 400, outcome: "wrong_account_mode" };
  if (!EVENTS.has(event.type)) return { status: 200, outcome: "ignored" };
  const object = event.data?.object as unknown as Record<string, unknown> | null;
  if (
    !object ||
    typeof object !== "object" ||
    typeof object.id !== "string" ||
    object.id.length > 200 ||
    typeof event.id !== "string" ||
    event.id.length > 200
  )
    return { status: 400, outcome: "invalid_event" };
  const customerId =
    typeof object.customer === "string" && /^cus_[A-Za-z0-9]+$/.test(object.customer)
      ? object.customer
      : null;
  await sql`insert into billing_webhook_events (id, type, object_id, customer_id, received_at)
    values (${event.id}, ${event.type}, ${object.id}, ${customerId}, ${iso(now)}) on conflict do nothing`;
  return { status: 200, outcome: "queued" };
}

type Event = { id: string; type: string; object_id: string; customer_id: string | null };
async function reconcileEvent(
  sql: Sql,
  event: Event,
  p: BillingProvider,
  c: BillingConfig,
  now: number,
) {
  let account: Account | undefined;
  let checkoutId: string | null = null;
  let invoice: Awaited<ReturnType<BillingProvider["invoice"]>> | null = null;
  if (event.type.startsWith("checkout.")) {
    const session = await p.checkout(event.object_id);
    // A signed event cannot bind a checkout to a different app member. The
    // provider's current object must name an already committed app operation.
    const [op] =
      await sql<Checkout>`select * from billing_checkouts where id = ${session.operationId}`;
    if (op) {
      [account] = await sql<Account>`select * from billing_accounts where id = ${op.account_id}`;
      if (session.accountId !== account?.id) throw new Error("Checkout account mismatch.");
      checkoutId = op.id;
    }
  } else if (event.type.startsWith("invoice.")) {
    invoice = await p.invoice(event.object_id);
    [account] =
      await sql<Account>`select * from billing_accounts where customer_id = ${invoice.customerId}`;
  } else if (event.type.startsWith("charge.") || event.type.startsWith("refund.")) {
    const payment = await p.paymentReference(event.type, event.object_id);
    const [op] =
      await sql<Checkout>`select * from billing_checkouts where payment_intent_id = ${payment}`;
    if (op) {
      [account] = await sql<Account>`select * from billing_accounts where id = ${op.account_id}`;
      checkoutId = op.id;
    }
  } else {
    [account] =
      await sql<Account>`select * from billing_accounts where customer_id = ${event.customer_id}`;
  }
  if (!account) {
    await sql`update billing_webhook_events set status = 'ignored', processed_at = ${iso(now)} where id = ${event.id}`;
    return;
  }
  await sql.transaction(async (tx) => {
    const { account: a } = await lockAccount(tx, account!.profile_id, c, false, true, now);
    const [current] = await tx<{
      status: string;
    }>`select status from billing_webhook_events where id = ${event.id} for update`;
    if (!current || current.status !== "pending") return;
    if (!a.customer_id && !a.deleted_at) await customer(tx, a, p, now);
    if (checkoutId) {
      const [op] =
        await tx<Checkout>`select * from billing_checkouts where id = ${checkoutId} and account_id = ${a.id} for update`;
      if (op) {
        const next =
          op.status === "refund_pending" && op.refund_id
            ? op
            : await reconcileCheckout(tx, a, op, p, c, now);
        await refundFee(tx, a, next, p, now);
      }
    }
    if (invoice) {
      // Routing can happen before the lock, but persisted state must be fetched
      // after it. Otherwise two workers can invert a paid/open invoice update.
      invoice = await p.invoice(event.object_id);
      if (invoice.customerId !== a.customer_id) throw new Error("Invoice customer mismatch.");
      await tx`insert into billing_invoices (id, account_id, status, currency, amount_due, amount_paid, updated_at)
        values (${invoice.id}, ${a.id}, ${invoice.status}, ${invoice.currency}, ${invoice.amountDue}, ${invoice.amountPaid}, ${iso(now)})
        on conflict (id) do update set status = excluded.status, currency = excluded.currency,
          amount_due = excluded.amount_due, amount_paid = excluded.amount_paid, updated_at = excluded.updated_at`;
    }
    await refreshMembership(tx, a, p, c, now);
    await tx`update billing_webhook_events set status = 'processed', processed_at = ${iso(now)} where id = ${event.id}`;
  });
}

async function cleanupAccount(
  sql: Sql,
  accountId: string,
  p: BillingProvider,
  c: BillingConfig,
  now: number,
) {
  const [ref] = await sql<Account>`select * from billing_accounts where id = ${accountId}`;
  if (!ref) return;
  await sql.transaction(async (tx) => {
    const { account: a } = await lockAccount(tx, ref.profile_id, c, false, true, now);
    const [job] = await tx<{
      status: string;
      provider_deleted_at: Date | null;
    }>`select status, provider_deleted_at from billing_deletion_queue where account_id = ${a.id} for update`;
    if (job?.status !== "pending") return;
    // A lost customer-create response must be reconciled before redaction.
    if (!a.customer_id && a.customer_attempt_at) {
      const found = await p.findCustomer(a.id);
      if (!found) {
        // Search is eventually consistent. Leave a durable retry for 24h.
        if (now - +new Date(a.customer_attempt_at) < 86_400_000)
          throw new Error("Customer creation reconciliation pending.");
      } else {
        a.customer_id = found;
        await tx`update billing_accounts set customer_id = ${found} where id = ${a.id}`;
      }
    }
  });
  // Commit any recovered customer reference BEFORE its deletion. If the
  // deletion response is lost, the next attempt can retrieve that same deleted
  // customer; it never has to search for a now-redacted metadata record.
  await sql.transaction(async (tx) => {
    const { account: a } = await lockAccount(tx, ref.profile_id, c, false, true, now);
    const [job] = await tx<{ status: string; provider_deleted_at: Date | null }>`
      select status, provider_deleted_at from billing_deletion_queue where account_id = ${a.id} for update`;
    if (job?.status !== "pending") return;
    if (!job.provider_deleted_at) {
      if (a.customer_id) await p.deleteCustomer(a.customer_id);
      await tx`update billing_deletion_queue set provider_deleted_at = ${iso(now)} where account_id = ${a.id}`;
    }
    await tx`update billing_accounts set membership_status = 'canceled', cancel_at_period_end = false,
      stripe_credit_cents = 0, reconciled_at = ${iso(now)} where id = ${a.id}`;
  });
  // Monetary recovery is independent of subscription cancellation. A refund
  // endpoint or old Checkout failure must not keep the deleted member billable.
  await sql.transaction(async (tx) => {
    const { account: a } = await lockAccount(tx, ref.profile_id, c, false, true, now);
    const [job] = await tx<{ status: string; provider_deleted_at: Date | null }>`
      select status, provider_deleted_at from billing_deletion_queue where account_id = ${a.id} for update`;
    if (job?.status !== "pending" || !job.provider_deleted_at) return;
    if (a.customer_id) {
      const ops = await tx<Checkout>`select * from billing_checkouts where account_id = ${a.id}
        and status not in ('refunded','expired','failed') and (cancel_requested or status = 'refund_pending' or ledger_id in
          (select id from ledger_events where status = 'waived')) for update`;
      for (const op of ops) {
        const next =
          op.status === "refund_pending" && op.refund_id
            ? op
            : await reconcileCheckout(tx, a, op, p, c, now);
        if (!next.session_id)
          await tx`update billing_checkouts set status = 'review_required', updated_at = ${iso(now)} where id = ${op.id}`;
        await refundFee(tx, a, next, p, now);
      }
    }
    const waiting = await tx`select id from billing_checkouts where account_id = ${a.id}
      and status in ('refund_pending','review_required') limit 1`;
    if (!waiting.length)
      await tx`update billing_deletion_queue set status = 'completed', completed_at = ${iso(now)} where account_id = ${a.id}`;
  });
}

/** Reconciliation/refunds/redaction continue when new payments are switched off. */
export async function sweepBilling(
  sql: Sql,
  now = Date.now(),
  limit = 10,
  options: BillingOptions = {},
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("Invalid billing sweep limit.");
  const config = options.config ?? billingConfig();
  const p = options.provider ?? (config.secretKey ? stripeProvider(config) : null);
  const result = { events: 0, accounts: 0, deletions: 0, errors: 0, configured: !!p };
  if (!p) return result;
  const events =
    await sql<Event>`select id, type, object_id, customer_id from billing_webhook_events
    where status = 'pending' order by attempted_at nulls first, received_at, id limit ${limit}`;
  for (const e of events) {
    await sql`update billing_webhook_events set attempted_at = ${iso(now)} where id = ${e.id}`;
    try {
      await reconcileEvent(sql, e, p, config, now);
      result.events++;
    } catch {
      await sql`update billing_webhook_events set attempts = attempts + 1 where id = ${e.id}`;
      result.errors++;
    }
  }
  const accounts =
    await sql<Account>`select * from billing_accounts where deleted_at is null and livemode = ${config.livemode}
    order by reconcile_attempt_at nulls first, id limit ${limit}`;
  for (const ref of accounts) {
    await sql`update billing_accounts set reconcile_attempt_at = ${iso(now)} where id = ${ref.id}`;
    try {
      await sql.transaction(async (tx) => {
        const { account: a } = await lockAccount(tx, ref.profile_id, config, false, true, now);
        if (a.deleted_at) return;
        // A background worker never starts a customer or checkout purchase; it
        // can only recover provider references from a member-initiated attempt.
        if (!a.customer_id) {
          const found = await p.findCustomer(a.id);
          if (found) {
            a.customer_id = found;
            await tx`update billing_accounts set customer_id = ${found} where id = ${a.id}`;
          }
        }
        if (!a.customer_id) return;
        await refreshMembership(tx, a, p, config, now);
      });
      // Preserve a fresh subscription snapshot even if an unrelated fee or
      // credit needs provider support. This phase cannot roll it back.
      await sql.transaction(async (tx) => {
        const { account: a } = await lockAccount(tx, ref.profile_id, config, false, true, now);
        if (a.deleted_at || !a.customer_id) return;
        const ops = await tx<Checkout>`select * from billing_checkouts where account_id = ${a.id}
          and status not in ('refunded','expired','failed') order by updated_at, id limit 20 for update`;
        for (const op of ops) {
          let current =
            op.status === "refund_pending" && op.refund_id
              ? op
              : await reconcileCheckout(tx, a, op, p, config, now);
          if (!current.session_id && now >= +new Date(current.expires_at)) {
            const [next] =
              await tx<Checkout>`update billing_checkouts set status = 'review_required', updated_at = ${iso(now)} where id = ${op.id} returning *`;
            current = next;
          }
          await refundFee(tx, a, current, p, now);
        }
        await exportCredits(tx, a, p, now);
        // Reflect an exported credit in the same commit that removes it from
        // the local pending balance. The earlier committed subscription refresh
        // still survives any failure in this financial recovery phase.
        await refreshMembership(tx, a, p, config, now);
      });
      result.accounts++;
    } catch {
      result.errors++;
    }
  }
  // A later waiver or refund event can arrive after the sign-in identity and
  // provider customer were removed. Reopen monetary recovery without recreating
  // the customer or restoring app access.
  await sql`insert into billing_deletion_queue (account_id, created_at)
    select distinct a.id, ${iso(now)}::timestamptz from billing_accounts a
    join billing_checkouts o on o.account_id = a.id left join ledger_events l on l.id = o.ledger_id
    where a.deleted_at is not null and (o.status = 'refund_pending' or
      (l.status = 'waived' and o.status in ('creating','open','completed')))
    on conflict (account_id) do update set status = 'pending', completed_at = null
      where billing_deletion_queue.status = 'completed'`;
  const deleted = await sql<{ account_id: string }>`select account_id from billing_deletion_queue
    where status = 'pending' order by attempted_at nulls first, created_at limit ${limit}`;
  for (const row of deleted) {
    await sql`update billing_deletion_queue set attempted_at = ${iso(now)} where account_id = ${row.account_id}`;
    try {
      await cleanupAccount(sql, row.account_id, p, config, now);
      result.deletions++;
    } catch {
      await sql`update billing_deletion_queue set attempts = attempts + 1 where account_id = ${row.account_id}`;
      result.errors++;
    }
  }
  return result;
}
