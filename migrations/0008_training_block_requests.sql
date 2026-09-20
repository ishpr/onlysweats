-- Asking to join a training block whose members approve each person. Kept apart
-- from `training_block_members` so that every membership query stays a plain
-- "is a member" — a request is not a seat.
create table if not exists training_block_requests (
  block_id text not null references training_blocks (id),
  profile_id text not null references profiles (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  resolved_by text references profiles (id),
  resolved_at timestamptz,
  primary key (block_id, profile_id)
);
create index if not exists training_block_requests_status_idx
  on training_block_requests (block_id, status);
