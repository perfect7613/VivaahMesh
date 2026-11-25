-- Issue #12: function-specific guest RSVPs and a voluntary gift registry with private reservations.
-- Gated in the API by the wedding's stage (>= guests) AND the Flagsmith flag `stage_guests`.
-- Guests are not family members: each gets an unguessable access code (a link), no login.

create table guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  -- The family that invited this guest.
  household_id uuid not null references households(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  language text not null default 'en',
  access_code text not null unique default encode(gen_random_bytes(8), 'hex'),
  added_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per guest per function: updating an RSVP changes that function's counts only.
create table guest_rsvps (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  guest_id uuid not null references guests(id) on delete cascade,
  function_id uuid not null references functions(id) on delete cascade,
  attendance text not null check (attendance in ('yes','no','maybe')),
  -- Plates and hampers count only for a 'yes' (enforced here as well as in the API).
  plates int not null default 0 check (plates between 0 and 20),
  hampers int not null default 0 check (hampers between 0 and 20),
  meal text check (meal in ('veg','jain','non_veg')),
  needs_accessibility boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (guest_id, function_id),
  check (attendance = 'yes' or (plates = 0 and hampers = 0 and meal is null and not needs_accessibility)),
  check (attendance <> 'yes' or plates >= 1)
);

create table registry_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  -- How many of this item the family would like.
  quantity int not null default 1 check (quantity between 1 and 100),
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table registry_reservations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references registry_items(id) on delete cascade,
  guest_id uuid not null references guests(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A guest reserves a given item once.
  unique (item_id, guest_id)
);

create index on guests (wedding_id);
create index on guest_rsvps (wedding_id, function_id);
create index on registry_items (wedding_id);
create index on registry_reservations (item_id);

alter table guests enable row level security;
alter table guest_rsvps enable row level security;
alter table registry_items enable row level security;
alter table registry_reservations enable row level security;

-- Reserves one unit of an item for a guest. The item row is locked first, so two guests asking for
-- the last unit at the same moment are served one after the other: one gets 'ok', the other
-- 'sold_out'. Status: ok | already | sold_out | not_found.
create or replace function reserve_registry_item(p_item uuid, p_guest uuid)
returns jsonb
language plpgsql
as $$
declare
  it registry_items%rowtype;
  g guests%rowtype;
  taken int;
begin
  select * into it from registry_items where id = p_item for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- The guest must belong to the same wedding as the item.
  select * into g from guests where id = p_guest and wedding_id = it.wedding_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if exists (select 1 from registry_reservations where item_id = p_item and guest_id = p_guest) then
    return jsonb_build_object('status', 'already');
  end if;
  select count(*) into taken from registry_reservations where item_id = p_item;
  if taken >= it.quantity then
    return jsonb_build_object('status', 'sold_out');
  end if;
  insert into registry_reservations (item_id, guest_id) values (p_item, p_guest);
  return jsonb_build_object('status', 'ok', 'remaining', it.quantity - taken - 1);
end;
$$;

-- Only the server (service role) may call it.
revoke execute on function reserve_registry_item(uuid, uuid) from public, anon, authenticated;
