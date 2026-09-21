-- Private assistant state, unrelated to shared member messages or delegation.
create table assistant_chat_settings (
  user_id text primary key references "user"(id) on delete cascade,
  cloud_enabled boolean not null default false,
  fitness_context_enabled boolean not null default false,
  fitness_context_used boolean not null default false,
  consent_generation uuid not null,
  history_generation uuid not null,
  notice_version text not null,
  updated_at timestamptz not null default now(),
  active_request_id uuid,
  active_attempt_id uuid,
  lease_until timestamptz,
  request_day date,
  request_count integer not null default 0 check (request_count >= 0),
  check (not fitness_context_enabled or cloud_enabled)
);
create table assistant_chat_messages (
  user_id text not null references assistant_chat_settings(user_id) on delete cascade,
  id uuid not null,
  request_id uuid not null,
  role text not null check (role in ('user','assistant')),
  text text not null check (length(text) <= 12000),
  actions jsonb not null default '[]'::jsonb,
  status text not null check (status in ('complete','interrupted')),
  created_at timestamptz not null,
  primary key(user_id,id),
  unique(user_id,request_id,role)
);
create index assistant_chat_history on assistant_chat_messages(user_id,created_at,id);
