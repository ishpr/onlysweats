-- The audit log can point at a training block, as it can at a session.
alter table admin_actions add column if not exists training_block_id text;
