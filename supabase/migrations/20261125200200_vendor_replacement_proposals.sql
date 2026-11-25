alter table public.vendors
  add column replaces_vendor_id uuid references public.vendors(id) on delete set null,
  add column replacement_contact text,
  add column cancellation_simulated boolean not null default false;

create unique index vendors_active_replacement on public.vendors (replaces_vendor_id)
  where replaces_vendor_id is not null and status <> 'cancelled';

create view public.pending_vendor_replacements with (security_invoker = true) as
select candidate.wedding_id, candidate.id, candidate.name, candidate.functions, candidate.seeded, candidate.quote_inr,
  cancelled.id as cancelled_vendor_id, cancelled.name as cancelled_vendor_name
from public.vendors candidate
join public.vendors cancelled on candidate.replaces_vendor_id = cancelled.id and candidate.wedding_id = cancelled.wedding_id
where candidate.status = 'shortlisted' and cancelled.status = 'cancelled';
revoke all on public.pending_vendor_replacements from public, anon, authenticated;
grant select on public.pending_vendor_replacements to service_role;

-- Cancelling a vendor invalidates its link and pairs the incident with the contact task.
create function public.cancel_lifecycle_vendor(
  p_wedding uuid, p_vendor uuid, p_member uuid, p_reason text, p_simulated boolean
)
returns text language plpgsql set search_path = public as $$
declare
  v vendors%rowtype;
  sample boolean;
begin
  perform 1 from weddings where id = p_wedding for update;
  perform 1 from members where id = p_member and wedding_id = p_wedding and (is_couple or is_parent_delegate);
  if not found then return 'forbidden'; end if;
  update vendors set status = 'cancelled', view_expires_at = now(), cancellation_simulated = p_simulated
  where id = p_vendor and wedding_id = p_wedding and status <> 'cancelled'
  returning * into v;
  if not found then return 'unchanged'; end if;
  sample := v.seeded or p_simulated;

  insert into tasks (wedding_id, title, kind, stage, owner_member_id, vendor_id, due_date, escalated, seeded)
  values
    (p_wedding, v.name || ' cancelled' || case when p_reason <> '' then ': ' || p_reason else '' end,
     'incident', 'day_of', p_member, v.id, current_date, true, sample),
    (p_wedding, 'Find a replacement ' || replace(v.category, '_', ' ') || ' for ' ||
     coalesce(nullif(array_to_string(v.functions, ', '), ''), 'the wedding'),
     'replacement', 'day_of', p_member, v.id, current_date + 2, false, sample);
  insert into events (wedding_id, actor_member_id, kind, payload)
  values (p_wedding, p_member, 'vendor_cancelled',
    jsonb_build_object('vendor', v.name, 'category', v.category, 'sample', sample));
  return 'ok';
end;
$$;

create or replace function public.cancel_lifecycle_vendor(p_wedding uuid, p_vendor uuid, p_member uuid, p_reason text)
returns text language sql set search_path = public as $$
  select cancel_lifecycle_vendor(p_wedding, p_vendor, p_member, p_reason, false);
$$;

create function public.propose_lifecycle_replacement(
  p_wedding uuid, p_vendor uuid, p_member uuid, p_name text, p_contact text, p_run_sheet text, p_quote bigint
)
returns text language plpgsql set search_path = public as $$
declare
  v vendors%rowtype;
  actor members%rowtype;
begin
  perform 1 from weddings where id = p_wedding for update;
  select * into actor from members where id = p_member and wedding_id = p_wedding;
  if not found or not (actor.is_couple or actor.is_parent_delegate)
    or (p_quote is not null and not actor.is_couple) then return 'forbidden'; end if;

  select * into v from vendors where id = p_vendor and wedding_id = p_wedding and status = 'cancelled';
  if not found then return 'no_cancelled_vendor'; end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_contact), '') is null or p_quote < 0 then
    return 'invalid_replacement';
  end if;
  if exists (
    select 1 from vendors where replaces_vendor_id = v.id and status <> 'cancelled'
  ) then return 'replacement_already_proposed'; end if;

  insert into vendors (wedding_id, name, category, origin, functions, quote_inr, planned_inr, replacement_contact, run_sheet, seeded, replaces_vendor_id)
  values (p_wedding, p_name, v.category, 'sourced', v.functions, p_quote, p_quote, p_contact, p_run_sheet,
    v.seeded or v.cancellation_simulated, v.id);
  update tasks set evidence = 'Replacement contact recorded for ' || p_name, status = 'done', done_at = now()
  where wedding_id = p_wedding and vendor_id = v.id and kind = 'replacement';
  return 'ok';
end;
$$;

-- Replacement proposals reuse the same revision, response and couple approval contracts.
-- They authorize a vendor package without changing the previously approved schedule.
create or replace function public.approve_revision_with_activities(
  p_wedding uuid, p_revision int, p_member uuid, p_proposal text, p_flags jsonb,
  p_recap jsonb, p_activities jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  outcome jsonb;
  rev plan_revisions%rowtype;
  prop jsonb;
  replacement jsonb;
begin
  if p_proposal like 'replacement-%' then
    perform 1 from weddings where id = p_wedding for update;
    perform 1 from members where id = p_member and wedding_id = p_wedding and is_couple;
    if not found then return jsonb_build_object('status', 'not_couple'); end if;

    select * into rev from plan_revisions where wedding_id = p_wedding order by revision desc limit 1;
    if not found or p_revision <> rev.revision then
      return jsonb_build_object('status', 'stale', 'current_revision', rev.revision);
    end if;
    if exists (select 1 from approvals where revision_id = rev.id) then
      return jsonb_build_object('status', 'already_approved');
    end if;
    select item into prop from jsonb_array_elements(rev.result->'proposals') item where item->>'id' = p_proposal;
    replacement := prop->'vendorReplacement';
    if replacement is null then return jsonb_build_object('status', 'bad_proposal'); end if;

    update vendors v set status = 'authorized', authorized_by = p_member, authorized_at = now(), committed_inr = v.quote_inr
    where v.id = (replacement->>'vendorId')::uuid and v.wedding_id = p_wedding and v.status = 'shortlisted'
      and v.replaces_vendor_id = (replacement->>'cancelledVendorId')::uuid
      and exists (select 1 from vendors previous where previous.id = v.replaces_vendor_id
        and previous.wedding_id = p_wedding and previous.status = 'cancelled');
    if not found then return jsonb_build_object('status', 'stale', 'current_revision', rev.revision); end if;

    insert into approvals (wedding_id, function_kind, proposal_id, proposal, snapshot_revision, policy_version,
                           approved_by, revision_id, flags, recap)
    values (p_wedding, 'wedding', p_proposal, prop, p_revision, coalesce(rev.result->>'policyVersion', 'default'),
            p_member, rev.id, coalesce(p_flags, '{}'::jsonb), p_recap);
    return jsonb_build_object('status', 'ok', 'current_revision', rev.revision);
  end if;

  if jsonb_typeof(p_activities) is distinct from 'array' or jsonb_array_length(p_activities) = 0 then
    raise exception 'invalid approved schedule';
  end if;

  begin
    outcome := approve_revision(p_wedding, p_revision, p_member, p_proposal, p_flags, p_recap);
    if outcome->>'status' = 'stale' then
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

revoke all on function public.cancel_lifecycle_vendor(uuid, uuid, uuid, text, boolean),
  public.propose_lifecycle_replacement(uuid, uuid, uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.cancel_lifecycle_vendor(uuid, uuid, uuid, text, boolean),
  public.propose_lifecycle_replacement(uuid, uuid, uuid, text, text, text, bigint)
  to service_role;
