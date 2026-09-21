-- A single bounded retry receipt per workout. No duplicate copy of private
-- actuals is retained. Deletion of the workout removes the receipt too.
alter table workout_runs
  add column last_mutation_id uuid,
  add column last_mutation_hash text,
  add constraint workout_run_receipt_pair check (
    (last_mutation_id is null and last_mutation_hash is null) or
    (last_mutation_id is not null and last_mutation_hash is not null and
      last_mutation_hash ~ '^[0-9a-f]{64}$')
  );
