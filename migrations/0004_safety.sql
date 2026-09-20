-- Safety and account lifecycle: block, report, suspension, deletion, admin audit.

-- A suspended member can sign in, read why, and delete their account. Nothing else.
alter table profiles add column if not exists suspended_at timestamptz;
alter table profiles add column if not exists suspended_reason text;
-- Deleting an account scrubs the profile and keeps the row, so the other
-- person's history, ratings and any safety report still resolve.
alter table profiles add column if not exists deleted_at timestamptz;

-- Blocking is mutual in effect: neither side sees the other's sessions, can take
-- a seat with them, or can message them. Only the blocker can undo it.
create table if not exists blocks (
  blocker_id text not null references profiles (id),
  blocked_id text not null references profiles (id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on blocks (blocked_id);

create table if not exists reports (
  id text primary key,
  reporter_id text not null references profiles (id),
  reported_id text not null references profiles (id),
  session_id text references sessions (id),
  booking_id text references bookings (id),
  reason text not null check (reason in (
    'date_framing',   -- "made it feel like a date" — the one SamePace exists to prevent
    'harassment',
    'unsafe',
    'misrepresented', -- the level or the listing wasn't what was posted
    'fake_or_spam',
    'other'
  )),
  detail text not null default '',
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);
create index if not exists reports_status_idx on reports (status, created_at);
create index if not exists reports_reported_idx on reports (reported_id);

-- Everything an admin does, append-only.
create table if not exists admin_actions (
  id text primary key,
  admin_email text not null,
  action text not null,
  profile_id text,
  session_id text,
  report_id text,
  note text not null default '',
  created_at timestamptz not null default now()
);

-- A suspended member who deletes their account can't walk back in with the same
-- email. Only a hash is kept.
create table if not exists banned_identities (
  email_hash text primary key,
  reason text not null default '',
  created_at timestamptz not null default now()
);
