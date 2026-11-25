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
  unique (wedding_id, function_kind, kind),
  foreign key (wedding_id, function_kind) references functions(wedding_id, kind) on delete cascade
);

-- The approval transaction publishes its immutable, approved schedule here.
-- Voice playback is a projection of the newest committed revision.
create table approved_wedding_recaps (
  wedding_id uuid not null references weddings(id) on delete cascade,
  revision int not null check (revision > 0),
  approved_by uuid references members(id) on delete set null,
  approved_at timestamptz not null default now(),
  activities jsonb not null check (jsonb_typeof(activities) = 'array'),
  primary key (wedding_id, revision)
);

alter table family_plan_requirements enable row level security;
alter table approved_wedding_recaps enable row level security;
revoke all on table family_plan_requirements, approved_wedding_recaps from anon, authenticated;
grant select, insert, update, delete on table family_plan_requirements to service_role;
grant select, insert on table approved_wedding_recaps to service_role;
