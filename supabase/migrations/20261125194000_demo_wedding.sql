-- Keep the operator's rehearsal separate from their real weddings and from other operators.
alter table public.weddings add column is_seeded_demo boolean not null default false;
create unique index weddings_one_demo_per_owner on public.weddings (created_by_tg) where is_seeded_demo;

create function public.seed_rehearsal_wedding(p_owner bigint, p_activities jsonb, p_facts jsonb)
returns uuid language plpgsql set search_path = public as $$
declare
  wedding uuid;
  side_a uuid;
  side_b uuid;
  aai uuid;
  riya uuid;
begin
  if p_owner is null or p_owner <= 0 then raise exception 'A Telegram owner is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rehearsal-owner:' || p_owner, 0));
  select id into wedding from weddings where is_seeded_demo and created_by_tg = p_owner;
  if found then return wedding; end if;

  wedding := create_wedding(p_owner, 'Meera', 'Aarav', null, 'Pune', 350, 1500000,
    'Patil family (rehearsal)', 'Deshmukh family (rehearsal)', 'Meera', 'en',
    '[{"kind":"sangeet","title":"Sangeet"},{"kind":"ceremony","title":"Ceremony"},{"kind":"reception","title":"Reception"}]');
  update weddings set is_seeded_demo = true where id = wedding;
  select id into strict side_a from households where wedding_id = wedding and side = 'A';
  select id into strict side_b from households where wedding_id = wedding and side = 'B';

  -- Fictional contributors have no Telegram or WhatsApp address.
  insert into members (wedding_id, household_id, display_name, role, language, joined_via)
    values (wedding, side_a, 'Aai', 'parent', 'mr', 'seed') returning id into aai;
  insert into members (wedding_id, household_id, display_name, role, language, joined_via)
    values (wedding, side_b, 'Riya', 'cousin', 'en', 'seed') returning id into riya;
  insert into family_plan_requirements (wedding_id, function_kind, kind, household_id, member_id, value_min, note, source)
    values (wedding, 'sangeet', 'dinner_start', side_a, aai, 1230, 'आजीसाठी जेवण ८:३० ला सुरू व्हायला हवं', 'seed'),
           (wedding, 'sangeet', 'dance_duration', side_b, riya, 20, 'Please film our twenty-minute cousins’ dance.', 'seed');
  insert into vendors (wedding_id, name, category, functions, seeded)
    values (wedding, 'Marigold Hall', 'venue', array['sangeet','ceremony','reception'], true),
           (wedding, 'Lotus Studio', 'makeup', array['sangeet'], true),
           (wedding, 'Jasmine Films', 'photo_video', array['sangeet'], true);
  perform seed_demo_plan(wedding, p_activities, p_facts);
  return wedding;
end;
$$;
revoke all on function public.seed_rehearsal_wedding(bigint,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.seed_rehearsal_wedding(bigint,jsonb,jsonb) to service_role;
