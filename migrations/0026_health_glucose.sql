-- Blood glucose joins the opt-in Apple Health types. The original checks were
-- unnamed, so find them by what they list, then replace them with named ones.
do $$
declare c record;
begin
  for c in
    select conname, conrelid::regclass as tbl from pg_constraint
    where contype = 'c'
      and conrelid in ('health_connections'::regclass, 'health_records'::regclass)
      and pg_get_constraintdef(oid) like '%active_energy%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table health_connections add constraint health_connections_types_allowed
  check (types <@ array['workout', 'heart_rate', 'resting_heart_rate', 'heart_rate_variability',
    'sleep', 'steps', 'distance', 'active_energy', 'blood_glucose']::text[]);
alter table health_records add constraint health_records_type_allowed
  check (type in ('workout', 'heart_rate', 'resting_heart_rate', 'heart_rate_variability',
    'sleep', 'steps', 'distance', 'active_energy', 'blood_glucose'));
