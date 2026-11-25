-- Issue #13 (first half): vendors, their bookings and the run sheet a vendor may see.
-- Gated in the API by the wedding's stage (>= day_of) AND the Flagsmith flag `stage_day_of`.
-- Vendors are not family members: each gets an unguessable access code (a link), no login.

create table vendors (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  category text not null check (category in
    ('venue','caterer','decorator','photographer','videographer','makeup','mehendi','musician','choreographer','other')),
  -- A vendor the family brought themselves (e.g. their existing caterer), as opposed to one the team sourced.
  is_family_own boolean not null default false,
  status text not null default 'active' check (status in ('active','cancelled')),
  -- 'seed' marks sample data so it is never mistaken for a real vendor conversation.
  source text not null default 'app' check (source in ('app','seed')),
  access_code text not null unique default encode(gen_random_bytes(8), 'hex'),
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One agreement with a vendor. A package covering several functions is still ONE row here, so its
-- price can only be counted once.
create table vendor_bookings (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  -- Confirmed total in rupees. NULL = "price pending": a cost is never invented.
  total_inr bigint check (total_inr is null or total_inr >= 0),
  status text not null default 'proposed' check (status in ('proposed','confirmed','cancelled')),
  source text not null default 'app' check (source in ('app','seed')),
  created_at timestamptz not null default now()
);

-- What one function needs from the vendor. The primary key makes a function appear once per booking.
-- A vendor sees an item only when it is approved (the family chose to share it).
create table booking_items (
  booking_id uuid not null references vendor_bookings(id) on delete cascade,
  function_id uuid not null references functions(id) on delete cascade,
  brief text not null default '' check (length(brief) <= 600),
  arrival_time time,
  approved boolean not null default false,
  approved_by uuid references members(id) on delete set null,
  approved_at timestamptz,
  primary key (booking_id, function_id)
);

-- The person on the ground whom every vendor may call.
create table wedding_contacts (
  wedding_id uuid primary key references weddings(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  phone text not null check (length(trim(phone)) between 3 and 30)
);

create index on vendors (wedding_id);
create index on vendor_bookings (wedding_id);
create index on vendor_bookings (vendor_id);

alter table vendors enable row level security;
alter table vendor_bookings enable row level security;
alter table booking_items enable row level security;
alter table wedding_contacts enable row level security;

-- Loads labelled sample vendors, in one transaction. Returns false (and changes nothing) when the
-- wedding already has sample vendors, so pressing the button twice is harmless.
create or replace function seed_demo_vendors(p_wedding uuid)
returns boolean
language plpgsql
as $$
declare
  fns uuid[];
  v_cater uuid;
  v_photo uuid;
  v_decor uuid;
  b_cater uuid;
  b_photo uuid;
  b_decor uuid;
  f uuid;
begin
  perform pg_advisory_xact_lock(hashtext('seed_demo_vendors:' || p_wedding::text));
  if exists (select 1 from vendors where wedding_id = p_wedding and source = 'seed') then
    return false;
  end if;
  select array_agg(id order by sort, created_at) into fns from functions where wedding_id = p_wedding;
  if fns is null then
    return false;
  end if;

  insert into vendors (wedding_id, name, category, is_family_own, source) values (p_wedding, 'Sharma Caterers', 'caterer', true, 'seed') returning id into v_cater;
  insert into vendors (wedding_id, name, category, is_family_own, source) values (p_wedding, 'Lens Studio', 'photographer', false, 'seed') returning id into v_photo;
  insert into vendors (wedding_id, name, category, is_family_own, source) values (p_wedding, 'Bloom Decor', 'decorator', false, 'seed') returning id into v_decor;

  -- The family's own caterer: confirmed, for the first function only.
  insert into vendor_bookings (wedding_id, vendor_id, title, total_inr, status, source)
    values (p_wedding, v_cater, 'Dinner for 350', 420000, 'confirmed', 'seed') returning id into b_cater;
  insert into booking_items (booking_id, function_id, brief, arrival_time, approved, approved_at)
    values (b_cater, fns[1], 'Vegetarian dinner for 350, service from 8:30 pm, live counters.', '16:30', true, now());

  -- One photographer package across EVERY function: a single booking, counted once in the budget.
  insert into vendor_bookings (wedding_id, vendor_id, title, total_inr, status, source)
    values (p_wedding, v_photo, 'Photo and video, all functions', 300000, 'confirmed', 'seed') returning id into b_photo;
  foreach f in array fns loop
    insert into booking_items (booking_id, function_id, brief, arrival_time, approved, approved_at)
      values (b_photo, f, 'Candid and family portraits; cinematic video; delivery within 30 days.', '17:00', true, now());
  end loop;

  -- A proposal not yet agreed: no price, nothing shared with the vendor.
  insert into vendor_bookings (wedding_id, vendor_id, title, total_inr, status, source)
    values (p_wedding, v_decor, 'Marigold decor', null, 'proposed', 'seed') returning id into b_decor;
  insert into booking_items (booking_id, function_id, brief, approved)
    values (b_decor, fns[1], 'Marigold arches and stage backdrop.', false);

  insert into wedding_contacts (wedding_id, name, phone) values (p_wedding, 'Kavita (on-ground lead)', '+91 90000 11111')
    on conflict (wedding_id) do nothing;
  return true;
end;
$$;

-- Only the server (service role) may call it.
revoke execute on function seed_demo_vendors(uuid) from public, anon, authenticated;
