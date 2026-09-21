-- Provider references and amounts only. Hosted Stripe pages own card details.
create table billing_accounts (
  id text primary key,
  profile_id text not null unique references profiles(id),
  customer_id text unique,
  livemode boolean not null,
  customer_attempt_at timestamptz,
  membership_status text not null default 'none',
  subscription_id text,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_credit_cents integer not null default 0 check (stripe_credit_cents >= 0),
  reconciled_at timestamptz,
  reconcile_attempt_at timestamptz,
  last_member_refresh_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create table billing_checkouts (
  id text primary key,
  account_id text not null references billing_accounts(id),
  request_id text not null check (length(request_id) between 1 and 100),
  kind text not null check (kind in ('membership','fee')),
  ledger_id text references ledger_events(id),
  amount_cents integer not null check (amount_cents > 0),
  terms_hash text not null,
  price_id text,
  return_url text not null,
  status text not null default 'creating' check (status in
    ('creating','open','completed','expired','refund_pending','refunded','failed','review_required')),
  session_id text unique,
  payment_intent_id text unique,
  subscription_id text,
  refund_id text,
  cancel_requested boolean not null default false,
  url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'fee') = (ledger_id is not null)),
  unique (account_id, request_id)
);
create unique index billing_pending_membership on billing_checkouts(account_id)
  where kind = 'membership' and status in ('creating','open');
create unique index billing_unsettled_fee on billing_checkouts(ledger_id)
  where kind = 'fee' and status in ('creating','open','completed','refund_pending','review_required');
create table billing_disputes (
  id text primary key,
  ledger_id text not null unique references ledger_events(id),
  profile_id text not null references profiles(id),
  reason text not null check (length(reason) between 10 and 1000),
  status text not null default 'open' check (status in ('open','waived','upheld')),
  resolution_note text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create table billing_invoices (
  id text primary key,
  account_id text not null references billing_accounts(id),
  status text not null,
  currency text not null,
  amount_due integer not null,
  amount_paid integer not null,
  updated_at timestamptz not null default now()
);
create table billing_webhook_events (
  id text primary key,
  type text not null,
  object_id text not null,
  customer_id text,
  status text not null default 'pending' check (status in ('pending','processed','ignored')),
  attempts integer not null default 0,
  attempted_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index billing_events_pending on billing_webhook_events(received_at) where status = 'pending';
create table billing_credit_exports (
  ledger_id text primary key references ledger_events(id),
  account_id text not null references billing_accounts(id),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','applied','review_required')),
  provider_id text unique,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create table billing_deletion_queue (
  account_id text primary key references billing_accounts(id),
  status text not null default 'pending' check (status in ('pending','completed')),
  attempts integer not null default 0,
  attempted_at timestamptz,
  provider_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
