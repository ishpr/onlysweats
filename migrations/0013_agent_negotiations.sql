-- A2A delegates can negotiate plans, never book, cancel seats, or accept fees.
create table agent_delegations (
  id text primary key,
  profile_id text not null references profiles(id),
  label text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_delegations_profile_idx on agent_delegations(profile_id);

-- Start from a shared booking: this does not introduce a member directory or
-- unsolicited contact. Both people opt in using their own app sessions.
create table agent_negotiations (
  id text primary key,
  booking_id text not null references bookings(id),
  host_id text not null references profiles(id),
  participant_id text not null references profiles(id),
  host_consented boolean not null default false,
  participant_consented boolean not null default false,
  state text not null default 'open' check (state in ('open', 'approved', 'cancelled')),
  revision integer not null default 0,
  plan jsonb,
  confirmations jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (host_id <> participant_id)
);
create index agent_negotiations_host_idx on agent_negotiations(host_id, updated_at);
create index agent_negotiations_participant_idx on agent_negotiations(participant_id, updated_at);
create unique index agent_negotiations_open_booking_idx on agent_negotiations(booking_id) where state = 'open';

create table agent_negotiation_events (
  sequence bigserial primary key,
  negotiation_id text not null references agent_negotiations(id) on delete cascade,
  profile_id text not null references profiles(id),
  message_id text not null,
  command_hash text not null,
  kind text not null check (kind in ('consent', 'proposal', 'confirmation', 'cancel')),
  revision integer not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (negotiation_id, profile_id, message_id)
);
