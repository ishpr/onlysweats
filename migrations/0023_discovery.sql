-- Explicit, expiring member discovery is independent of preference sharing.
alter table agent_negotiations alter column booking_id drop not null;
create table agent_discovery_consents (
  profile_id text primary key references profiles(id) on delete cascade,
  enabled boolean not null default false,
  preference_revision integer not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index agent_discovery_active_idx on agent_discovery_consents(expires_at) where enabled;
-- Nullable booking_id marks an invitation between new partners. Profile locks
-- serialize invitations in either direction; the index is a second safeguard.
create unique index agent_discovery_pair_idx on agent_negotiations
  (least(host_id, participant_id), greatest(host_id, participant_id))
  where booking_id is null and state = 'open';
alter table reports add column negotiation_id text references agent_negotiations(id) on delete set null;
