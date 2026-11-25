begin;
set local role service_role;

do $$
declare
  wedding uuid;
  other_wedding uuid;
  family_a uuid;
  family_b uuid;
  other_family uuid;
  code_a text;
  code_b text;
  other_code text;
  channel_a uuid;
  channel_b uuid;
begin
  insert into public.weddings (partner_a, partner_b) values ('Fixture A','Fixture B') returning id into wedding;
  insert into public.weddings (partner_a, partner_b) values ('Fixture C','Fixture D') returning id into other_wedding;
  insert into public.households (wedding_id, side, name) values (wedding, 'A', 'Family A') returning id, invite_code into family_a, code_a;
  insert into public.households (wedding_id, side, name) values (wedding, 'B', 'Family B') returning id, invite_code into family_b, code_b;
  insert into public.households (wedding_id, side, name) values (other_wedding, 'A', 'Other A') returning id, invite_code into other_family, other_code;

  if public.link_whatsapp_household('123456789@g.us', family_a, code_b, 'mr')
      or public.link_whatsapp_household('123456789@s.whatsapp.net', family_a, code_a, 'mr') then
    raise exception 'accepted wrong code or DM';
  end if;
  if not public.link_whatsapp_household('123456789@g.us', family_a, code_a, 'mr')
      or not public.link_whatsapp_household('987654321@g.us', family_b, code_b, 'hi') then
    raise exception 'valid group failed to link';
  end if;
  if public.link_whatsapp_household('123456789@g.us', other_family, other_code, 'en')
      or public.link_whatsapp_household('123450000@g.us', family_a, code_a, 'mr') then
    raise exception 'group or household rebound';
  end if;
  select id into channel_a from public.channels where chat_id = '123456789@g.us';
  select id into channel_b from public.channels where chat_id = '987654321@g.us';

  insert into public.priorities (wedding_id, household_id, kind, note, source, visibility,
    whatsapp_channel_id, whatsapp_message_id)
  values (wedding, family_a, 'note', 'fixture', 'whatsapp', 'household', channel_a, 'text-1');

  begin
    insert into public.priorities (wedding_id, household_id, kind, note, source, visibility,
      whatsapp_channel_id, whatsapp_message_id)
    values (wedding, family_a, 'note', 'duplicate', 'whatsapp', 'household', channel_a, 'text-1');
    raise exception 'accepted duplicate text';
  exception when unique_violation then
    null;
  end;

  if not public.claim_whatsapp_voice(channel_a, 'voice-1') then raise exception 'initial claim rejected'; end if;
  if public.claim_whatsapp_voice(channel_a, 'voice-1') then raise exception 'duplicate voice claim accepted'; end if;
  for i in 2..10 loop
    if not public.claim_whatsapp_voice(channel_a, 'voice-' || i) then raise exception 'early voice limit'; end if;
  end loop;
  if public.claim_whatsapp_voice(channel_a, 'voice-11') or not public.claim_whatsapp_voice(channel_b, 'voice-1') then
    raise exception 'incorrect household voice limit';
  end if;

  insert into public.members (wedding_id, household_id, display_name) values (wedding, family_a, 'New fixture');
  insert into public.members (wedding_id, household_id, display_name) values (other_wedding, other_family, 'Other new fixture');
  insert into public.plan_revisions (wedding_id, revision, fingerprint, result, flags)
    values (wedding, 1, 'fixture-plan', '{}'::jsonb, '{}'::jsonb);
  if (select count(*) from public.whatsapp_updates where channel_id = channel_a and kind = 'joined') <> 1
      or (select count(*) from public.whatsapp_updates where channel_id = channel_a and kind = 'plan') <> 1
      or (select count(*) from public.whatsapp_updates where channel_id = channel_b and kind = 'plan') <> 1
      or (select count(*) from public.whatsapp_updates where channel_id = channel_b and kind = 'joined') <> 0 then
    raise exception 'incorrect notice scope';
  end if;
  if has_table_privilege('authenticated', 'public.whatsapp_updates', 'SELECT')
      or has_function_privilege('anon', 'public.claim_whatsapp_voice(uuid,text)', 'EXECUTE') then
    raise exception 'bridge databases accessible to client roles';
  end if;
end;
$$;

rollback;
