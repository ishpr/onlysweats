-- Private, explicitly opted-in HealthKit imports. These tables deliberately
-- reference the auth identity, not the retained social-history profile: account
-- deletion removes every imported health record, cursor, and tombstone.
create table health_connections (
  user_id text primary key references "user"(id) on delete cascade,
  device_id uuid not null,
  generation uuid not null,
  types text[] not null,
  since_at timestamptz not null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  check ('workout' = any(types)),
  check (types <@ array['workout', 'heart_rate', 'resting_heart_rate',
    'heart_rate_variability', 'sleep', 'steps', 'distance', 'active_energy']::text[])
);

create table health_cursors (
  user_id text not null references health_connections(user_id) on delete cascade,
  type text not null,
  sequence integer not null default 0 check (sequence >= 0),
  anchor text,
  primary key (user_id, type)
);

create table health_records (
  user_id text not null references "user"(id) on delete cascade,
  type text not null check (type in ('workout', 'heart_rate', 'resting_heart_rate',
    'heart_rate_variability', 'sleep', 'steps', 'distance', 'active_energy')),
  external_id uuid not null,
  record jsonb,
  imported_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  -- A NULL record is a tombstone. No measurements, provenance, or timestamps
  -- survive deletion; only the member-scoped source ID and type prevent reimport.
  primary key (user_id, type, external_id),
  check ((record is null and imported_at is null) or
    (record is not null and imported_at is not null and jsonb_typeof(record) = 'object'))
);
create index health_records_live_idx on health_records(user_id, type, (record->>'startAt'), external_id)
  where record is not null;
create index health_records_source_idx on health_records(user_id, type, (record->'source'->>'bundleId'), (record->>'startAt'))
  where record is not null;
