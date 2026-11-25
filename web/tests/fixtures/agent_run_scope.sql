begin;

do $$
declare
  first_wedding uuid;
  second_wedding uuid;
  first_run uuid;
  request integer;
begin
  insert into weddings (partner_a, partner_b) values ('First', 'Wedding')
  returning id into first_wedding;
  insert into weddings (partner_a, partner_b) values ('Second', 'Wedding')
  returning id into second_wedding;

  insert into agent_runs (wedding_id, trigger, model)
  values (first_wedding, 'manual', 'test') returning id into first_run;

  begin
    insert into agent_runs (wedding_id, trigger, model)
    values (first_wedding, 'heartbeat', 'test');
    raise exception 'Multiple active agent runs for one wedding';
  exception when unique_violation then
    null;
  end;

  insert into agent_runs (wedding_id, trigger, model)
  values (second_wedding, 'heartbeat', 'test');

  update agent_runs set status = 'done' where id = first_run;
  insert into agent_runs (wedding_id, trigger, model)
  values (first_wedding, 'message', 'test');

  for request in 1..20 loop
    if not take_voice_request('tg:123', 'planning-agent', 20, 86400) then
      raise exception 'Rejected permitted interactive request %', request;
    end if;
  end loop;
  if take_voice_request('tg:123', 'planning-agent', 20, 86400) then
    raise exception 'Accepted request beyond the interactive limit';
  end if;
  if not take_voice_request('tg:456', 'planning-agent', 20, 86400)
      or not take_voice_request('tg:123', 'family-dictate', 20, 86400) then
    raise exception 'Interactive quota affected a different user or operation';
  end if;

  update voice_request_limits set window_ends_at = now() - interval '1 second'
  where scope = 'tg:123' and operation = 'planning-agent';
  if not take_voice_request('tg:123', 'planning-agent', 20, 86400) then
    raise exception 'Expired interactive quota could not restart';
  end if;
end;
$$;

rollback;
