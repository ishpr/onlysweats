-- Product-authorized matching is separate from legacy seven-day discovery grants.
-- No existing member is enrolled by the migration: current Terms acceptance seeds it.
create table agent_contact_authorities (
  profile_id text primary key references profiles(id) on delete cascade,
  enabled boolean not null,
  revision integer not null default 1 check (revision > 0),
  terms_version text not null,
  accepted_at timestamptz not null,
  women_only boolean not null default false,
  legacy_discovery_updated_at timestamptz,
  updated_at timestamptz not null,
  next_scan_at timestamptz not null,
  last_scan_at timestamptz,
  last_preference_revision integer,
  last_reason text
);
create index agent_contacts_due on agent_contact_authorities(next_scan_at, profile_id)
  where enabled;
alter table agent_negotiations add column host_contact_revision integer;
alter table agent_negotiations add column participant_contact_revision integer;
alter table agent_negotiations add constraint agent_contact_revision_pair check (
  (host_contact_revision is null and participant_contact_revision is null) or
  (host_contact_revision is not null and participant_contact_revision is not null
   and host_contact_revision > 0 and participant_contact_revision > 0)
);
alter table agent_negotiation_events drop constraint agent_negotiation_events_kind_check;
alter table agent_negotiation_events add constraint agent_negotiation_events_kind_check
  check (kind in ('consent', 'proposal', 'confirmation', 'cancel', 'booking_approval', 'booked', 'agent_message'));
