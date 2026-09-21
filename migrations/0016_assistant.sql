-- Only explicit member-entered planning preferences. No health foreign keys or snapshots.
create table agent_preferences (
  profile_id text primary key references profiles(id) on delete cascade,
  preferences jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

-- Human booking approvals are separate from delegations and plan confirmations.
alter table agent_negotiations add column booking_terms jsonb;
alter table agent_negotiations add column booking_terms_hash text;
alter table agent_negotiations add column booking_approvals jsonb not null default '[]'::jsonb;
alter table agent_negotiations add column result_session_id text references sessions(id);
alter table agent_negotiations add column result_booking_id text references bookings(id);
alter table agent_negotiations add constraint agent_result_pair check (
  (result_session_id is null) = (result_booking_id is null)
);
create unique index agent_result_booking_idx on agent_negotiations(result_booking_id)
  where result_booking_id is not null;
alter table agent_negotiation_events drop constraint agent_negotiation_events_kind_check;
alter table agent_negotiation_events add constraint agent_negotiation_events_kind_check
  check (kind in ('consent', 'proposal', 'confirmation', 'cancel', 'booking_approval', 'booked'));
