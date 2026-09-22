-- A bounded watermark per member/room, replaced when chat generations change.
-- Stores no conversation text, health data or executable instructions.
create table assistant_plan_updates (
  user_id text not null references "user"(id) on delete cascade,
  negotiation_id text not null references agent_negotiations(id) on delete cascade,
  consent_generation uuid not null,
  history_generation uuid not null,
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  primary key (user_id, negotiation_id)
);
create index assistant_plan_updates_retention on assistant_plan_updates(observed_at);
