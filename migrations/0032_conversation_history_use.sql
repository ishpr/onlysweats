-- Existing rows may represent an explicit opt-out. Never classify those members
-- as fresh onboarding, even if all their permissions are disabled.
alter table assistant_chat_settings
  add column consent_reviewed boolean not null default true,
  add column history_use text not null default 'when_requested',
  add column history_use_notice_version text,
  add constraint assistant_history_use_known check
    (history_use in ('when_requested', 'when_relevant')),
  add constraint assistant_history_use_requires_consent check
    (history_use <> 'when_relevant' or
      (cloud_enabled and history_use_notice_version = 'relevant-workout-history-v1'
        and history_use_notice_version is not null));

-- Reading settings does not itself grant permission; only new rows may offer
-- combined first-use coaching consent.
alter table assistant_chat_settings alter column consent_reviewed set default false;
