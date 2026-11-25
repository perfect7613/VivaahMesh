create table family_plan_requirements (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  function_kind text not null,
  kind text not null check (kind in ('dinner_start', 'dance_duration')),
  household_id uuid references households(id) on delete set null,
  member_id uuid references members(id) on delete set null,
  value_min int not null check (
    (kind = 'dinner_start' and value_min between 0 and 1439)
    or (kind = 'dance_duration' and value_min between 1 and 180)
  ),
  note text not null default '',
  source text not null check (source in ('typed', 'dictate', 'seed')),
  version int not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (wedding_id, function_kind, kind)
);

-- Store the schedule approved by #5 alongside its revision.
alter table approvals add column approved_activities jsonb
  check (approved_activities is null or jsonb_typeof(approved_activities) = 'array');

alter table family_plan_requirements enable row level security;
revoke all on table family_plan_requirements from anon, authenticated;
grant select, insert, update, delete on table family_plan_requirements to service_role;
