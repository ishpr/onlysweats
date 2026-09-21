# Hosted billing

The Stripe adapter, member billing screen, fee support queue, webhook intake, reconciliation worker, and membership gates are implemented. Payments are **off by default**. Stripe test mode is configured on an isolated Vercel Preview; production collection and membership enforcement remain off. Live credentials and real payment acceptance have not been supplied or tested. Local tests use synthetic provider state and a local HTTP server exercising the official `stripe` SDK (22.6.2 in the lockfile).

## Configured test environment

The Servesys Corporation Stripe account has the following test-mode resources:

| Resource           | ID / configuration                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Membership product | `prod_VIZMIk3NKzOllT` — SamePace Membership                                                                                    |
| Recurring price    | `price_1UHyDWLmLwBE307y1wU8vBtO` — USD 1200 every month                                                                        |
| Customer portal    | `bpc_1UHyG5LmLwBE307ykPCY1NCK` — payment-method updates, invoice history and cancellation at period end; plan changes disabled |
| Active webhook     | `we_1UHyeOLmLwBE307yb9IKG4ga` — the 18 events below, API version `2026-08-26.dahlia`                                           |

Test credentials are server-side, restricted to Vercel Preview branch
`codex/persona-provider-setup`, with a separate Preview database and cron secret.
The stable test host is
`samepace-git-codex-backlog-completion-servesys-labs.vercel.app`.
Its webhook uses a dedicated project protection-bypass token; the endpoint still
requires Stripe's signature and application routes still require member sign-in.
Do not publish the token-bearing webhook URL. The earlier endpoint
`we_1UHyJZLmLwBE307yD33lApHB` is disabled.

A disposable synthetic member completed a hosted Stripe test-card checkout for
$12. The real signed provider webhook arrived, reconciliation processed four
events and one account without errors, and the membership became active with a
future period end. The app-created portal showed the paid invoice and allowed
cancellation; its confirmation retained access until October 20, 2026.
No real card or member health record was used.

This test exposed a Stripe response variant: the portal set `cancel_at` to the
paid period end while `cancel_at_period_end` remained false. The adapter now
recognizes that scheduled cancellation and caps access at an earlier
`cancel_at`, without extending the paid period. The deployed correction was
verified against the actual test subscription: the app reported scheduled
cancellation while membership remained active through its paid period.

Cleanup then invalidated the test member's session, removed its sign-in record,
scrubbed its profile and completed the provider-deletion job with zero worker
errors. Stripe confirmed the test customer was deleted and its subscription
canceled. No outstanding test subscription or pending provider event remained.

The browser return reached Vercel's Preview sign-in gate. This proves the
provider redirect was issued, not a complete physical-device return flow.
3DS, failed renewal, refunds, event replay/reordering and outage recovery still
need actual-provider acceptance. A successful test payment does not authorize
live collection or establish the cluster-density gate for launch.

## Operator setup

Start in Stripe **test mode**, with separate test data and credentials. Apply migration `0022_billing.sql` before running the API or worker.

| Server environment variable      | Meaning                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BILLING_ENABLED`                | Literal `true` permits member-initiated checkout. Default false.                                                                                           |
| `BILLING_CLUSTER_READY`          | Literal `true` is the operator's explicit cluster-readiness gate. Default false.                                                                           |
| `BILLING_ENFORCED`               | Literal `true`, together with the preceding two flags, requires membership for new workout commitments after two completed workouts. Default false.        |
| `STRIPE_SECRET_KEY`              | Server-only `sk_test_…` initially; eventual live setup uses `sk_live_…`. Never embed this in Expo/public environment variables.                            |
| `STRIPE_WEBHOOK_SECRET`          | `whsec_…` signing secret for this deployment's webhook endpoint.                                                                                           |
| `STRIPE_MEMBERSHIP_PRICE_ID`     | Active Stripe recurring Price: **USD 1200 cents, every one month**, quantity one. The server retrieves and validates it before membership checkout.        |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Active `bpc_…` configuration with subscription cancellation and payment-method updates enabled, and subscription plan changes disabled.                    |
| `BILLING_RETURN_URL`             | Absolute HTTPS URL on the deployed SamePace site, normally `https://<deployment>/billing-return`; configure that host's app links for the physical device. |
| `CRON_SECRET`                    | Existing server cron credential; the deployment must actually run `/api/cron/settle` every ten minutes.                                                    |

Create the fixed membership Product/Price and portal configuration in Stripe. Set provider credentials and IDs on the server deployment. Configure the HTTPS webhook endpoint **`/api/webhooks/stripe`**, using its own signing secret. The configured secret key, Price and webhook events must use the same Stripe mode. Connect-account events and unexpected live/test mode are rejected. A member's test billing account cannot silently switch to live mode; use clean launch data or an operator-reviewed migration.

Enable these events:

- `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `invoice.paid`, `invoice.payment_failed`, `invoice.updated`, `invoice.voided`, `invoice.finalized`
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
- `refund.created`, `refund.updated`, `refund.failed`

Webhook intake verifies the **unaltered request body** with the official SDK and a five-minute timestamp bound. It stores event/object/customer IDs rather than card details or event payloads. Duplicate event IDs are harmless. The worker retrieves current provider state under the account lock before persisting it; it does not treat event order or the browser return URL as proof of payment. Stripe documents that delivery order is not guaranteed: [webhooks](https://docs.stripe.com/webhooks), [signature verification](https://docs.stripe.com/webhooks/signature).

## Member and support behavior

Member routes are under `/api/v1`:

| Route                                      | Body / result                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET /billing`                             | Current owner-only `BillingSummary`; no provider account is created.                                                 |
| `POST /billing/refresh`                    | Strict `{}`. Reconciles after returning from Stripe, with a persisted 30-second owner throttle; returns the summary. |
| `POST /billing/membership/checkout`        | `{requestId, termsHash}` from the latest summary; returns `{url}`.                                                   |
| `POST /billing/fees/:id/checkout`          | Same body; the fee must belong to the member and match the current server ledger and terms.                          |
| `POST /billing/portal`                     | `{requestId}`; returns the secure management URL.                                                                    |
| `POST /billing/fees/:id/dispute`           | `{reason}` with 10–1000 trimmed characters; returns the summary.                                                     |
| `GET /admin/billing/disputes`              | Existing admin authorization; returns `{disputes}`.                                                                  |
| `POST /admin/billing/disputes/:id/resolve` | `{resolution: "waive" \| "uphold", note}`; note 10–1000 trimmed characters; returns `{disputes}`.                    |

The first two **completed** workouts are free. Membership checkout displays $12 USD/month and requires the member's explicit action. Only server-selected amounts, customer references and return URLs reach Stripe. The server and mobile client allow hosted URLs only on `checkout.stripe.com` and `billing.stripe.com`. A lost/cancelled browser visit can resume the same open checkout after a remount; new request IDs do not create duplicate active purchases.

Session fees use explicit, individual Checkout payments. There is no automatic off-session fee charging. An assessed fee must pass its existing hold (`chargeable_at`) before checkout. A dispute holds an unpaid fee and expires its open checkout. Filing a dispute on an already-paid fee waits for support; it does **not** automatically refund the charge. A waiver, including an automatic covered-seat waiver, queues cancellation/refund. If payment wins a race with cancellation of an observed unpaid checkout, the worker refunds it. Bank/provider disputes and ambiguous partial refunds require review.

Show-up credits are exported once as negative USD customer invoice balance for membership invoices. They cannot be cashed out or spent on session fees. See [customer balance transactions](https://docs.stripe.com/api/customer_balance_transactions/create).

Failed/past-due membership payments remain visible and manageable in the portal. With enforcement off, billing does not restrict healthy manual or social use. With enforcement on, only new hosting, bookings, recurrence occurrences and training commitments are gated after two completions; existing workouts, check-ins, cancellations, safety actions and billing management remain available. New recurring occurrences defer when the gate fails; previously created sessions remain intact. Enforced membership requires a current active/trialing subscription period and provider reconciliation within 24 hours.

Turning sales/enforcement flags off **does not cancel an existing Stripe subscription**. Its recurring charge continues until the member cancels through the portal or account-deletion processing cancels it. Keep provider credentials, the webhook and the worker operational while any subscription, refund, or deletion job remains.

Account deletion queues provider cleanup before scrubbing the sign-in/profile. The worker first commits any recovered customer reference, then independently deletes the Stripe customer and commits its cancellation milestone. Customer deletion cancels subscriptions and removes saved payment methods. Checkout cancellation and fee refunds recover separately, so a failed refund cannot leave the subscription billable. A lost deletion response retries the retained customer ID; a lost checkout response can recover by its durable operation/account metadata even after Stripe clears the customer link. Provider financial records follow Stripe's retention rules; the app retains internal financial references and fee-review audit records. Pending refunds continue after customer deletion, and a later waiver reopens monetary recovery. See [customer deletion](https://docs.stripe.com/api/customers/delete).

## Recovery and acceptance still required

Checkout identities are committed before external calls. Customer, checkout, credit and refund retries use stable provider idempotency/metadata references; profile/account locks serialize local reconciliation, support changes, and deletion. Subscription refresh commits independently from fee/credit recovery so an unrelated fee failure does not stale that member's entitlement. Provider calls have an eight-second timeout and no SDK retries. History searches are bounded at 100 results and stop for operator review when the correct object cannot be established. The worker rotates attempts across failed accounts/events/deletion jobs to prevent starvation.

Inspect the cron's billing error counts and pending `billing_webhook_events`, `billing_deletion_queue`, `billing_credit_exports`, and `billing_checkouts`. A `review_required` checkout or failed refund requires an operator to inspect Stripe and the matching internal operation; this release has no generic dashboard button that safely resolves every provider ambiguity. Do not clear references or start another charge without reconciling the original. Stripe's idempotency retention is finite, so durable metadata checks are necessary: [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [refunds](https://docs.stripe.com/api/refunds/create).

Before enabling a live cluster, complete test-mode hosted checkout/3DS, cancellation, failed renewal, duplicate and reordered webhook delivery, dispute/waiver/refund, deleted-customer delayed refund, worker outage/recovery, and physical-device browser return acceptance using the actual account. Verify the cron plan can meet the ten-minute schedule and the worker capacity keeps reconciliation within 24 hours. The current worker processes at most ten accounts, ten events and ten deletions per scheduled invocation (plus bounded per-account operations); scale scheduling/throughput before growth exceeds that capacity.

Business account activation, settlement details, refund/support policy, recurring-payment disclosures, tax obligations and live deployment approval remain operator work. Automatic tax, promotions, alternate plans, and other currencies are not implemented. Do not enable live payments until those product and operational decisions are complete.

Focused local checks:

```sh
node --experimental-strip-types --test src/lib/billing/billing.test.ts src/lib/billing/provider.test.ts src/lib/billing/entitlement.test.ts
SAMEPACE_TEST_DATABASE_URL='<disposable local PostgreSQL URL>' node --experimental-strip-types --test src/lib/billing/billing.postgres.test.ts
```
