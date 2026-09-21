-- Materialize each notification/device pair before attempting delivery. Legacy
-- sent notifications are deliberately not replayed: their successful devices
-- cannot be reconstructed from the old ticket rows.
create table push_deliveries (
  id text primary key,
  notification_id text not null references notifications (id) on delete cascade,
  token text not null,
  state text not null default 'pending'
    check (state in ('pending', 'sending', 'ticket', 'delivered', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  unique (notification_id, token)
);
create index push_deliveries_due_idx on push_deliveries (next_attempt_at)
  where state in ('pending', 'sending');

-- Nullable so receipts created by older deployments remain readable. They can
-- still retire dead devices, but cannot safely replay an unknown notification.
alter table push_tickets add column delivery_id text references push_deliveries (id) on delete cascade;
alter table push_tickets add column checks int not null default 0;
alter table push_tickets add column next_check_at timestamptz;
update push_tickets set next_check_at = created_at + interval '15 minutes';
alter table push_tickets alter column next_check_at set default now() + interval '15 minutes';
alter table push_tickets alter column next_check_at set not null;
create index push_tickets_due_idx on push_tickets (next_check_at);

-- Separate from the deleted identity; only an encrypted provider credential is
-- retained for up to seven days. Finished/exhausted jobs have it scrubbed.
create table apple_revocation_jobs (
  id text primary key,
  refresh_token_enc text unique,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'succeeded', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  expires_at timestamptz not null,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index apple_revocation_jobs_due_idx on apple_revocation_jobs (next_attempt_at)
  where state in ('pending', 'processing');
