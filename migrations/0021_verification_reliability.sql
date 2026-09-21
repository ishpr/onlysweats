alter table verifications add column if not exists provider_updated_at timestamptz;

-- Survives account deletion until Persona confirms redaction. Contains only the
-- provider's opaque reference; no member identifier, image, or document.
create table if not exists persona_redaction_jobs (
  provider_ref text primary key,
  state text not null default 'queued' check (state in ('queued', 'processing', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
