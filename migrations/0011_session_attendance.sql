-- A host arrives once per session, including seats confirmed after arrival.
alter table sessions add column if not exists host_checked_in_at timestamptz;

-- Preserve check-ins recorded before session-level attendance existed. Include
-- completed/cancelled seats: a later booking must still inherit that arrival.
update sessions s set host_checked_in_at = arrivals.first_arrival
from (
  select session_id, min(host_checked_in_at) as first_arrival
  from bookings where host_checked_in_at is not null group by session_id
) arrivals
where s.id = arrivals.session_id and s.host_checked_in_at is null;

update bookings b set host_checked_in_at = s.host_checked_in_at
from sessions s
where b.session_id = s.id and b.status = 'confirmed'
  and b.host_checked_in_at is null and s.host_checked_in_at is not null;
