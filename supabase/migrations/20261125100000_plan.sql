-- Issue #3: activities and facts that feed the deterministic wedding compiler.
-- The compiler itself is a pure function (web/src/lib/compiler); these tables only hold its inputs.

create table activities (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  -- Stable slug used by the compiler and proposals (e.g. 'dance', 'dinner').
  key text not null,
  function_kind text not null,
  title text not null,
  kind text not null check (kind in ('dance','dinner','makeup','ritual','coverage','music','other')),
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  flexible boolean not null default false,
  requires_amplified_music boolean not null default false,
  -- Activity kinds this one may overlap without a conflict (e.g. background music during dinner).
  can_overlap_with text[] not null default '{}'
    check (can_overlap_with <@ array['dance','dinner','makeup','ritual','coverage','music','other']),
  requested_by_side text check (requested_by_side in ('A','B')),
  requested_by_name text,
  priority text check (priority in ('must','prefer','nice')),
  source text not null default 'app' check (source in ('app','seed')),
  created_at timestamptz not null default now(),
  check (end_min > start_min),
  unique (wedding_id, key)
);

create table facts (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  kind text not null check (kind in ('music_cutoff','dinner_start','makeup_ready','coverage_end','overtime_rate')),
  function_kind text not null,
  -- Minute of day for time facts, rupees per hour for overtime_rate. Null while unresolved.
  value int,
  status text not null check (status in ('confirmed','conditional','unresolved')),
  channel text not null check (channel in ('samvaad_call','browser_agent','quote','typed','seed')),
  ref text not null default '',
  wording text not null default '',
  -- Earlier facts this one replaces (a mid-call correction, or a typed fix of a contradiction).
  supersedes uuid[] not null default '{}',
  author_member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index on activities (wedding_id);
create index on facts (wedding_id, created_at);

alter table activities enable row level security;
alter table facts enable row level security;

-- Seeds the demo Sangeet atomically: activities and facts in one transaction, or nothing.
-- Returns false (and changes nothing) when the wedding already has a plan.
create or replace function seed_demo_plan(p_wedding uuid, p_activities jsonb, p_facts jsonb)
returns boolean
language plpgsql
as $$
begin
  -- Serialize concurrent seeds of the same wedding.
  perform pg_advisory_xact_lock(hashtext(p_wedding::text));
  if exists (select 1 from activities where wedding_id = p_wedding) then
    return false;
  end if;

  insert into activities (wedding_id, key, function_kind, title, kind, start_min, end_min, flexible,
                          requires_amplified_music, can_overlap_with, requested_by_side, requested_by_name,
                          priority, source)
  select p_wedding, x.key, x.function_kind, x.title, x.kind, x.start_min, x.end_min, x.flexible,
         coalesce(x.requires_amplified_music, false), coalesce(x.can_overlap_with, '{}'),
         x.requested_by_side, x.requested_by_name, x.priority, 'seed'
  from jsonb_to_recordset(p_activities) as x(key text, function_kind text, title text, kind text, start_min int,
       end_min int, flexible boolean, requires_amplified_music boolean, can_overlap_with text[],
       requested_by_side text, requested_by_name text, priority text);

  insert into facts (wedding_id, kind, function_kind, value, status, channel, ref, wording)
  select p_wedding, x.kind, x.function_kind, x.value, x.status, x.channel, coalesce(x.ref, ''), coalesce(x.wording, '')
  from jsonb_to_recordset(p_facts) as x(kind text, function_kind text, value int, status text, channel text,
       ref text, wording text);

  return true;
end;
$$;

-- Only the server (service role) may call it.
revoke execute on function seed_demo_plan(uuid, jsonb, jsonb) from public, anon, authenticated;
