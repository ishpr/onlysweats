-- Completed-turn drafts and execution receipts live outside chat messages because
-- updating a workout invalidates context-bearing messages in the same transaction.
create table assistant_chat_actions (
  id uuid primary key,
  user_id text not null references "user"(id) on delete cascade,
  message_id uuid not null,
  consent_generation uuid not null,
  history_generation uuid not null,
  command jsonb not null,
  card jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  executing boolean not null default false,
  receipt jsonb,
  executed_at timestamptz,
  check (expires_at > created_at),
  check ((receipt is null) = (executed_at is null))
);
create index assistant_chat_actions_owner on assistant_chat_actions(user_id, message_id);
create index assistant_chat_actions_expiry on assistant_chat_actions(expires_at) where receipt is null;
