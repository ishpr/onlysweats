-- Keep old SDNN records unchanged; RMSSD is a distinct HealthKit measurement.
alter table health_connections add column automatic_sync boolean not null default false;
alter table health_connections drop constraint health_connections_types_allowed;
alter table health_connections add constraint health_connections_types_allowed check
  (types <@ array['workout', 'heart_rate', 'resting_heart_rate', 'heart_rate_variability',
  'heart_rate_variability_rmssd', 'cycling_power', 'sleep', 'steps', 'distance', 'active_energy', 'blood_glucose']::text[]);
alter table health_records drop constraint health_records_type_allowed;
alter table health_records add constraint health_records_type_allowed check
  (type in ('workout', 'heart_rate', 'resting_heart_rate', 'heart_rate_variability',
  'heart_rate_variability_rmssd', 'cycling_power', 'sleep', 'steps', 'distance', 'active_energy', 'blood_glucose'));
