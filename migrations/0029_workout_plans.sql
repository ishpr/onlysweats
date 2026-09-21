-- Prescriptions are member-authored plans, never measured or completed activity.
create table workout_plans (
  user_id text not null references "user"(id) on delete cascade,
  id uuid not null,
  revision integer not null default 1 check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);
create index workout_plans_owner_page on workout_plans(user_id, created_at desc, id desc);

-- The host deliberately shares one frozen prescription with the booked group.
-- Deleting a library plan does not rewrite a session's shared instructions.
create table session_workout_plans (
  session_id text primary key references sessions(id) on delete cascade,
  id uuid not null unique,
  author_id text not null references "user"(id) on delete cascade,
  source_plan_id uuid not null,
  source_plan_revision integer not null check (source_plan_revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  attached_at timestamptz not null
);

-- Each member keeps their own immutable prescription and explicit actual sets.
-- A copied prescription survives the original author's departure. Only the
-- owning member's identity controls retention of their private activity record.
create table workout_runs (
  user_id text not null references "user"(id) on delete cascade,
  id uuid not null,
  revision integer not null default 1 check (revision > 0),
  session_id text references sessions(id) on delete set null,
  session_plan_id uuid references session_workout_plans(id) on delete set null,
  source_plan_id uuid,
  source_plan_revision integer check (source_plan_revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  status text not null check (status in ('in_progress', 'completed')),
  share_accountability boolean not null default false,
  note text not null default '' check (length(note) <= 1000),
  started_at timestamptz not null,
  finished_at timestamptz,
  updated_at timestamptz not null,
  primary key (user_id, id),
  check ((status = 'completed') = (finished_at is not null))
);
create unique index workout_runs_one_session on workout_runs(user_id, session_id) where session_id is not null;
create index workout_runs_owner_page on workout_runs(user_id, started_at desc, id desc);
create index workout_runs_accountability on workout_runs(session_id) where share_accountability;
