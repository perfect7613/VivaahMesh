-- WhatsApp uses the existing household channel and private notes model.
alter table public.channels add column whatsapp_language text
  check (whatsapp_language in ('en','hi','mr'));
create unique index whatsapp_household_channel on public.channels (household_id)
  where kind = 'whatsapp_group';

alter table public.priorities add column whatsapp_channel_id uuid references public.channels(id) on delete set null;
alter table public.priorities add column whatsapp_message_id text;
create unique index whatsapp_note_message on public.priorities (whatsapp_channel_id, whatsapp_message_id)
  where whatsapp_channel_id is not null;

create table public.whatsapp_voice_attempts (
  channel_id uuid not null references public.channels(id) on delete cascade,
  message_id text not null,
  claimed_at timestamptz not null default now(),
  primary key (channel_id, message_id)
);
create table public.whatsapp_updates (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  kind text not null check (kind in ('joined','plan')),
  created_at timestamptz not null default now()
);
create index whatsapp_updates_channel on public.whatsapp_updates (channel_id, id);

alter table public.whatsapp_voice_attempts enable row level security;
alter table public.whatsapp_updates enable row level security;
revoke all on public.whatsapp_voice_attempts, public.whatsapp_updates from public, anon, authenticated;
grant select, insert, delete on public.whatsapp_voice_attempts, public.whatsapp_updates to service_role;

-- Queue generic notices alongside the committed changes. No plan data or member names leave the app.
create function public.queue_whatsapp_update() returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if tg_table_name = 'members' then
    insert into public.whatsapp_updates (channel_id, kind)
    select id, 'joined' from public.channels
    where kind = 'whatsapp_group' and wedding_id = new.wedding_id and household_id = new.household_id;
  else
    insert into public.whatsapp_updates (channel_id, kind)
    select id, 'plan' from public.channels where kind = 'whatsapp_group' and wedding_id = new.wedding_id;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_whatsapp_update() from public, anon, authenticated;

create trigger whatsapp_member_joined after insert on public.members
for each row execute function public.queue_whatsapp_update();
create trigger whatsapp_plan_changed after insert on public.plan_revisions
for each row execute function public.queue_whatsapp_update();

create function public.link_whatsapp_household(p_chat text, p_household uuid, p_code text, p_language text)
returns boolean language plpgsql set search_path = pg_catalog, public as $$
begin
  insert into public.channels (wedding_id, household_id, kind, chat_id, whatsapp_language)
  select wedding_id, id, 'whatsapp_group', p_chat, p_language from public.households
  where id = p_household and invite_code = p_code
    and p_chat ~ '^[0-9]{5,24}(-[0-9]{5,24})?@g[.]us$'
    and p_language in ('en','hi','mr')
  on conflict do nothing;
  return exists (
    select 1 from public.channels c join public.households h
      on h.id = c.household_id and h.wedding_id = c.wedding_id
    where c.chat_id = p_chat and c.kind = 'whatsapp_group'
      and h.id = p_household and h.invite_code = p_code
  );
end;
$$;

create function public.claim_whatsapp_voice(p_channel uuid, p_message text)
returns boolean language plpgsql set search_path = pg_catalog, public as $$
declare
  family uuid;
begin
  select h.id into family from public.channels c join public.households h
    on h.id = c.household_id and h.wedding_id = c.wedding_id
    where c.id = p_channel and c.kind = 'whatsapp_group';
  if family is null then return false; end if;
  insert into public.whatsapp_voice_attempts (channel_id, message_id)
  values (p_channel, p_message) on conflict do nothing;
  if not found then return false; end if;
  return public.take_voice_request(family::text, 'whatsapp_stt', 10, 3600);
end;
$$;

revoke all on function public.link_whatsapp_household(text, uuid, text, text),
  public.claim_whatsapp_voice(uuid, text) from public, anon, authenticated;
grant execute on function public.link_whatsapp_household(text, uuid, text, text),
  public.claim_whatsapp_voice(uuid, text) to service_role;
