-- Committed before an external create, so unknown results survive retries and
-- account deletion. Replay data is opaque and contains no profile reference.
create table if not exists persona_creation_intents (
  id text primary key,
  profile_id text references profiles(id) on delete set null,
  tier text check (tier in ('member', 'government_id')),
  template_id text not null,
  provider_environment text not null check (provider_environment in ('sandbox', 'production')),
  binding_version integer not null check (binding_version = 1),
  idempotency_key text not null unique,
  provider_ref text unique,
  provider_account_ref text,
  first_dispatched_at timestamptz,
  attempts integer not null default 0,
  cancel_requested boolean not null default false,
  state text not null default 'pending' check (state in ('pending', 'review_required')),
  review_reason text check (review_reason in ('replay_expired', 'account_detected', 'inconsistent_inquiry')),
  next_attempt_at timestamptz not null,
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((lease_token is null) = (lease_until is null))
);
create unique index if not exists persona_creation_intents_owner_idx
  on persona_creation_intents(profile_id, tier) where profile_id is not null;
create index if not exists persona_creation_intents_due_idx
  on persona_creation_intents(provider_environment, next_attempt_at) where state = 'pending';
