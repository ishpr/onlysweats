-- Separate consent: existing Apple Health context never authorizes manual records.
alter table assistant_chat_settings
  add column manual_workout_context_enabled boolean not null default false,
  add column manual_workout_context_used boolean not null default false,
  add column manual_workout_notice_version text,
  add constraint manual_workout_context_requires_cloud check
    (not manual_workout_context_enabled or cloud_enabled),
  add constraint manual_workout_context_requires_notice check
    (not manual_workout_context_enabled or manual_workout_notice_version is not null);
