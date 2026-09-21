-- New accountless inquiries are bound by our durable creation record, not a
-- Persona Account reference. Never reinterpret existing rows as accountless.
alter table verifications add column if not exists binding_version integer not null default 0;
alter table verifications add column if not exists provider_template_id text;
alter table verifications add column if not exists provider_environment text;
alter table verifications add constraint verifications_binding_version_check
  check (binding_version in (0, 1));
alter table verifications add constraint verifications_environment_check
  check (provider_environment is null or provider_environment in ('sandbox', 'production'));
alter table verifications add constraint verifications_accountless_binding_check
  check (binding_version = 0 or (
    provider = 'persona' and provider_ref is not null and
    provider_template_id is not null and provider_template_id ~ '^itmpl_[A-Za-z0-9_-]+$' and
    provider_environment is not null
  ));

-- A sandbox deletion obligation must never be discharged using a production
-- key's not-found response, including after a database/configuration mistake.
alter table persona_redaction_jobs add column if not exists provider_environment text;
alter table persona_redaction_jobs add constraint persona_redaction_environment_check
  check (provider_environment is null or provider_environment in ('sandbox', 'production'));
