-- Run with psql -v ON_ERROR_STOP=1 against an isolated database with the migrations applied.
begin;
do $$
declare
  wedding uuid;
  approver uuid;
  proposal jsonb;
  schedule jsonb := '[{"id":"dance","functionKind":"sangeet","title":"Dance","kind":"dance","start":1270,"end":1290}]';
begin
  insert into weddings (partner_a, partner_b) values ('A', 'B') returning id into wedding;
  insert into members (wedding_id, display_name, is_couple) values (wedding, 'A', true) returning id into approver;
  insert into activities (wedding_id, key, function_kind, title, kind, start_min, end_min)
    values (wedding, 'dance', 'sangeet', 'Dance', 'dance', 1305, 1325);

  proposal := '{"id":"dance","moves":[{"activityId":"dance","to":{"start":1270,"end":1290}},{"activityId":"missing","to":{"start":1250,"end":1270}}]}';
  assert record_revision(wedding, 'fixture-1', jsonb_build_object('proposals', jsonb_build_array(proposal)), '{}') = 1;
  assert approve_revision_with_activities(wedding, 1, approver, 'dance', '{}', '{}', schedule)->>'status' = 'stale';
  assert (select start_min from activities where wedding_id = wedding and key = 'dance') = 1305,
    'The earlier move must roll back when the proposal is stale.';
  assert not exists (select 1 from approvals where wedding_id = wedding);

  proposal := '{"id":"dance","moves":[{"activityId":"dance","to":{"start":1270,"end":1290}}]}';
  assert record_revision(wedding, 'fixture-2', jsonb_build_object('proposals', jsonb_build_array(proposal)), '{}') = 2;
  assert approve_revision_with_activities(wedding, 1, approver, 'dance', '{}', '{}', schedule)->>'status' = 'stale';
  assert approve_revision_with_activities(wedding, 2, approver, 'dance', '{}', '{}', schedule)->>'status' = 'ok';
  assert exists (select 1 from approvals where wedding_id = wedding and snapshot_revision = 2 and approved_activities = schedule),
    'Persist the approved schedule with the approval for Bulbul.';
  assert (select start_min from activities where wedding_id = wedding and key = 'dance') = 1270;
end;
$$;
rollback;
