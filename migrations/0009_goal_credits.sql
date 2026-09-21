-- The end of a training block: goal credits, and what becomes of its slots.

-- Which block an occurrence belonged to, written on the session itself. A block's
-- slots can outlive it ("keep the slots running") or move to the next block, so
-- the series link stops being a record of the past the moment that happens.
alter table sessions
  add column if not exists training_block_id text references training_blocks (id);
create index if not exists sessions_training_block_idx on sessions (training_block_id, start_at);

update sessions s set training_block_id = se.training_block_id
from series se join training_blocks tb on tb.id = se.training_block_id
where se.id = s.series_id and s.training_block_id is null and s.start_at >= tb.created_at;

-- A finisher answers "helped me stick to it?" once. Answering with nobody is an
-- answer too, and nobody can tell the difference.
alter table training_block_members add column if not exists credits_answered_at timestamptz;
