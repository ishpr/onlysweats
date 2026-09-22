-- Inquiry erasure does not erase its Cases. No profile FK or member identity:
-- cleanup must survive account deletion and successful inquiry cleanup.
create table persona_case_cleanup_jobs (
  provider_ref text primary key,
  provider_environment text check (provider_environment in ('sandbox', 'production')),
  state text not null default 'queued' check (state in ('queued', 'processing', 'failed', 'review_required', 'monitoring')),
  cursor_ref text,
  attempts integer not null default 0,
  lease_token text,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_verified_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index persona_case_cleanup_due on persona_case_cleanup_jobs (next_attempt_at)
  where state <> 'review_required';

-- Preserve obligations already queued before this worker was introduced.
insert into persona_case_cleanup_jobs (provider_ref, provider_environment, state, review_reason, created_at)
select provider_ref, provider_environment,
  case when provider_environment is null then 'review_required' else 'queued' end,
  case when provider_environment is null then 'unknown_provider_environment' else null end,
  created_at from persona_redaction_jobs
on conflict (provider_ref) do nothing;
