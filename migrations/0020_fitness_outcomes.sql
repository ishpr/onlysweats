-- Separately opted-in fitness pilot measurements. No raw notes, exercise values,
-- sensor records, model state, answers, or probability distributions are stored.
create table fitness_pilot_consents (
  user_id text primary key references "user"(id) on delete cascade,
  enabled boolean not null,
  generation uuid not null,
  notice_version text not null,
  updated_at timestamptz not null
);
create table fitness_logging_sessions (
  user_id text not null references fitness_pilot_consents(user_id) on delete cascade,
  id uuid not null,
  consent_generation uuid not null,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  ai_request_marker text,
  draft_id uuid,
  draft_status text check (draft_status in ('available', 'insufficient_data', 'provider_unavailable')),
  field_salt uuid not null,
  field_hashes jsonb not null default '{}'::jsonb check (jsonb_typeof(field_hashes) = 'object'),
  model text,
  question_version text,
  log_id uuid,
  save_fingerprint text,
  saved_at timestamptz,
  elapsed_ms integer check (elapsed_ms between 0 and 7200000),
  mode text not null default 'no_linked_draft' check (mode in ('no_linked_draft', 'linked_draft', 'unobserved_draft_use')),
  suggested_fields integer not null default 0 check (suggested_fields between 0 and 5),
  unchanged_fields integer check (unchanged_fields between 0 and 5),
  changed_fields integer check (changed_fields between 0 and 5),
  filled_fields integer check (filled_fields between 0 and 5),
  comparison_revision integer,
  feedback jsonb check (feedback is null or jsonb_typeof(feedback) = 'object'),
  primary key (user_id, id),
  unique (user_id, log_id),
  foreign key (user_id, log_id) references fitness_strength_logs(user_id, id) on delete cascade,
  check ((log_id is null and saved_at is null and elapsed_ms is null) or
    (log_id is not null and saved_at is not null and elapsed_ms is not null and save_fingerprint is not null))
);
create index fitness_logging_sessions_retention_idx on fitness_logging_sessions(started_at);
