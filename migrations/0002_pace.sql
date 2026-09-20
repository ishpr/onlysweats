-- SamePace core schema (PRD v0.3 — membership).
--
-- Nobody pays anybody: there are no prices, holds, captures or payouts here.
-- What is recorded is whether people showed up, and the fees/credits that follow
-- when they didn't. Booking state is authoritative HERE, never on the client.
-- Ids are TEXT (the auth user id, or demo-* for dev seeds). Money is integer
-- cents. Every timestamp is timestamptz.

create table if not exists profiles (
  id text primary key,                -- Better Auth user id (or demo-* for seeds)
  name text not null,
  handle text not null unique,
  initials text not null,
  neighborhood text not null default 'Oak Lawn',
  accent text not null default 'exercise'
    check (accent in ('move', 'exercise', 'stand', 'fg')),
  -- Only used to enforce women-only sessions. Never ranked on, never shown.
  gender text check (gender in ('woman', 'man', 'nonbinary')),
  -- The member's own level per activity: { run: { paceMinSec, paceMaxSec }, … }.
  -- About the workout, never the body. No free-text "about me" by design.
  abilities jsonb not null default '{}'::jsonb,
  identity_verified boolean not null default false,
  is_demo boolean not null default false,
  -- Membership credit from being stood up. Cannot be cashed out.
  credit_cents integer not null default 0 check (credit_cents >= 0),
  -- Denormalized reputation counters, moved in the same transaction as the
  -- completion / rating behind them.
  completed_count integer not null default 0,
  on_time_yes integer not null default 0,
  on_time_total integer not null default 0,
  would_join_yes integer not null default 0,
  would_join_total integer not null default 0,
  -- Two strikes in 60 days: no posting or joining PUBLIC sessions until this.
  frozen_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists venues (
  id text primary key,
  name text not null,
  type text not null check (type in ('trail', 'park', 'gym', 'track', 'road_start')),
  neighborhood text not null,
  lat double precision not null,
  lng double precision not null,
  image text not null,
  -- Exact meeting spot. Only sent to the poster and confirmed joiners.
  hint text not null
);

-- A standing slot: "same time next week", until its members leave it.
create table if not exists series (
  id text primary key,
  created_by text not null references profiles (id),
  status text not null default 'active' check (status in ('active', 'ended')),
  -- Consecutive occurrences where everyone checked in.
  streak integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists series_members (
  series_id text not null references series (id),
  profile_id text not null references profiles (id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (series_id, profile_id)
);

create table if not exists sessions (
  id text primary key,
  host_id text not null references profiles (id),   -- the poster; earns nothing
  venue_id text not null references venues (id),
  activity text not null
    check (activity in ('run', 'walk', 'hike', 'ride', 'strength', 'mobility')),
  title text not null check (length(title) between 1 and 120),
  detail text not null default '' check (length(detail) <= 1000),
  -- Required: a buddy at the wrong level is worse than no buddy.
  ability jsonb not null,
  ability_flex text not null default 'strict' check (ability_flex in ('strict', 'flexible')),
  route_url text check (route_url is null or route_url ~ '^https://'),
  start_at timestamptz not null,
  duration_min integer not null check (duration_min between 10 and 360),
  capacity integer not null check (capacity between 2 and 4),
  visibility text not null check (visibility in ('public', 'unlisted')),
  join_mode text not null check (join_mode in ('instant', 'approve')),
  women_only boolean not null default false,
  status text not null default 'open' check (status in ('open', 'cancelled', 'completed')),
  code text not null check (code ~ '^[0-9]{4}$'),
  code_revealed_at timestamptz,
  invite_code text unique,
  -- Set when this is one occurrence of a standing slot.
  series_id text references series (id),
  created_at timestamptz not null default now()
);
create index if not exists sessions_start_idx on sessions (start_at);
create index if not exists sessions_host_idx on sessions (host_id);
create index if not exists sessions_series_idx on sessions (series_id, start_at);

create table if not exists bookings (
  id text primary key,
  session_id text not null references sessions (id),
  participant_id text not null references profiles (id),
  status text not null check (status in (
    'pending', 'confirmed', 'declined', 'cancelled', 'late_cancel', 'covered',
    'completed', 'no_show', 'host_no_show', 'void'
  )),
  -- The absent regular this member is filling in for, on a standing slot.
  substitute_for text references profiles (id),
  host_checked_in_at timestamptz,
  participant_checked_in_at timestamptz,
  checkin_method text check (checkin_method in ('geo', 'code')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists bookings_session_idx on bookings (session_id);
create index if not exists bookings_participant_idx on bookings (participant_id);
-- One live seat per person per session.
create unique index if not exists bookings_one_active_seat on bookings (session_id, participant_id)
  where status in ('pending', 'confirmed', 'completed');

create table if not exists messages (
  id text primary key,
  booking_id text not null references bookings (id),
  from_id text not null references profiles (id),
  text text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_booking_idx on messages (booking_id, created_at);

create table if not exists ratings (
  id text primary key,
  booking_id text not null references bookings (id),
  from_id text not null references profiles (id),
  to_id text not null references profiles (id),
  showed_up boolean not null,
  on_time boolean not null,
  matched_listing boolean not null,   -- now includes "ability as stated"
  respectful boolean not null,
  would_join_again boolean not null,
  created_at timestamptz not null default now(),
  unique (booking_id, from_id)
);

-- Fees and credits. Nothing here is charged yet: a card-on-file provider plugs in
-- behind `assessed` rows once they pass `chargeable_at` (the 24h dispute window).
create table if not exists ledger_events (
  id text primary key,
  profile_id text not null references profiles (id),
  booking_id text references bookings (id),
  session_id text references sessions (id),
  kind text not null check (kind in ('late_cancel_fee', 'no_show_fee', 'show_up_credit')),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'assessed' check (status in ('assessed', 'waived', 'disputed')),
  chargeable_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ledger_profile_idx on ledger_events (profile_id, created_at);
create index if not exists ledger_booking_idx on ledger_events (booking_id);

-- A strike lands on whoever didn't show — poster or joiner alike.
create table if not exists strikes (
  id text primary key,
  profile_id text not null references profiles (id),
  booking_id text not null references bookings (id),
  created_at timestamptz not null default now()
);
create index if not exists strikes_profile_idx on strikes (profile_id, created_at);
