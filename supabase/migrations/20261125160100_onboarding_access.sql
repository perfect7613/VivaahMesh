-- API clients authenticate through the server. Explicit grants support both legacy
-- Supabase projects and projects without automatic service-role privileges.
revoke all on table public.weddings, public.households, public.members, public.functions,
  public.priorities, public.events, public.activities, public.facts, public.calls,
  public.agent_runs, public.ui_strings, public.approvals, public.channels,
  public.group_messages, public.agent_messages, public.plan_revisions, public.household_responses,
  public.family_plan_requirements, public.makeup_enquiries from public, anon, authenticated;
grant select, insert, update, delete on table public.weddings, public.households, public.members,
  public.functions, public.priorities, public.events, public.activities, public.facts, public.calls,
  public.agent_runs, public.ui_strings, public.approvals, public.channels, public.group_messages,
  public.agent_messages, public.plan_revisions, public.household_responses, public.family_plan_requirements,
  public.makeup_enquiries to service_role;
revoke all on sequence public.events_id_seq from public, anon, authenticated;
grant usage on sequence public.events_id_seq to service_role;

revoke all on function public.seed_demo_plan(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.seed_demo_plan(uuid, jsonb, jsonb) to service_role;

-- A relationship label is self-reported. Couples can delegate parent privileges separately.
alter table public.members add column is_parent_delegate boolean not null default false;
alter table public.members add constraint members_parent_delegate_role
  check (not is_parent_delegate or role = 'parent');

-- Preexisting members retain the permissions they had before this migration.
-- The couple can review and revoke those permissions in the family roster.
update public.members set is_parent_delegate = true where role = 'parent';

-- New invitations use more entropy. Existing invite links continue to work.
alter table public.households alter column invite_code set default replace(gen_random_uuid()::text, '-', '');
alter table public.weddings alter column couple_code set default replace(gen_random_uuid()::text, '-', '');

-- Resolve the invitation and commit membership, wishes, and the activity feed together.
create function public.join_wedding(
  p_code text, p_telegram bigint, p_name text, p_role text, p_language text,
  p_priorities jsonb, p_visibility text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  family households%rowtype;
  existing members%rowtype;
  member members%rowtype;
  wedding uuid;
  partner_invite boolean := false;
  priority_count integer;
begin
  select * into family from households where invite_code = p_code;
  if found then
    wedding := family.wedding_id;
  else
    select w.id into wedding from weddings w where w.couple_code = p_code;
    if not found then return jsonb_build_object('status', 'missing'); end if;
    select * into family from households where wedding_id = wedding and side = 'B';
    if not found then return jsonb_build_object('status', 'missing'); end if;
    partner_invite := true;
  end if;

  perform 1 from weddings where id = wedding for update;
  select * into existing from members where wedding_id = wedding and tg_user_id = p_telegram;
  if found then
    if existing.household_id is distinct from family.id then
      return jsonb_build_object('status', 'other_household');
    end if;
    if partner_invite and not existing.is_couple then
      return jsonb_build_object('status', 'already_joined');
    end if;
    return jsonb_build_object('status', 'existing', 'weddingId', wedding, 'memberId', existing.id);
  end if;

  -- The code is for the second partner. Concurrent attempts serialize on the wedding row.
  if partner_invite and (select count(*) from members where wedding_id = wedding and is_couple) >= 2 then
    return jsonb_build_object('status', 'partner_invite_used');
  end if;

  insert into members (wedding_id, household_id, tg_user_id, display_name, role, is_couple, language)
  values (
    wedding, family.id, p_telegram, p_name,
    case when partner_invite then 'couple'
         when p_role in ('parent','grandparent','sibling','cousin','relative','friend') then p_role
         else 'family' end,
    partner_invite, p_language
  ) returning * into member;

  insert into priorities (wedding_id, household_id, member_id, kind, note, source, visibility)
  select wedding, family.id, member.id, wish.kind, wish.note, 'app', p_visibility
  from jsonb_to_recordset(p_priorities) as wish(kind text, note text);
  get diagnostics priority_count = row_count;
  if priority_count > 0 then
    insert into events (wedding_id, actor_member_id, kind, payload)
    values (wedding, member.id, 'priority_added', jsonb_build_object('count', priority_count, 'source', 'app'));
  end if;
  insert into events (wedding_id, actor_member_id, kind, payload)
  values (wedding, member.id, 'member_joined', jsonb_build_object('family', family.name));

  return jsonb_build_object('status', 'joined', 'weddingId', wedding, 'memberId', member.id);
end;
$$;
revoke all on function public.join_wedding(text, bigint, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.join_wedding(text, bigint, text, text, text, jsonb, text) to service_role;

create function public.set_parent_access(p_wedding uuid, p_telegram bigint, p_member uuid, p_granted boolean)
returns text
language plpgsql
set search_path = public
as $$
declare
  actor uuid;
begin
  select id into actor from members where wedding_id = p_wedding and tg_user_id = p_telegram and is_couple;
  if not found then return 'couple_only'; end if;

  update members set is_parent_delegate = p_granted
  where id = p_member and wedding_id = p_wedding and role = 'parent' and not is_couple;
  if not found then return 'parent_not_found'; end if;

  insert into events (wedding_id, actor_member_id, kind, payload)
  values (p_wedding, actor, 'parent_access_changed', jsonb_build_object('member_id', p_member, 'granted', p_granted));
  return 'ok';
end;
$$;
revoke all on function public.set_parent_access(uuid, bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_parent_access(uuid, bigint, uuid, boolean) to service_role;

-- Create the authority-bearing creator membership together with the wedding.
create function public.create_wedding(p_telegram bigint, p_partner_a text, p_partner_b text, p_date date,
  p_city text, p_guests int, p_budget bigint, p_family_a text, p_family_b text, p_name text,
  p_language text, p_functions jsonb)
returns uuid language plpgsql set search_path = public as $$
declare
  wedding uuid;
  family uuid;
  creator uuid;
begin
  insert into weddings (partner_a, partner_b, wedding_date, city, guest_count, budget_inr, created_by_tg)
  values (p_partner_a, p_partner_b, p_date, p_city, p_guests, p_budget, p_telegram) returning id into wedding;
  insert into households (wedding_id, side, name) values (wedding, 'A', p_family_a) returning id into family;
  insert into households (wedding_id, side, name) values (wedding, 'B', p_family_b);
  insert into functions (wedding_id, kind, title, sort)
    select wedding, value->>'kind', value->>'title', position - 1
    from jsonb_array_elements(p_functions) with ordinality as f(value, position);
  insert into members (wedding_id, household_id, tg_user_id, display_name, role, is_couple, language)
  values (wedding, family, p_telegram, p_name, 'couple', true, p_language) returning id into creator;
  insert into events (wedding_id, actor_member_id, kind) values (wedding, creator, 'wedding_created');
  return wedding;
end;
$$;
revoke all on function public.create_wedding(bigint,text,text,date,text,int,bigint,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_wedding(bigint,text,text,date,text,int,bigint,text,text,text,text,jsonb) to service_role;
