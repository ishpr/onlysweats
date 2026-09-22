-- A member's private intention is not a scheduled group or performed activity.
create table private_agent_goals (
  user_id text primary key references "user"(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 160),
  activity text not null check (activity in ('run','walk','hike','ride','strength','mobility')),
  goal_date date not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null
);
