-- Push notifications: devices, an outbox that doubles as the in-app activity
-- list, per-member preferences, and Expo push tickets awaiting a receipt.

-- Which kinds of push a member wants. Safety and account notices always send.
alter table profiles add column if not exists notify jsonb not null
  default '{"sessions": true, "messages": true, "reminders": true, "substitutes": true}'::jsonb;

create table if not exists push_devices (
  token text primary key,            -- ExponentPushToken[…]; a device belongs to one member at a time
  profile_id text not null references profiles (id),
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz            -- the push service said this token is dead
);
create index if not exists push_devices_profile_idx on push_devices (profile_id);

-- Written inside the transaction that caused it, delivered afterwards — so a
-- notification exists exactly when the thing it describes does.
create table if not exists notifications (
  id text primary key,
  profile_id text not null references profiles (id),
  kind text not null,
  category text not null check (category in ('sessions', 'messages', 'reminders', 'substitutes', 'account')),
  title text not null,
  body text not null,
  url text,                          -- in-app route to open on tap
  session_id text,
  booking_id text,
  dedupe_key text unique,            -- reminders and offers are sent once
  created_at timestamptz not null default now(),
  sent_at timestamptz,               -- null = still owed a push attempt
  attempts int not null default 0,
  read_at timestamptz
);
create index if not exists notifications_profile_idx on notifications (profile_id, created_at desc);
create index if not exists notifications_unsent_idx on notifications (created_at) where sent_at is null;

create table if not exists push_tickets (
  id text primary key,               -- Expo ticket id
  token text not null,
  created_at timestamptz not null default now()
);
