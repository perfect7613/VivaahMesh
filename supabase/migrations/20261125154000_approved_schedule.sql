-- Commit the schedule used by the spoken recap with the approval and timeline.
create function public.approve_revision_with_activities(
  p_wedding uuid, p_revision int, p_member uuid, p_proposal text, p_flags jsonb,
  p_recap jsonb, p_activities jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  outcome jsonb;
begin
  if jsonb_typeof(p_activities) is distinct from 'array' or jsonb_array_length(p_activities) = 0 then
    raise exception 'invalid approved schedule';
  end if;

  begin
    outcome := approve_revision(p_wedding, p_revision, p_member, p_proposal, p_flags, p_recap);
    if outcome->>'status' = 'stale' then
      -- The legacy function may encounter a missing activity after an earlier move.
      raise exception 'stale plan' using errcode = 'VM001';
    end if;
  exception when sqlstate 'VM001' then
    return outcome;
  end;

  if outcome->>'status' = 'ok' then
    update approvals a set approved_activities = p_activities
    from plan_revisions r
    where a.revision_id = r.id and r.wedding_id = p_wedding and r.revision = p_revision;
    if not found then raise exception 'approval schedule was not saved'; end if;
  end if;
  return outcome;
end;
$$;

revoke all on function public.approve_revision_with_activities(uuid, int, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_revision_with_activities(uuid, int, uuid, text, jsonb, jsonb, jsonb)
  to service_role;

-- These functions are called through PostgREST with the server's service role.
grant execute on function public.record_revision(uuid, text, jsonb, jsonb),
  public.respond_to_revision(uuid, int, uuid, text, text, text),
  public.approve_revision(uuid, int, uuid, text, jsonb, jsonb),
  public.add_fact(uuid, uuid, text, text, int, text, text, boolean)
  to service_role;

-- A poll may compile slowly while another household records a newer plan.
-- Reuse identical results and require a fresh read before recording a different result.
create function public.record_revision_if_current(
  p_wedding uuid, p_expected_revision int, p_fingerprint text, p_result jsonb, p_flags jsonb
) returns int
language plpgsql
set search_path = public
as $$
declare
  latest plan_revisions%rowtype;
begin
  perform 1 from weddings where id = p_wedding for update;
  select * into latest from plan_revisions
  where wedding_id = p_wedding order by revision desc limit 1;
  if latest.fingerprint = p_fingerprint then return latest.revision; end if;
  if coalesce(latest.revision, 0) <> p_expected_revision then return null; end if;
  return record_revision(p_wedding, p_fingerprint, p_result, p_flags);
end;
$$;

revoke all on function public.record_revision_if_current(uuid, int, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_revision_if_current(uuid, int, text, jsonb, jsonb)
  to service_role;
