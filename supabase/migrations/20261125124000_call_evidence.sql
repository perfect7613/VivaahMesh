alter table calls add column follow_up_count integer check (follow_up_count >= 0);

-- The visit to Sarvam can be retried before this transaction, but a fact chain
-- and its exactly-once processing marker always commit together.
create function apply_call_evidence(p_call uuid, p_evidence jsonb, p_follow_ups integer)
returns boolean language plpgsql set search_path = public as $$
declare
  attempt calls%rowtype;
  row jsonb;
  previous_fact uuid;
  prior_facts uuid[];
  newest_confirmed boolean;
  source_channel text;
begin
  select * into attempt from calls where id = p_call for update;
  if not found or attempt.processed_at is not null or attempt.result is null then
    return false;
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence) = 0
    or p_follow_ups is null or p_follow_ups < 0 then
    raise exception 'invalid call evidence';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    attempt.wedding_id::text || ':' || attempt.function_kind || ':' || attempt.fact_kind, 0));
  newest_confirmed := p_evidence->-1->>'status' = 'confirmed';
  source_channel := case when attempt.flags->>'channel' = 'browser' then 'browser_agent' else 'samvaad_call' end;

  -- A usable correction replaces live prior terms in this function. An unclear
  -- call can supersede its own interim answers but leaves earlier calls intact.
  if newest_confirmed then
    select coalesce(array_agg(f.id), '{}'::uuid[]) into prior_facts
    from facts f
    where f.wedding_id = attempt.wedding_id and f.function_kind = attempt.function_kind
      and f.kind = attempt.fact_kind and not exists (
        select 1 from facts newer where newer.wedding_id = f.wedding_id
          and newer.kind = f.kind and newer.function_kind = f.function_kind and f.id = any(newer.supersedes)
      );
  else
    prior_facts := '{}'::uuid[];
  end if;

  for row in select value from jsonb_array_elements(p_evidence) loop
    insert into facts(wedding_id, function_kind, kind, value, status, channel, ref, wording, supersedes)
    values (attempt.wedding_id, attempt.function_kind, attempt.fact_kind, (row->>'value')::integer,
      row->>'status', source_channel, coalesce(attempt.provider_attempt_id, attempt.id::text),
      coalesce(row->'source'->>'wording', ''), prior_facts)
    returning id into previous_fact;
    prior_facts := array[previous_fact];
  end loop;

  update calls set processed_at = now(), fact_id = previous_fact, follow_up_count = p_follow_ups
  where id = attempt.id;
  insert into events(wedding_id, kind, payload) values
    (attempt.wedding_id, 'call_result_applied', jsonb_build_object(
      'call_id', attempt.id, 'value', p_evidence->-1->'value', 'status', p_evidence->-1->>'status'));
  return true;
end;
$$;
revoke execute on function apply_call_evidence(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function apply_call_evidence(uuid, jsonb, integer) to service_role;
