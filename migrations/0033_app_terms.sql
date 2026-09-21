-- Audit acceptance independently from mutable assistant/source permissions.
-- Generation receipts identify exactly which grants existed at acceptance;
-- later revocation never rewrites acceptance or reactivates those grants.
create table app_terms_acceptances (
  user_id text not null references "user"(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null,
  assistant_consent_generation uuid not null,
  fitness_consent_generation uuid not null,
  primary key (user_id, version)
);
