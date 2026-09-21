-- Identity verification (PRD v0.3 §8). A provider (Persona) sees the selfie, the
-- phone number and the ID; SamePace stores which check it was, the provider's
-- reference, and how it came out. No image, number or document is ever stored here.

create table if not exists verifications (
  id text primary key,
  profile_id text not null references profiles (id),
  -- member: phone + selfie liveness, before any public session.
  -- government_id: for women-only sessions, and after a report is acted on.
  -- background: reserved. Nothing starts one — see docs/API.md.
  tier text not null check (tier in ('member', 'government_id', 'background')),
  provider text not null check (provider in ('persona', 'dev')),
  -- The provider's inquiry id. Unique, so a webhook can only ever move our own row.
  provider_ref text,
  status text not null default 'created' check (status in (
    'created', 'pending', 'needs_review', 'approved', 'declined', 'failed', 'expired'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists verifications_provider_ref_idx
  on verifications (provider, provider_ref) where provider_ref is not null;
create index if not exists verifications_profile_idx
  on verifications (profile_id, tier, created_at desc);

-- Webhooks are delivered at least once. An event id seen before is dropped.
create table if not exists verification_events (
  id text primary key,
  received_at timestamptz not null default now()
);

alter table profiles add column if not exists verified_member_at timestamptz;
alter table profiles add column if not exists verified_id_at timestamptz;
-- Set when a report about this member is acted on: government ID before any more
-- public sessions.
alter table profiles add column if not exists id_required_at timestamptz;
