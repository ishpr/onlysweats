-- Aggregate reliability measurements only: no member, workout, request body,
-- token, source identifier, or model state is retained here.
create table operation_events (
  id uuid primary key,
  component text not null check (component in ('health', 'fitness', 'agents')),
  action text not null,
  status integer not null check (status between 100 and 599),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);
create index operation_events_created_idx on operation_events(created_at);
