-- Training blocks (PRD v0.3 §6): one to four standing slots tied to a goal and a
-- date. Progress is check-ins kept out of sessions planned — nothing is logged,
-- and no body metric is ever collected.
--
-- `blocks` already means blocked members (0004), so everything here is
-- `training_block*`.

create table if not exists training_blocks (
  id text primary key,
  created_by text not null references profiles (id),
  activity text not null
    check (activity in ('run', 'walk', 'hike', 'ride', 'strength', 'mobility')),
  -- A short fixed list, never free text: the goal is an event or plain consistency.
  goal_kind text not null check (goal_kind in (
    'race_5k', 'race_10k', 'race_half', 'race_marathon', 'ride_century',
    'hike_trip', 'event_other', 'consistency'
  )),
  -- The event's name ("Dallas Marathon"). The only free text on a block.
  event_name text check (event_name is null or length(event_name) between 1 and 60),
  starts_on date not null,
  goal_date date not null,
  capacity integer not null check (capacity between 2 and 4),
  visibility text not null check (visibility in ('public', 'unlisted')),
  join_mode text not null check (join_mode in ('instant', 'approve')),
  women_only boolean not null default false,
  invite_code text unique,
  cloned_from text references training_blocks (id),
  -- forming: posted, waiting for a second member. closing: past the goal date,
  -- finishers may still credit the buddies who helped.
  status text not null default 'forming'
    check (status in ('forming', 'active', 'closing', 'ended')),
  ended_reason text check (ended_reason in ('goal_date', 'too_few', 'removed')),
  created_at timestamptz not null default now(),
  -- 4 to 20 weeks.
  check (goal_date - starts_on between 28 and 140)
);

create table if not exists training_block_members (
  block_id text not null references training_blocks (id),
  profile_id text not null references profiles (id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  -- Written once, when the block closes. Live progress is computed from sessions
  -- and bookings; this snapshot is what survives them.
  planned_count integer,
  kept_count integer,
  kept_miles numeric(6, 1),
  finished boolean,
  primary key (block_id, profile_id)
);
create index if not exists training_block_members_profile_idx
  on training_block_members (profile_id);

-- "Helped me stick to it": one yes from a finisher to a buddy, per block.
create table if not exists goal_credits (
  id text primary key,
  block_id text not null references training_blocks (id),
  from_id text not null references profiles (id),
  to_id text not null references profiles (id),
  created_at timestamptz not null default now(),
  unique (block_id, from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists goal_credits_to_idx on goal_credits (to_id);

-- A block's weekly slots are ordinary standing slots that point back at it.
alter table series
  add column if not exists training_block_id text references training_blocks (id);
create index if not exists series_training_block_idx on series (training_block_id);

-- Who called a session off. A called-off week doesn't count against the people it
-- was called off on — only against the member who did it.
alter table sessions add column if not exists cancelled_by text references profiles (id);

alter table profiles add column if not exists blocks_finished integer not null default 0;
-- Distinct members who have given this member a goal credit.
alter table profiles add column if not exists helped_count integer not null default 0;
