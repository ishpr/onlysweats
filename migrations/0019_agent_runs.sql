-- Independent, revocable authority for SamePace's bounded two-member planner.
-- Versions reference entered preferences. No health data or model output is stored.
create table agent_coordination_permissions (
  negotiation_id text not null references agent_negotiations(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  enabled boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  preference_revision integer not null check (preference_revision >= 0),
  negotiation_revision integer not null check (negotiation_revision >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (negotiation_id, profile_id)
);

create table agent_coordination_runs (
  id text primary key,
  negotiation_id text not null references agent_negotiations(id) on delete cascade,
  request_id text not null check (length(request_id) between 1 and 100),
  started_by text not null references profiles(id) on delete cascade,
  status text not null check (status in ('queued','negotiating','awaiting_review','no_match','cancelled','expired')),
  reason text,
  base_revision integer not null check (base_revision >= 0),
  proposal_revision integer not null check (proposal_revision >= base_revision),
  host_permission_revision integer not null,
  participant_permission_revision integer not null,
  steps_used integer not null default 0,
  max_steps integer not null default 3 check (max_steps between 1 and 3),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (steps_used between 0 and max_steps),
  check (jsonb_array_length(steps) = steps_used),
  unique (negotiation_id, request_id)
);
create unique index agent_coordination_one_active on agent_coordination_runs(negotiation_id)
  where status in ('queued','negotiating');
create index agent_coordination_pending on agent_coordination_runs(updated_at, id)
  where status in ('queued','negotiating');
