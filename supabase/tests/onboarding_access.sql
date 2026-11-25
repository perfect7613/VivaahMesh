-- Run with psql -X -v ON_ERROR_STOP=1 against a disposable database with all migrations applied.
begin;

do $$
declare
  parent_function text := 'public.set_parent_access(uuid,bigint,uuid,boolean)';
  function_name text := 'public.join_wedding(text,bigint,text,text,text,jsonb,text)';
begin
  assert not has_function_privilege('anon', function_name, 'EXECUTE'), 'Anonymous join RPC grant';
  assert not has_function_privilege('authenticated', function_name, 'EXECUTE'), 'Authenticated join RPC grant';
  assert not has_function_privilege('anon', parent_function, 'EXECUTE'), 'Anonymous parent access RPC grant';
  assert not has_function_privilege('authenticated', parent_function, 'EXECUTE'), 'Authenticated parent access RPC grant';
  assert has_function_privilege('service_role', parent_function, 'EXECUTE'), 'Missing service parent access grant';
  assert has_function_privilege('service_role', function_name, 'EXECUTE'), 'Missing service join grant';
  assert has_function_privilege('service_role', 'public.seed_demo_plan(uuid,jsonb,jsonb)', 'EXECUTE'), 'Missing service seed grant';
  assert not has_table_privilege('anon', 'public.members', 'SELECT'), 'Anonymous member table access';
  assert not has_table_privilege('authenticated', 'public.priorities', 'SELECT'), 'Direct priority table access';
end;
$$;

set local role service_role;
do $$
declare
  wedding_id uuid;
  family_a uuid;
  other_wedding uuid;
  other_parent uuid;
  invite_a text;
  invite_b text;
  partner_invite text;
  joined jsonb;
  repeated jsonb;
  joined_member_id uuid;
begin
  insert into public.weddings (partner_a, partner_b) values ('Person A', 'Person B')
  returning id, couple_code into wedding_id, partner_invite;
  insert into public.households (wedding_id, side, name) values (wedding_id, 'A', 'Family A')
  returning id, invite_code into family_a, invite_a;
  insert into public.households (wedding_id, side, name) values (wedding_id, 'B', 'Family B')
  returning invite_code into invite_b;
  insert into public.members (wedding_id, household_id, tg_user_id, display_name, role, is_couple)
  values (wedding_id, family_a, 101, 'Person A', 'couple', true);
  assert length(invite_a) = 32 and length(partner_invite) = 32, 'New invite length';

  joined := public.join_wedding(invite_a, 102, 'Parent A', 'parent', 'en', '[{"kind":"note","note":"Family A note"}]', 'household');
  assert joined->>'status' = 'joined', 'First join failed';
  joined_member_id := (joined->>'memberId')::uuid;
  assert (select role = 'parent' and not is_parent_delegate from public.members where id = joined_member_id), 'Parent privilege requires approval';
  assert public.set_parent_access(wedding_id, 102, joined_member_id, true) = 'couple_only', 'Non-couple delegated access';
  assert public.set_parent_access(wedding_id, 101, joined_member_id, true) = 'ok', 'Couple could not delegate access';
  assert (select is_parent_delegate from public.members where id = joined_member_id), 'Parent access not granted';
  assert public.set_parent_access(wedding_id, 101, joined_member_id, false) = 'ok', 'Couple could not revoke access';
  assert (select not is_parent_delegate from public.members where id = joined_member_id), 'Parent access not revoked';
  insert into public.weddings (partner_a, partner_b) values ('Other A', 'Other B') returning id into other_wedding;
  insert into public.members (wedding_id, tg_user_id, display_name, role)
    values (other_wedding, 106, 'Other Parent', 'parent') returning id into other_parent;
  assert public.set_parent_access(wedding_id, 101, other_parent, true) = 'parent_not_found', 'Cross-wedding delegate changed';

  repeated := public.join_wedding(invite_a, 102, 'Different name', 'couple', 'hi', '[{"kind":"note","note":"Duplicate"}]', 'shared');
  assert repeated->>'status' = 'existing' and repeated->>'memberId' = joined->>'memberId', 'Join retry lost identity';
  assert (select role = 'parent' and not is_couple and display_name = 'Parent A' from public.members where id = joined_member_id), 'Repeat changed membership';
  assert (select count(*) = 1 from public.priorities p where p.member_id = joined_member_id), 'Retry duplicated notes';
  assert (public.join_wedding(invite_b, 102, 'Parent A', 'parent', 'en', '[]', 'shared')->>'status') = 'other_household', 'Membership switched families';

  joined := public.join_wedding(invite_b, 103, 'Guest', 'couple', 'en', '[]', 'shared');
  assert (select role = 'family' and not is_couple from public.members where id = (joined->>'memberId')::uuid), 'Household invite accepted a couple role';
  joined := public.join_wedding(partner_invite, 104, 'Person B', 'friend', 'en', '[]', 'shared');
  assert (select role = 'couple' and is_couple from public.members where id = (joined->>'memberId')::uuid), 'Partner invitation could not be redeemed';
  assert (public.join_wedding(partner_invite, 105, 'Someone else', 'friend', 'en', '[]', 'shared')->>'status') = 'partner_invite_used', 'Partner invitation granted a third couple role';
end;
$$;

do $$
declare
  wedding uuid;
begin
  wedding := public.create_wedding(200, 'A', 'B', null, 'City', 10, 1000, 'One', 'Two', 'A', 'en',
    '[{"kind":"other","title":"Custom"},{"kind":"sangeet","title":"Sangeet"}]'::jsonb);
  assert (select count(*) = 2 from households where wedding_id = wedding);
  assert (select is_couple from members where tg_user_id = 200 and wedding_id = wedding);
  assert (select sort = 1 from functions where wedding_id = wedding and kind = 'sangeet');
  assert (select count(*) = 1 from events where wedding_id = wedding and kind = 'wedding_created');
  begin
    perform public.create_wedding(201, 'A', 'B', null, null, null, null, 'One', 'Two', 'A', 'invalid-language', '[]');
    raise exception 'Invalid creator language succeeded';
  exception when check_violation then null;
  end;
  assert not exists (select 1 from weddings where created_by_tg = 201), 'Failed create left an unowned wedding';
  assert not has_function_privilege('anon', 'public.create_wedding(bigint,text,text,date,text,int,bigint,text,text,text,text,jsonb)', 'EXECUTE');
end;
$$;

rollback;
