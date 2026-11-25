-- Archive late replays without replacing a newer confirmed vendor answer.
create function public.apply_call_evidence_ordered(p_call uuid, p_evidence jsonb, p_follow_ups integer)
returns text language plpgsql set search_path = '' as $$
declare
  attempt public.calls%rowtype;
  row jsonb;
  previous_fact uuid;
  prior_facts uuid[];
  newest_confirmed boolean;
  source_channel text;
  superseding_fact uuid;
begin
  select * into attempt from public.calls where id = p_call for update;
  if not found or attempt.processed_at is not null or attempt.result is null then
    return 'already';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence) = 0
    or p_follow_ups is null or p_follow_ups < 0 then
    raise exception 'invalid call evidence';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    attempt.wedding_id::text || ':' || attempt.function_kind || ':' || attempt.fact_kind, 0));
  newest_confirmed := p_evidence->-1->>'status' = 'confirmed';
  source_channel := case attempt.flags->>'channel' when 'browser' then 'browser_agent'
    when 'rehearsal' then 'seed' else 'samvaad_call' end;

  -- A callback waiting for provider analytics can finish after a later result.
  -- Preserve its whole chain below that later answer. An unresolved later call
  -- cannot hide a usable answer from this call.
  select newer.fact_id into superseding_fact
  from public.calls newer
  join public.facts answer on answer.id = newer.fact_id
  where newer.wedding_id = attempt.wedding_id
    and newer.function_kind = attempt.function_kind
    and newer.fact_kind = attempt.fact_kind
    and answer.status = 'confirmed'
    and (coalesce(newer.result_received_at, newer.created_at), newer.created_at, newer.id)
      > (coalesce(attempt.result_received_at, attempt.created_at), attempt.created_at, attempt.id)
  order by coalesce(newer.result_received_at, newer.created_at), newer.created_at, newer.id
  limit 1;
  if newest_confirmed and superseding_fact is null then
    select coalesce(array_agg(f.id), '{}'::uuid[]) into prior_facts
    from public.facts f
    where f.wedding_id = attempt.wedding_id and f.function_kind = attempt.function_kind
      and f.kind = attempt.fact_kind and not exists (
        select 1 from public.calls later where later.fact_id = f.id
          and (coalesce(later.result_received_at, later.created_at), later.created_at, later.id)
            > (coalesce(attempt.result_received_at, attempt.created_at), attempt.created_at, attempt.id)
      ) and not exists (
        select 1 from public.facts newer where newer.wedding_id = f.wedding_id
          and newer.kind = f.kind and newer.function_kind = f.function_kind and f.id = any(newer.supersedes)
      );
  else
    prior_facts := '{}'::uuid[];
  end if;

  for row in select value from jsonb_array_elements(p_evidence) loop
    insert into public.facts(wedding_id, function_kind, kind, value, status, channel, ref, wording, supersedes)
    values (attempt.wedding_id, attempt.function_kind, attempt.fact_kind, (row->>'value')::integer,
      row->>'status', source_channel, coalesce(attempt.provider_attempt_id, attempt.id::text),
      case when source_channel = 'seed' then '[Rehearsal] ' else '' end
        || coalesce(row->'source'->>'wording', ''), prior_facts)
    returning id into previous_fact;
    prior_facts := array[previous_fact];
  end loop;

  if superseding_fact is not null then
    update public.facts set supersedes = array_append(supersedes, previous_fact)
    where id = superseding_fact;
  end if;

  update public.calls set processed_at = now(), fact_id = previous_fact, follow_up_count = p_follow_ups
  where id = attempt.id;
  insert into public.events(wedding_id, kind, payload) values
    (attempt.wedding_id, 'call_result_applied', jsonb_build_object(
      'call_id', attempt.id, 'value', p_evidence->-1->'value', 'status', p_evidence->-1->>'status',
      'superseded', superseding_fact is not null));
  return case when superseding_fact is null then 'applied' else 'superseded' end;
end;
$$;
revoke all on function public.apply_call_evidence_ordered(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.apply_call_evidence_ordered(uuid, jsonb, integer) to service_role;

-- Keep existing clients compatible during worker and web rollouts.
create or replace function public.apply_call_evidence(p_call uuid, p_evidence jsonb, p_follow_ups integer)
returns boolean language sql set search_path = '' as $$
  select public.apply_call_evidence_ordered(p_call, p_evidence, p_follow_ups) = 'applied';
$$;
