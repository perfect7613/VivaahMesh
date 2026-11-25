-- Run with psql -X -v ON_ERROR_STOP=1 after all migrations in a disposable database.
begin;
do $$
declare
  rpc text;
begin
  foreach rpc in array array[
    'public.reserve_registry_item(uuid,uuid)',
    'public.reserve_guest_registry_item(text,uuid)',
    'public.record_guest_rsvp(text,uuid,boolean,integer,integer)',
    'public.cancel_lifecycle_vendor(uuid,uuid,uuid,text)',
    'public.advance_wedding_stage(uuid,uuid,text)'
  ] loop
    assert not has_function_privilege('anon', rpc, 'EXECUTE');
    assert not has_function_privilege('authenticated', rpc, 'EXECUTE');
    assert has_function_privilege('service_role', rpc, 'EXECUTE');
  end loop;
  assert not has_table_privilege('anon', 'public.guests', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.vendors', 'UPDATE');
end;
$$;

set local role service_role;
do $$
declare
  a uuid;
  b uuid;
  a_couple uuid;
  b_couple uuid;
  relative_parent uuid;
  a_guest uuid;
  a_token text;
  b_token text;
  replacement_token text;
  a_function uuid;
  b_function uuid;
  a_item uuid;
  b_item uuid;
  a_vendor uuid;
begin
  insert into weddings (partner_a, partner_b) values ('Person A','Person B') returning id into a;
  insert into weddings (partner_a, partner_b) values ('Person C','Person D') returning id into b;
  insert into members (wedding_id, tg_user_id, display_name, role, is_couple) values (a, 6610, 'A', 'couple', true) returning id into a_couple;
  insert into members (wedding_id, tg_user_id, display_name, role, is_couple) values (b, 6620, 'B', 'couple', true) returning id into b_couple;
  insert into members (wedding_id, tg_user_id, display_name, role) values (a, 6630, 'Parent', 'parent') returning id into relative_parent;

  assert advance_wedding_stage(a, b_couple, 'brief') = 'couple_only';
  assert advance_wedding_stage(a, relative_parent, 'brief') = 'couple_only';
  assert advance_wedding_stage(a, a_couple, 'booking') = 'stage_changed';
  assert advance_wedding_stage(a, a_couple, 'brief') = 'ok';
  assert advance_wedding_stage(a, a_couple, 'brief') = 'stage_changed';
  assert (select stage = 'sourcing' from weddings where id = a);

  insert into guests (wedding_id, name, party_size) values (a, 'Guest A', 3) returning id, rsvp_token into a_guest, a_token;
  insert into guests (wedding_id, name) values (b, 'Guest B') returning rsvp_token into b_token;
  insert into functions (wedding_id, kind, title) values (a, 'sangeet', 'A function') returning id into a_function;
  insert into functions (wedding_id, kind, title) values (b, 'ceremony', 'B function') returning id into b_function;
  insert into registry_items (wedding_id, title) values (a, 'Gift A') returning id into a_item;
  insert into registry_items (wedding_id, title) values (b, 'Gift B') returning id into b_item;
  assert record_guest_rsvp(a_token, b_function, true, 2, 1) = 'no_function';
  assert record_guest_rsvp(a_token, a_function, true, 20, 20) = 'ok';
  assert record_guest_rsvp(a_token, a_function, true, 20, 20) = 'ok';
  assert (select count(*) = 1 from events where wedding_id = a and kind = 'rsvp');
  assert (select people = 3 and veg = 3 from rsvps where guest_id = a_guest and function_id = a_function);
  assert reserve_guest_registry_item(a_token, b_item) = 'already_reserved';
  assert reserve_guest_registry_item(a_token, a_item) = 'ok';
  assert reserve_guest_registry_item(a_token, a_item) = 'ok';
  assert reserve_guest_registry_item(b_token, a_item) = 'already_reserved';

  update guests set rsvp_expires_at = now() - interval '1 second' where id = a_guest;
  assert record_guest_rsvp(a_token, a_function, false, 0, 0) = 'invalid_link';
  assert reserve_guest_registry_item(a_token, a_item) = 'invalid_link';
  update guests set rsvp_token = default, rsvp_expires_at = default where id = a_guest returning rsvp_token into replacement_token;
  assert replacement_token <> a_token;
  assert record_guest_rsvp(a_token, a_function, false, 0, 0) = 'invalid_link';
  assert record_guest_rsvp(replacement_token, a_function, false, 0, 0) = 'ok';

  insert into vendors (wedding_id, name, category) values (a, 'Caterer', 'caterer') returning id into a_vendor;
  assert cancel_lifecycle_vendor(a, a_vendor, b_couple, '') = 'forbidden';
  assert cancel_lifecycle_vendor(a, a_vendor, relative_parent, '') = 'forbidden';
  assert cancel_lifecycle_vendor(a, a_vendor, a_couple, 'Unavailable') = 'ok';
  assert cancel_lifecycle_vendor(a, a_vendor, a_couple, 'Unavailable') = 'unchanged';
  assert (select status = 'cancelled' and view_expires_at <= now() from vendors where id = a_vendor);
  assert (select count(*) = 2 from tasks where vendor_id = a_vendor);
end;
$$;

rollback;
