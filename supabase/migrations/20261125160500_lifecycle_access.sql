revoke all on table public.tasks, public.vendors, public.guests, public.rsvps, public.registry_items
  from public, anon, authenticated;
grant select, insert, update, delete on table public.tasks, public.vendors, public.guests, public.rsvps, public.registry_items
  to service_role;

alter table public.guests add column invited_by uuid references public.members(id) on delete set null,
  add column rsvp_expires_at timestamptz not null default (now() + interval '1 year');
alter table public.vendors add column view_expires_at timestamptz not null default (now() + interval '1 year');
alter function public.reserve_registry_item(uuid, uuid) security invoker;

-- The same guest can safely retry a reservation.
create or replace function public.reserve_registry_item(p_item uuid, p_guest uuid)
returns boolean language sql set search_path = public as $$
  with g as (select wedding_id from guests where id = p_guest),
  upd as (
    update registry_items r set reserved_by = p_guest, reserved_at = coalesce(r.reserved_at, now())
    from g where r.id = p_item and r.wedding_id = g.wedding_id and (r.reserved_by is null or r.reserved_by = p_guest)
    returning r.id
  )
  select exists (select 1 from upd);
$$;
revoke all on function public.reserve_registry_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_registry_item(uuid, uuid) to service_role;

-- Revalidate the bearer and both wedding IDs where the response is written.
create function public.record_guest_rsvp(p_token text, p_function uuid, p_attending boolean, p_people int, p_veg int)
returns text language plpgsql set search_path = public as $$
declare
  g guests%rowtype;
  party integer;
begin
  select * into g from guests where rsvp_token = p_token and rsvp_expires_at > now() for share;
  if not found then return 'invalid_link'; end if;
  perform 1 from functions where id = p_function and wedding_id = g.wedding_id;
  if not found then return 'no_function'; end if;

  party := case when p_attending then least(g.party_size, greatest(1, p_people)) else 0 end;
  insert into rsvps (guest_id, function_id, attending, people, veg)
  values (g.id, p_function, p_attending, party, least(party, greatest(0, p_veg)))
  on conflict (guest_id, function_id) do update set attending = excluded.attending, people = excluded.people,
    veg = excluded.veg, updated_at = now()
  where (rsvps.attending, rsvps.people, rsvps.veg) is distinct from (excluded.attending, excluded.people, excluded.veg);
  if found then
    insert into events (wedding_id, kind, payload)
    values (g.wedding_id, 'rsvp', jsonb_build_object('function_id', p_function, 'attending', p_attending));
  end if;
  return 'ok';
end;
$$;
revoke all on function public.record_guest_rsvp(text, uuid, boolean, int, int) from public, anon, authenticated;
grant execute on function public.record_guest_rsvp(text, uuid, boolean, int, int) to service_role;

-- Cancellation and its two recovery tasks are one transaction. A retry cannot duplicate work.
create function public.cancel_lifecycle_vendor(p_wedding uuid, p_vendor uuid, p_member uuid, p_reason text)
returns text language plpgsql set search_path = public as $$
declare
  v vendors%rowtype;
begin
  perform 1 from members where id = p_member and wedding_id = p_wedding and (is_couple or is_parent_delegate);
  if not found then return 'forbidden'; end if;
  update vendors set status = 'cancelled', view_expires_at = now()
  where id = p_vendor and wedding_id = p_wedding and status <> 'cancelled'
  returning * into v;
  if not found then return 'unchanged'; end if;

  insert into tasks (wedding_id, title, kind, owner_member_id, vendor_id, due_date, escalated, seeded)
  values
    (p_wedding, v.name || ' cancelled' || case when p_reason <> '' then ': ' || p_reason else '' end,
     'incident', p_member, v.id, null, true, v.seeded),
    (p_wedding, 'Find a replacement ' || replace(v.category, '_', ' ') || ' for ' ||
     coalesce(nullif(array_to_string(v.functions, ', '), ''), 'the wedding'),
     'replacement', p_member, v.id, current_date + 2, false, v.seeded);
  insert into events (wedding_id, actor_member_id, kind, payload)
  values (p_wedding, p_member, 'vendor_cancelled', jsonb_build_object('vendor', v.name, 'category', v.category));
  return 'ok';
end;
$$;
revoke all on function public.cancel_lifecycle_vendor(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_lifecycle_vendor(uuid, uuid, uuid, text) to service_role;

create function public.reserve_guest_registry_item(p_token text, p_item uuid)
returns text language plpgsql set search_path = public as $$
declare
  guest uuid;
begin
  select id into guest from guests where rsvp_token = p_token and rsvp_expires_at > now() for share;
  if not found then return 'invalid_link'; end if;
  if not reserve_registry_item(p_item, guest) then return 'already_reserved'; end if;
  return 'ok';
end;
$$;
revoke all on function public.reserve_guest_registry_item(text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_guest_registry_item(text, uuid) to service_role;

-- An accepted request advances exactly the stage the couple saw.
create function public.advance_wedding_stage(p_wedding uuid, p_member uuid, p_expected text)
returns text language plpgsql set search_path = public as $$
declare
  next_stage text;
begin
  perform 1 from members where id = p_member and wedding_id = p_wedding and is_couple;
  if not found then return 'couple_only'; end if;
  next_stage := case p_expected
    when 'brief' then 'sourcing'
    when 'sourcing' then 'booking'
    when 'booking' then 'guests'
    when 'guests' then 'day_of'
    when 'day_of' then 'closeout'
  end;
  if next_stage is null then return 'already_last_stage'; end if;
  update weddings set stage = next_stage where id = p_wedding and stage = p_expected;
  if not found then return 'stage_changed'; end if;
  insert into events (wedding_id, actor_member_id, kind, payload)
  values (p_wedding, p_member, 'stage_advanced', jsonb_build_object('from', p_expected, 'to', next_stage));
  return 'ok';
end;
$$;
revoke all on function public.advance_wedding_stage(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.advance_wedding_stage(uuid, uuid, text) to service_role;
