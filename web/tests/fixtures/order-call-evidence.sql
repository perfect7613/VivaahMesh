-- Run with psql -v ON_ERROR_STOP=1 against an isolated database with the migrations applied.
begin;
do $$
declare
  wedding uuid;
  older uuid;
  newer uuid;
  unanswered uuid;
  older_fact uuid;
  newer_fact uuid;
  stored_payload jsonb := '{"original_transcript":[{"role":"user","text":"9 pm, actually 9:30 pm"}]}';
  older_chain jsonb := '[
    {"status":"confirmed","value":1260,"source":{"wording":"9 pm"}},
    {"status":"confirmed","value":1290,"source":{"wording":"actually 9:30 pm"}}
  ]';
  newer_chain jsonb := '[{"status":"confirmed","value":1320,"source":{"wording":"10 pm"}}]';
begin
  insert into weddings (partner_a, partner_b) values ('A', 'B') returning id into wedding;
  insert into calls (wedding_id, function_kind, fact_kind, recipient_role, recipient_name, recipient_phone,
      purpose, result_received_at, result)
    values (wedding, 'sangeet', 'music_cutoff', 'venue_owner', 'Venue', 'fixture',
      'cutoff', '2026-11-25T09:00:00Z', stored_payload)
    returning id into older;
  insert into calls (wedding_id, function_kind, fact_kind, recipient_role, recipient_name, recipient_phone,
      purpose, result_received_at, result)
    values (wedding, 'sangeet', 'music_cutoff', 'venue_owner', 'Venue', 'fixture',
      'cutoff', '2026-11-25T10:00:00Z', '{}')
    returning id into newer;
  insert into calls (wedding_id, function_kind, fact_kind, recipient_role, recipient_name, recipient_phone,
      purpose, result_received_at, result)
    values (wedding, 'sangeet', 'music_cutoff', 'venue_owner', 'Venue', 'fixture',
      'cutoff', '2026-11-25T11:00:00Z', '{"status":"no_answer"}')
    returning id into unanswered;

  assert apply_call_evidence_ordered(unanswered, '[{"status":"unresolved","value":null}]', 0) = 'applied';
  assert apply_call_evidence_ordered(newer, newer_chain, 0) = 'applied',
    'A later unanswered call should leave a usable answer eligible to apply.';
  assert apply_call_evidence_ordered(older, older_chain, 2) = 'superseded',
    'A replay must not present older evidence as the current answer.';
  assert apply_call_evidence_ordered(older, older_chain, 2) = 'already';

  select fact_id into newer_fact from calls where id = newer;
  select fact_id into older_fact from calls where id = older and result = stored_payload
    and processed_at is not null and follow_up_count = 2;
  assert older_fact is not null, 'Keep the verbatim result and the processing record.';
  assert exists (
    select 1 from facts latest
    join facts corrected on corrected.id = any(latest.supersedes)
    join facts original on original.id = any(corrected.supersedes)
    where latest.id = newer_fact and latest.value = 1320 and corrected.id = older_fact
      and corrected.value = 1290 and original.value = 1260
  ), 'Keep both parts of the correction underneath the newer answer.';
  assert not exists (
    select 1 from facts where wedding_id = wedding and newer_fact = any(supersedes)
  ), 'The newer answer should remain live.';
  assert not exists (
    select 1 from facts where wedding_id = wedding and
      (select fact_id from calls where id = unanswered) = any(supersedes)
  ), 'The later unanswered enquiry should remain open.';
  assert (select count(*) from events where wedding_id = wedding
    and kind = 'call_result_applied' and payload->>'call_id' = older::text) = 1;
end;
$$;
rollback;
