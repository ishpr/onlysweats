import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { PaceError } from "../pace/service.server.ts";
import type { BillingDispute, BillingFee, BillingSummary } from "../../../shared/billing.ts";
import {
  billingConfig,
  stripeProvider,
  stripeUrl,
  type BillingConfig,
  type BillingProvider,
} from "./provider.server.ts";
import {
  customer,
  exportCredits,
  fee,
  iso,
  lockAccount,
  reconcileCheckout,
  refreshMembership,
  validatePrice,
  type Account,
  type Checkout,
  type Fee,
} from "./store.server.ts";

export type BillingOptions = { config?: BillingConfig; provider?: BillingProvider; now?: number };
const context = (options: BillingOptions) => {
  const config = options.config ?? billingConfig();
  return {
    config,
    provider: options.provider ?? (config.secretKey ? stripeProvider(config) : null),
    now: options.now ?? Date.now(),
  };
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const checkoutBody = z
  .object({
    requestId: z.string().trim().min(1).max(100),
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const membershipTerms = (userId: string, c: BillingConfig) =>
  hash(["membership-v1", userId, c.priceId, 1200, "usd", "month", c.livemode]);
const feeTerms = (f: Fee, c: BillingConfig) =>
  hash([
    "fee-v1",
    f.id,
    f.profile_id,
    f.kind,
    f.amount_cents,
    f.status,
    f.chargeable_at ? iso(f.chargeable_at) : null,
    c.livemode,
  ]);
function activeMembership(a: Account | undefined, now: number) {
  return (
    !!a &&
    !a.deleted_at &&
    ["active", "trialing"].includes(a.membership_status) &&
    !!a.period_end &&
    +new Date(a.period_end) > now
  );
}
function paymentEnabled(c: BillingConfig, p: BillingProvider | null): asserts p is BillingProvider {
  if (!c.enabled || !c.clusterReady || !c.configured || !p)
    throw new PaceError(409, "Payments are not enabled for this cluster.");
}
function feePayable(f: Fee, now: number) {
  return f.status === "assessed" && !!f.chargeable_at && +new Date(f.chargeable_at) <= now;
}
const paymentState = (op: Checkout | undefined): BillingFee["paymentStatus"] => {
  if (!op) return "unpaid";
  if (op.status === "completed") return "paid";
  if (["creating", "open"].includes(op.status)) return "checkout_open";
  if (op.status === "refund_pending") return "refund_pending";
  if (op.status === "refunded") return "refunded";
  if (op.status === "review_required") return "review_required";
  return op.status === "expired" ? "unpaid" : "failed";
};

export async function getBilling(
  sql: Sql,
  userId: string,
  options: BillingOptions = {},
): Promise<BillingSummary> {
  const config = options.config ?? billingConfig(),
    now = options.now ?? Date.now();
  const [person] = await sql<{
    completed_count: number;
    deleted_at: Date | null;
    credit_cents: number;
    suspended_at: Date | null;
  }>`
    select completed_count, deleted_at, credit_cents, suspended_at from profiles where id = ${userId}`;
  if (!person || person.deleted_at) throw new PaceError(404, "Billing unavailable.");
  const [account] = await sql<Account>`select * from billing_accounts where profile_id = ${userId}`;
  const rightMode = !account || account.livemode === config.livemode;
  const active = rightMode && activeMembership(account, now);
  const ops = account
    ? await sql<Checkout>`select * from billing_checkouts where account_id = ${account.id} order by created_at desc, id desc`
    : [];
  const ledger =
    await sql<Fee>`select l.*, s.title session_title from ledger_events l left join sessions s on s.id = l.session_id
    where l.profile_id = ${userId} and l.kind in ('late_cancel_fee','no_show_fee') order by l.created_at desc limit 100`;
  const disputes = await sql<{
    id: string;
    ledger_id: string;
    status: BillingDispute["status"];
    reason: string;
    resolution_note: string | null;
  }>`
    select id, ledger_id, status, reason, resolution_note from billing_disputes where profile_id = ${userId}`;
  const ready =
    config.enabled &&
    config.clusterReady &&
    config.configured &&
    rightMode &&
    !account?.deleted_at &&
    !person.suspended_at;
  const pendingMembership = ops.some(
    (op) => op.kind === "membership" && op.status === "review_required",
  );
  const blockedSubscription =
    account && !["none", "canceled", "incomplete_expired"].includes(account.membership_status);
  const reason = !ready
    ? "Payments are not enabled for this account and cluster."
    : person.completed_count < 2
      ? "Your first two completed workouts are free."
      : active
        ? "Your membership is active. Manage it in the secure billing portal."
        : blockedSubscription
          ? "Manage your existing membership or failed payment in the secure billing portal."
          : pendingMembership
            ? "A membership checkout is already pending. Resume it or wait for reconciliation."
            : null;
  return {
    enabled: config.enabled,
    configured: config.configured,
    clusterReady: config.clusterReady,
    enforced: config.enabled && config.clusterReady && config.enforced,
    monthlyCents: 1200,
    currency: "USD",
    freeSessionsLeft: Math.max(0, 2 - person.completed_count),
    membership: {
      status: rightMode ? (account?.membership_status ?? "none") : "unavailable",
      active,
      periodEnd: account?.period_end ? iso(account.period_end) : null,
      cancelAtPeriodEnd: account?.cancel_at_period_end ?? false,
    },
    membershipCheckout: {
      available: reason === null,
      resume: ops.some(
        (op) => op.kind === "membership" && ["creating", "open"].includes(op.status),
      ),
      termsHash: membershipTerms(userId, config),
      reason,
    },
    portalAvailable:
      config.configured && rightMode && !!account?.customer_id && !account.deleted_at,
    creditCents: person.credit_cents + (account?.stripe_credit_cents ?? 0),
    fees: ledger.map((f) => {
      const op = ops.find((o) => o.ledger_id === f.id),
        d = disputes.find((x) => x.ledger_id === f.id);
      const payState = paymentState(op);
      return {
        id: f.id,
        kind: f.kind as BillingFee["kind"],
        amountCents: f.amount_cents,
        status: f.status as BillingFee["status"],
        paymentStatus: payState,
        chargeableAt: f.chargeable_at ? iso(f.chargeable_at) : null,
        createdAt: iso(f.created_at),
        sessionTitle: f.session_title ?? null,
        bookingId: f.booking_id,
        termsHash: feeTerms(f, config),
        canPay:
          ready &&
          feePayable(f, now) &&
          ["unpaid", "failed", "refunded", "checkout_open"].includes(payState),
        dispute: d
          ? { id: d.id, status: d.status, reason: d.reason, resolutionNote: d.resolution_note }
          : null,
      };
    }),
  };
}

/** Disabled by default. Call only for creating/joining future sessions, never safety or check-in. */
export async function assertMembershipEntitled(sql: Sql, userId: string, now = Date.now()) {
  const c = billingConfig();
  if (!c.enabled || !c.clusterReady || !c.enforced) return;
  const [p] = await sql<{
    completed_count: number;
  }>`select completed_count from profiles where id = ${userId}`;
  if (!p || p.completed_count < 2) return;
  const [a] = await sql<Account>`select * from billing_accounts where profile_id = ${userId}`;
  if (
    !c.configured ||
    a?.livemode !== c.livemode ||
    !activeMembership(a, now) ||
    !a?.reconciled_at ||
    now - +new Date(a.reconciled_at) > 86_400_000
  )
    throw new PaceError(
      403,
      "An active membership is required for new workouts in this cluster. Review Billing.",
    );
}

async function checkout(
  sql: Sql,
  userId: string,
  ledgerId: string | null,
  body: unknown,
  options: BillingOptions,
) {
  const input = checkoutBody.parse(body);
  const { config, provider, now } = context(options);
  paymentEnabled(config, provider);
  if (!ledgerId) await validatePrice(provider, config);
  // Commit the operation identity before contacting Stripe. Retrying after a
  // lost response uses this same operation and cannot create a second checkout.
  const id = await sql.transaction(async (tx) => {
    const { person, account: a } = await lockAccount(tx, userId, config, true, false, now);
    if (person.suspended_at || a.deleted_at)
      throw new PaceError(403, "This account cannot begin a payment.");
    const [prior] =
      await tx<Checkout>`select * from billing_checkouts where account_id = ${a.id} and request_id = ${input.requestId}`;
    if (prior) {
      if (prior.ledger_id !== ledgerId || prior.terms_hash !== input.termsHash)
        throw new PaceError(409, "That request ID belongs to another checkout.");
      return prior.id;
    }
    const f = ledgerId ? await fee(tx, userId, ledgerId) : null;
    const expected = f ? feeTerms(f, config) : membershipTerms(userId, config);
    if (input.termsHash !== expected)
      throw new PaceError(409, "Payment terms changed. Review them before paying.");
    if (f && !feePayable(f, now))
      throw new PaceError(409, "This fee is on hold, disputed, or waived.");
    if (!f && person.completed_count < 2)
      throw new PaceError(409, "Your first two completed workouts are free.");
    if (!f && a.customer_id) {
      await refreshMembership(tx, a, provider, config, now);
      if (!["none", "canceled", "incomplete_expired"].includes(a.membership_status))
        throw new PaceError(409, "Manage your existing membership in the billing portal.");
    }
    const existing = await tx<Checkout>`select * from billing_checkouts where account_id = ${a.id}
      and ((${ledgerId}::text is null and kind = 'membership') or ledger_id = ${ledgerId})
      and status in ('creating','open','review_required','refund_pending','completed') order by created_at desc`;
    for (const prior of existing) {
      const current = a.customer_id
        ? await reconcileCheckout(tx, a, prior, provider, config, now)
        : prior;
      if (["creating", "open"].includes(current.status) && current.terms_hash === expected)
        return current.id;
      if (["expired", "refunded", "failed"].includes(current.status)) continue;
      if (current.kind === "fee" || current.status !== "completed")
        throw new PaceError(
          409,
          "A payment is already pending or settled. Refresh Billing before starting another.",
        );
    }
    const opId = randomUUID();
    await tx`insert into billing_checkouts (id, account_id, request_id, kind, ledger_id, amount_cents,
      terms_hash, price_id, return_url, expires_at, created_at, updated_at)
      values (${opId}, ${a.id}, ${input.requestId}, ${f ? "fee" : "membership"}, ${ledgerId}, ${f?.amount_cents ?? 1200},
        ${expected}, ${f ? null : config.priceId}, ${config.returnUrl}, ${iso(now + 3_600_000)}, ${iso(now)}, ${iso(now)})`;
    return opId;
  });
  return sql.transaction(async (tx) => {
    const { person, account: a } = await lockAccount(tx, userId, config, false, false, now);
    const [op] =
      await tx<Checkout>`select * from billing_checkouts where id = ${id} and account_id = ${a.id} for update`;
    if (!op || a.deleted_at || person.suspended_at)
      throw new PaceError(409, "This checkout is no longer available.");
    const customerId = await customer(tx, a, provider, now);
    let current = await reconcileCheckout(tx, a, op, provider, config, now);
    if (!current.session_id) {
      if (current.cancel_requested || +new Date(current.expires_at) - now < 30 * 60_000)
        throw new PaceError(
          409,
          "This checkout needs reconciliation before a fresh payment can start.",
        );
      if (ledgerId && !feePayable(await fee(tx, userId, ledgerId), now))
        throw new PaceError(409, "This fee is on hold, disputed, or waived.");
      if (!ledgerId) {
        await refreshMembership(tx, a, provider, config, now);
        if (!["none", "canceled", "incomplete_expired"].includes(a.membership_status))
          throw new PaceError(409, "Manage your existing membership in the billing portal.");
        await exportCredits(tx, a, provider, now);
      }
      const created = await provider.createCheckout(
        {
          id: op.id,
          accountId: a.id,
          customerId,
          kind: op.kind,
          amountCents: op.amount_cents,
          priceId: op.price_id,
          returnUrl: op.return_url,
          expiresAt: +new Date(op.expires_at),
        },
        `samepace-checkout-${op.id}`,
      );
      // Provider IDs only bind after the returned object proves its owner and
      // server-created operation reference. A webhook racing this write uses the
      // same reference and the same account lock.
      current = await reconcileCheckout(
        tx,
        a,
        { ...op, session_id: created.id },
        provider,
        config,
        now,
      );
    }
    if (current.status !== "open" || !current.url)
      throw new PaceError(409, "This checkout is complete or unavailable. Refresh Billing.");
    return { url: stripeUrl(current.url, "checkout") };
  });
}
export const createMembershipCheckout = (
  sql: Sql,
  userId: string,
  body: unknown,
  options: BillingOptions = {},
) => checkout(sql, userId, null, body, options);
export const createFeeCheckout = (
  sql: Sql,
  userId: string,
  feeId: string,
  body: unknown,
  options: BillingOptions = {},
) => checkout(sql, userId, feeId, body, options);

/** Existing subscribers retain cancellation/payment management even if new sales are disabled. */
export async function createPortal(
  sql: Sql,
  userId: string,
  body: unknown,
  options: BillingOptions = {},
) {
  const { requestId } = z
    .object({ requestId: z.string().min(1).max(100) })
    .strict()
    .parse(body);
  const { config, provider, now } = context(options);
  if (!config.configured || !provider)
    throw new PaceError(409, "Billing management is not configured.");
  return sql.transaction(async (tx) => {
    const { account: a } = await lockAccount(tx, userId, config, false, false, now);
    if (!a?.customer_id || a.deleted_at) throw new PaceError(409, "No active billing account.");
    return {
      url: stripeUrl(
        await provider.portal(
          a.customer_id,
          config.portalConfigurationId,
          config.returnUrl,
          `samepace-portal-${hash([a.id, requestId])}`,
        ),
        "portal",
      ),
    };
  });
}

/** Owner-triggered reconciliation after returning from Stripe. A persisted
 * 30-second throttle survives concurrent clients and failed provider requests. */
export async function refreshBilling(sql: Sql, userId: string, options: BillingOptions = {}) {
  const { config, provider, now } = context(options);
  if (!provider || !config.configured) return getBilling(sql, userId, options);
  const permitted = await sql.transaction(async (tx) => {
    const { account: a } = await lockAccount(tx, userId, config, false, false, now);
    if (!a?.customer_id || a.deleted_at) return false;
    const changed = await tx`update billing_accounts set last_member_refresh_at = ${iso(now)}
      where id = ${a.id} and (last_member_refresh_at is null or last_member_refresh_at <= ${iso(now - 30_000)}) returning id`;
    return changed.length === 1;
  });
  if (permitted)
    await sql.transaction(async (tx) => {
      const { account: a } = await lockAccount(tx, userId, config, false, false, now);
      if (!a?.customer_id || a.deleted_at) return;
      const ops = await tx<Checkout>`select * from billing_checkouts where account_id = ${a.id}
      and status in ('creating','open') order by created_at desc, id desc limit 2 for update`;
      for (const op of ops) await reconcileCheckout(tx, a, op, provider, config, now);
      await refreshMembership(tx, a, provider, config, now);
    });
  return getBilling(sql, userId, options);
}

export async function disputeFee(
  sql: Sql,
  userId: string,
  feeId: string,
  body: unknown,
  options: BillingOptions = {},
) {
  const { reason } = z
    .object({ reason: z.string().trim().min(10).max(1000) })
    .strict()
    .parse(body);
  const { config, now } = context(options);
  await sql.transaction(async (tx) => {
    await lockAccount(tx, userId, config, false, false, now);
    const f = await fee(tx, userId, feeId);
    const [prior] = await tx<{
      status: string;
      reason: string;
    }>`select status, reason from billing_disputes where ledger_id = ${f.id}`;
    if (prior) {
      if (prior.status === "open" && prior.reason === reason) return;
      throw new PaceError(
        409,
        "This fee already has a support review. Contact support to add information.",
      );
    }
    if (f.status === "waived") throw new PaceError(409, "This fee has already been waived.");
    await tx`insert into billing_disputes (id, ledger_id, profile_id, reason, created_at)
      values (${randomUUID()}, ${f.id}, ${userId}, ${reason}, ${iso(now)})`;
    await tx`update ledger_events set status = 'disputed' where id = ${f.id}`;
    // The sweep expires an actually unpaid checkout. Merely filing a dispute
    // must not refund a settled charge before support decides.
  });
  return getBilling(sql, userId, options);
}

/** Admin authentication is performed by the normal /admin route wrapper. */
export async function listBillingDisputes(sql: Sql): Promise<BillingDispute[]> {
  const rows = await sql<{
    id: string;
    profile_id: string;
    ledger_id: string;
    amount_cents: number;
    status: BillingDispute["status"];
    reason: string;
    resolution_note: string | null;
    created_at: Date;
    resolved_at: Date | null;
  }>`
    select d.*, l.amount_cents from billing_disputes d join ledger_events l on l.id = d.ledger_id
    order by (d.status = 'open') desc, d.created_at desc limit 100`;
  return rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    feeId: r.ledger_id,
    amountCents: r.amount_cents,
    status: r.status,
    reason: r.reason,
    resolutionNote: r.resolution_note,
    createdAt: iso(r.created_at),
    resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
  }));
}
export async function resolveBillingDispute(
  sql: Sql,
  adminId: string,
  disputeId: string,
  body: unknown,
  options: BillingOptions = {},
) {
  const input = z
    .object({ resolution: z.enum(["waive", "uphold"]), note: z.string().trim().min(10).max(1000) })
    .strict()
    .parse(body);
  const { config, now } = context(options);
  await sql.transaction(async (tx) => {
    const [ref] = await tx<{
      profile_id: string;
      ledger_id: string;
    }>`select profile_id, ledger_id from billing_disputes where id = ${disputeId}`;
    if (!ref) throw new PaceError(404, "No fee dispute.");
    await lockAccount(tx, ref.profile_id, config, false, true, now);
    await fee(tx, ref.profile_id, ref.ledger_id);
    const [d] = await tx<{
      status: string;
      resolution_note: string | null;
    }>`select status, resolution_note from billing_disputes where id = ${disputeId} for update`;
    const status = input.resolution === "waive" ? "waived" : "upheld";
    if (d.status !== "open") {
      if (d.status === status && d.resolution_note === input.note) return;
      throw new PaceError(409, "This dispute has already been resolved.");
    }
    await tx`update billing_disputes set status = ${status}, resolution_note = ${input.note}, resolved_by = ${adminId}, resolved_at = ${iso(now)} where id = ${disputeId}`;
    await tx`update ledger_events set status = ${status === "waived" ? "waived" : "assessed"} where id = ${ref.ledger_id}`;
    if (status === "waived")
      await tx`update billing_checkouts set cancel_requested = true, updated_at = ${iso(now)}
      where ledger_id = ${ref.ledger_id} and status in ('creating','open','completed')`;
  });
  return listBillingDisputes(sql);
}

/** Call inside account deletion's existing profile transaction, before scrubbing. */
export async function queueBillingDeletion(tx: Sql, userId: string, now = Date.now()) {
  const [a] =
    await tx<Account>`select * from billing_accounts where profile_id = ${userId} for update`;
  if (!a) return;
  await tx`update billing_accounts set deleted_at = coalesce(deleted_at, ${iso(now)}), membership_status = 'canceled' where id = ${a.id}`;
  await tx`update billing_checkouts set cancel_requested = true, updated_at = ${iso(now)}
    where account_id = ${a.id} and status in ('creating','open')`;
  await tx`insert into billing_deletion_queue (account_id, created_at) values (${a.id}, ${iso(now)}) on conflict do nothing`;
}
