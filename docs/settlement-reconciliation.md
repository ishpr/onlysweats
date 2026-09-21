# Review historical settlement records

The session attendance fix prevents new duplicate host fees, strikes, and completion increments. Migration `0011_session_attendance.sql` preserves earlier arrival evidence; it deliberately does not rewrite settled financial or reputation history.

The queries below identify candidates for review. They contain no data changes and run inside a read-only transaction. Run them against an authorized database snapshot or read replica after applying migration 0011. No production reconciliation has been performed as part of this branch.

Keep the returned record IDs for each reviewed case. Before correcting a record, inspect the session, attendance times, ledger status, dispute history, and any host reassignment. A ledger entry marked `assessed` is a recorded fee, not evidence that money was collected. Preserve the legitimate credit for each joiner who attended. Do not automatically erase disputed or waived entries, change freeze dates, or decrement counters from these candidate reports.

## Host no-show fees recorded more than once for a session

This includes older fees linked only through a booking and newer fees with a direct session reference. Multiple rows can include prior waivers or disputes, so the report separates their statuses.

```sql
begin transaction read only;

with host_fees as (
  select l.*, coalesce(l.session_id, b.session_id) as resolved_session_id
  from ledger_events l
  left join bookings b on b.id = l.booking_id
  where l.kind = 'no_show_fee'
)
select s.id as session_id, s.host_id, s.start_at,
       count(*) as fee_rows,
       count(*) filter (where f.status = 'assessed') as assessed_rows,
       count(*) filter (where f.status = 'waived') as waived_rows,
       count(*) filter (where f.status = 'disputed') as disputed_rows,
       coalesce(sum(f.amount_cents) filter (where f.status = 'assessed'), 0) as assessed_cents,
       array_agg(f.id order by f.created_at, f.id) as ledger_ids
from host_fees f
join sessions s on s.id = f.resolved_session_id and s.host_id = f.profile_id
group by s.id, s.host_id, s.start_at
having count(*) > 1
order by s.start_at, s.id;

rollback;
```

## Duplicate host strikes and currently frozen profiles

One missed group session should create one host strike. A freeze could have another legitimate cause, and deleting duplicate strikes alone would not recalculate it. Review all strikes in the member's 60-day window before deciding whether the current freeze should change.

```sql
begin transaction read only;

select s.id as session_id, s.host_id, s.start_at,
       count(*) as strike_rows,
       count(*) filter (where k.created_at > now() - interval '60 days') as recent_strike_rows,
       array_agg(k.id order by k.created_at, k.id) as strike_ids,
       p.frozen_until,
       p.frozen_until > now() as currently_frozen
from strikes k
join bookings b on b.id = k.booking_id
join sessions s on s.id = b.session_id and s.host_id = k.profile_id
join profiles p on p.id = s.host_id
group by s.id, s.host_id, s.start_at, p.frozen_until
having count(*) > 1
order by s.start_at, s.id;

rollback;
```

## Completion counters that differ from distinct completed sessions

The proposed count below counts each member once per completed session, whether hosting or joining. Differences are candidates, not an instruction to overwrite counters: demo data, earlier manual adjustments, and host handoffs can require additional interpretation because bookings do not retain the historical host's identity.

```sql
begin transaction read only;

with completed_members as (
  select s.host_id as profile_id, b.session_id
  from bookings b join sessions s on s.id = b.session_id
  where b.status = 'completed'
  union
  select b.participant_id as profile_id, b.session_id
  from bookings b where b.status = 'completed'
), expected as (
  select profile_id, count(*) as completed_sessions
  from completed_members group by profile_id
)
select p.id as profile_id, p.completed_count as stored_count,
       coalesce(e.completed_sessions, 0) as distinct_completed_sessions,
       p.completed_count - coalesce(e.completed_sessions, 0) as difference
from profiles p left join expected e on e.profile_id = p.id
where p.completed_count <> coalesce(e.completed_sessions, 0)
order by abs(p.completed_count - coalesce(e.completed_sessions, 0)) desc, p.id;

rollback;
```

## Host no-shows despite recorded attendance

This catches the earlier late-join issue even when it produced only one fee. Check timestamps and host identity before deciding whether the booking status, fee, strike, completion counter, or associated credit needs correction. Existing credits should not be silently clawed back.

```sql
begin transaction read only;

select s.id as session_id, s.host_id, b.id as booking_id, b.participant_id,
       s.start_at, s.host_checked_in_at as session_host_arrival,
       b.host_checked_in_at as booking_host_arrival,
       b.participant_checked_in_at, b.settled_at
from bookings b join sessions s on s.id = b.session_id
where b.status = 'host_no_show'
  and (s.host_checked_in_at is not null or b.host_checked_in_at is not null)
order by s.start_at, s.id, b.id;

rollback;
```

After review, prepare a separate, explicit correction with the selected record IDs and expected effects on fees, strikes, freeze status, and completion counters. Keep that correction auditable and idempotent. These reports neither authorize nor perform it.
