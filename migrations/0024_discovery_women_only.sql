-- "Women only" for meeting new partners, the way a session can be women-only: a
-- member who chooses it is shown only to women and only shown women.
alter table agent_discovery_consents
  add column if not exists women_only boolean not null default false;
