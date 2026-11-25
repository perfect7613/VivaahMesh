-- Keep existing membership and authorization checks for email-based viewers.
-- This range is outside Telegram's 52-bit identifiers and inside JS safe integers.
create sequence public.standalone_viewer_ids
  as bigint minvalue 5000000000000000 maxvalue 9007199254740991
  start with 5000000000000000;

create table public.standalone_viewers (
  auth_user_id uuid primary key,
  viewer_id bigint not null unique default (-nextval('public.standalone_viewer_ids'))
);

alter table public.standalone_viewers enable row level security;
revoke all on table public.standalone_viewers from public, anon, authenticated;
revoke all on sequence public.standalone_viewer_ids from public, anon, authenticated;
grant select, insert on table public.standalone_viewers to service_role;
grant usage on sequence public.standalone_viewer_ids to service_role;

create function public.standalone_viewer_id(p_auth_user_id uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  select viewer_id into v_id from public.standalone_viewers where auth_user_id = p_auth_user_id;
  if found then return v_id; end if;

  insert into public.standalone_viewers (auth_user_id) values (p_auth_user_id)
    on conflict (auth_user_id) do nothing
    returning viewer_id into v_id;
  if found then return v_id; end if;

  select viewer_id into strict v_id from public.standalone_viewers where auth_user_id = p_auth_user_id;
  return v_id;
end;
$$;

revoke all on function public.standalone_viewer_id(uuid) from public, anon, authenticated;
grant execute on function public.standalone_viewer_id(uuid) to service_role;
