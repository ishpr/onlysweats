-- Member-authored records are not source observations and survive a HealthKit
-- resync. All private fitness data cascades from the auth identity.
create table fitness_consents (
  user_id text primary key references "user"(id) on delete cascade,
  enabled boolean not null,
  generation uuid not null,
  notice_version text not null,
  updated_at timestamptz not null,
  last_requested_at timestamptz,
  request_day date,
  request_count integer not null default 0 check (request_count >= 0)
);
create table fitness_strength_logs (
  user_id text not null references "user"(id) on delete cascade,
  id uuid not null,
  revision integer not null default 1 check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);
create table fitness_workout_corrections (
  user_id text not null,
  type text not null default 'workout' check (type = 'workout'),
  workout_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null,
  primary key (user_id, workout_id),
  foreign key (user_id, type, workout_id) references health_records(user_id, type, external_id) on delete cascade
);
create table fitness_workout_assessments (
  user_id text not null,
  type text not null default 'workout' check (type = 'workout'),
  workout_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key (user_id, workout_id),
  foreign key (user_id, type, workout_id) references health_records(user_id, type, external_id) on delete cascade,
  foreign key (user_id) references fitness_consents(user_id) on delete cascade
);
-- Source deletion uses a measurement-free tombstone. Remove its overlays and
-- interpretations immediately too; a foreign key alone cannot observe NULL.
create function fitness_purge_workout_tombstone() returns trigger language plpgsql as $$
begin
  if new.type = 'workout' and new.record is null then
    delete from fitness_workout_corrections where user_id = new.user_id and workout_id = new.external_id;
    delete from fitness_workout_assessments where user_id = new.user_id and workout_id = new.external_id;
  end if;
  return new;
end;
$$;
create trigger fitness_workout_tombstone after update of record on health_records
  for each row execute function fitness_purge_workout_tombstone();
