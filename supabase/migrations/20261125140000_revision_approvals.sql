-- Issue #5: revision-bound couple approval, built on the `approvals` table created in
-- 20261125130000_languages_functions_approvals.sql (this file extends it; it does not redefine it).
--
-- A plan revision is a stored compile result. Households respond to a revision, and the couple
-- approves one exact revision. Every check that must be atomic lives in a function below:
--   record_revision      new revision only when the plan state (fingerprint) changed
--   respond_to_revision  one response per household per revision; two phones never overwrite each other
--   approve_revision     conditional on the expected revision; a stale approval changes nothing

create table plan_revisions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  revision int not null check (revision >= 1),
  -- Hash of activities + facts in force + compiler policy (see web/src/lib/revisions.ts).
  fingerprint text not null,
  -- The compile result (conflicts, proposals, conditional, blocking) families responded to.
  result jsonb not null,
  -- Flagsmith snapshot that produced it: source, compiler policy and feature values.
  flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (wedding_id, revision)
);

create table household_responses (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  revision_id uuid not null references plan_revisions(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  proposal_id text not null,
  stance text not null check (stance in ('agree','prefer_other','object')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  -- One response per household per revision: the latest answer from that household wins.
  unique (revision_id, household_id)
);

-- `approvals` already exists (function_kind, proposal, snapshot_revision, policy_version, approved_by,
-- created_at). Here snapshot_revision holds the plan REVISION number the couple approved.
-- Rows made by the earlier flow have revision_id = null and are ignored by the revision-bound views.
alter table approvals add column if not exists revision_id uuid references plan_revisions(id) on delete cascade;
-- Flagsmith snapshot at the moment of approval.
alter table approvals add column if not exists flags jsonb not null default '{}'::jsonb;
-- What was approved, as structured data (moves, cost, reasons) for the recap.
alter table approvals add column if not exists recap jsonb not null default '{}'::jsonb;
-- One approval per revision.
create unique index if not exists approvals_revision_id_key on approvals (revision_id) where revision_id is not null;

-- The revision whose approval produced the current committed timeline (the activities table).
alter table weddings add column committed_revision int;

create index on plan_revisions (wedding_id, revision desc);
create index on household_responses (revision_id);

alter table plan_revisions enable row level security;
alter table household_responses enable row level security;

-- Returns the current revision number, inserting a new revision only if the fingerprint changed.
create or replace function record_revision(p_wedding uuid, p_fingerprint text, p_result jsonb, p_flags jsonb)
returns int
language plpgsql
as $$
declare
  latest plan_revisions%rowtype;
  next_rev int;
begin
  -- Serializes revision creation (and approval) per wedding.
  perform 1 from weddings where id = p_wedding for update;
  select * into latest from plan_revisions where wedding_id = p_wedding order by revision desc limit 1;
  if found and latest.fingerprint = p_fingerprint then
    return latest.revision;
  end if;
  next_rev := coalesce(latest.revision, 0) + 1;
  insert into plan_revisions (wedding_id, revision, fingerprint, result, flags)
  values (p_wedding, next_rev, p_fingerprint, p_result, coalesce(p_flags, '{}'::jsonb));
  return next_rev;
end;
$$;

-- Stores (or replaces) one household's response to the CURRENT revision.
-- Status: ok | stale (with current_revision) | no_household | bad_proposal.
create or replace function respond_to_revision(
  p_wedding uuid, p_revision int, p_member uuid, p_proposal text, p_stance text, p_note text
)
returns jsonb
language plpgsql
as $$
declare
  m members%rowtype;
  rev plan_revisions%rowtype;
  latest int;
begin
  select * into m from members where id = p_member and wedding_id = p_wedding;
  if not found or m.household_id is null then
    return jsonb_build_object('status', 'no_household');
  end if;
  -- Shared lock: many households may respond at once, but not while a revision is being
  -- recorded or approved (those take FOR UPDATE).
  perform 1 from weddings where id = p_wedding for share;
  select max(revision) into latest from plan_revisions where wedding_id = p_wedding;
  if latest is null or p_revision <> latest then
    return jsonb_build_object('status', 'stale', 'current_revision', latest);
  end if;
  select * into rev from plan_revisions where wedding_id = p_wedding and revision = p_revision;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(rev.result->'proposals', '[]'::jsonb)) p where p->>'id' = p_proposal
    union all
    select 1 from jsonb_array_elements(coalesce(rev.result->'conditional', '[]'::jsonb)) p where p->>'id' = p_proposal
  ) then
    return jsonb_build_object('status', 'bad_proposal');
  end if;

  insert into household_responses (wedding_id, revision_id, household_id, member_id, proposal_id, stance, note)
  values (p_wedding, rev.id, m.household_id, m.id, p_proposal, p_stance, coalesce(p_note, ''))
  on conflict (revision_id, household_id) do update
    set member_id = excluded.member_id,
        proposal_id = excluded.proposal_id,
        stance = excluded.stance,
        note = excluded.note,
        updated_at = now();
  return jsonb_build_object('status', 'ok', 'current_revision', latest);
end;
$$;

-- Couple approval of one proposal in one exact revision. Applies its moves to the activities
-- (the committed timeline) and records who approved, which revision and the flag snapshot.
-- Status: ok | stale (with current_revision) | not_couple | bad_proposal | already_approved.
-- Conditional proposals cannot be approved: they still wait for an answer.
create or replace function approve_revision(
  p_wedding uuid, p_revision int, p_member uuid, p_proposal text, p_flags jsonb, p_recap jsonb
)
returns jsonb
language plpgsql
as $$
declare
  m members%rowtype;
  rev plan_revisions%rowtype;
  latest int;
  prop jsonb;
  mv jsonb;
  act record;
  fk text := 'wedding';
begin
  perform 1 from weddings where id = p_wedding for update;

  select * into m from members where id = p_member and wedding_id = p_wedding;
  if not found or not m.is_couple then
    return jsonb_build_object('status', 'not_couple');
  end if;

  select max(revision) into latest from plan_revisions where wedding_id = p_wedding;
  if latest is null or p_revision <> latest then
    return jsonb_build_object('status', 'stale', 'current_revision', latest);
  end if;

  select * into rev from plan_revisions where wedding_id = p_wedding and revision = p_revision;
  if exists (select 1 from approvals where revision_id = rev.id) then
    return jsonb_build_object('status', 'already_approved', 'current_revision', latest);
  end if;

  select p into prop
  from jsonb_array_elements(coalesce(rev.result->'proposals', '[]'::jsonb)) p
  where p->>'id' = p_proposal
  limit 1;
  if prop is null then
    return jsonb_build_object('status', 'bad_proposal');
  end if;

  for mv in select * from jsonb_array_elements(prop->'moves') loop
    -- No "still starts where the proposal saw it" guard: the wedding row is locked above, and the
    -- activities only change inside this function, so the revision check already guarantees the
    -- timeline is what the proposal was computed from. (A start-time guard broke for activities
    -- whose displayed time comes from a confirmed fact rather than the stored row.)
    update activities
       set start_min = (mv->'to'->>'start')::int,
           end_min = (mv->'to'->>'end')::int
     where wedding_id = p_wedding
       and key = mv->>'activityId'
    returning function_kind, kind into act;
    if not found then
      return jsonb_build_object('status', 'stale', 'current_revision', latest);
    end if;
    fk := act.function_kind;

    -- Extending video coverage: the compiler trusts the confirmed coverage_end FACT over the
    -- activity's end. Record the approved end as a new fact that supersedes the ones in force,
    -- or the same conflict (and the same proposal) would come straight back. The channel
    -- 'typed' and the wording say it was authorised by the couple, not confirmed by the vendor.
    if act.kind = 'coverage' then
      insert into facts (wedding_id, kind, function_kind, value, status, channel, ref, wording, supersedes, author_member_id)
      select p_wedding, 'coverage_end', act.function_kind, (mv->'to'->>'end')::int, 'confirmed', 'typed',
             m.id::text, 'Couple approved extending coverage (revision ' || p_revision || ')',
             coalesce((
               select array_agg(f.id) from facts f
               where f.wedding_id = p_wedding and f.kind = 'coverage_end' and f.function_kind = act.function_kind
                 and not exists (select 1 from facts g where g.wedding_id = p_wedding and f.id = any (g.supersedes))
             ), '{}'),
             m.id;
    end if;
  end loop;

  insert into approvals (wedding_id, function_kind, proposal_id, proposal, snapshot_revision, policy_version,
                         approved_by, revision_id, flags, recap)
  values (p_wedding, fk, p_proposal, prop, p_revision,
          coalesce(rev.result->>'policyVersion', 'default'),
          m.id, rev.id, coalesce(p_flags, '{}'::jsonb), coalesce(p_recap, '{}'::jsonb));
  update weddings set committed_revision = p_revision where id = p_wedding;
  return jsonb_build_object('status', 'ok', 'current_revision', latest);
end;
$$;

-- Only the server (service role) may call these.
revoke execute on function record_revision(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function respond_to_revision(uuid, int, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function approve_revision(uuid, int, uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- Adds a typed fact atomically. It takes the same per-wedding lock as revision recording and
-- approval, and supersedes EVERY fact of that kind and function still in force. Reading the live
-- facts and inserting in two separate steps let two simultaneous facts both supersede only the old
-- ones, leaving a contradiction between themselves.
create or replace function add_fact(
  p_wedding uuid, p_member uuid, p_kind text, p_function text, p_value int, p_status text, p_wording text,
  p_replace_only_typed boolean default false
)
returns void
language plpgsql
as $$
begin
  perform 1 from weddings where id = p_wedding for update;
  if not exists (select 1 from members where id = p_member and wedding_id = p_wedding) then
    raise exception 'not_a_member';
  end if;
  insert into facts (wedding_id, kind, function_kind, value, status, channel, ref, wording, supersedes, author_member_id)
  values (
    p_wedding, p_kind, p_function, p_value, p_status, 'typed', p_member::text, coalesce(p_wording, ''),
    coalesce((
      select array_agg(f.id) from facts f
      where f.wedding_id = p_wedding and f.kind = p_kind and f.function_kind = p_function
        -- Vendor terms: a typed answer may only replace earlier typed answers, never a call or a quote.
        and (not p_replace_only_typed or f.channel = 'typed')
        and not exists (select 1 from facts g where g.wedding_id = p_wedding and f.id = any (g.supersedes))
    ), '{}'),
    p_member
  );
end;
$$;

revoke execute on function add_fact(uuid, uuid, text, text, int, text, text, boolean) from public, anon, authenticated;
