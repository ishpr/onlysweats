-- Sign in with Apple: the refresh token we need in order to revoke the app's
-- access when a member deletes their account (App Store guideline 5.1.1(v)).
-- Stored encrypted; never read for anything else.
create table if not exists apple_tokens (
  profile_id text primary key references profiles (id),
  refresh_token_enc text not null,
  created_at timestamptz not null default now()
);
