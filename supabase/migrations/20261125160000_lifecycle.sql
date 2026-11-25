-- Lifecycle after the plan: owned tasks (#11), vendors with authorization / acceptance / payment kept
-- separate and a vendor-scoped run sheet (#11, #13), spend closeout (#14), guests, function RSVPs
-- and an atomic registry (#12).

-- #11 Owned tasks. Deliverables (wedding film, album) stay open after the ceremony until delivered.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  title text not null,
  kind text not null default 'task' check (kind in ('task','deliverable','incident','replacement')),
  stage text not null default 'brief' check (stage in ('brief','sourcing','booking','guests','day_of','closeout')),
  owner_member_id uuid references members(id) on delete set null,
  owner_label text,
  due_date date,
  status text not null default 'open' check (status in ('open','done','blocked')),
  evidence text,
  escalated boolean not null default false,
  vendor_id uuid,
  seeded boolean not null default false,
  signed_off_by uuid references members(id) on delete set null,
  signed_off_at timestamptz,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index on tasks (wedding_id, status);

-- #11/#13/#14 Vendors. The family's own vendors sit next to sourced ones.
-- Authorization (a family decision), vendor acceptance and payment are three separate facts.
create table vendors (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  name text not null,
  category text not null check (category in ('venue','caterer','decor','photo_video','makeup','dj_music','mehendi','pandit','other')),
  origin text not null default 'sourced' check (origin in ('family','sourced')),
  functions text[] not null default '{}',
  quote_inr bigint check (quote_inr is null or quote_inr >= 0),
  status text not null default 'shortlisted' check (status in ('shortlisted','authorized','accepted','cancelled')),
  planned_inr bigint,
  committed_inr bigint,
  invoice_inr bigint,
  paid_inr bigint not null default 0,
  authorized_by uuid references members(id) on delete set null,
  authorized_at timestamptz,
  accepted_at timestamptz,
  paid_at timestamptz,
  run_sheet text,
  view_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  seeded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table tasks add constraint tasks_vendor_fk foreign key (vendor_id) references vendors(id) on delete set null;

-- #12 Guests (invited by a household) and per-function RSVPs.
create table guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  household_id uuid references households(id) on delete set null,
  name text not null,
  party_size int not null default 1 check (party_size between 1 and 20),
  rsvp_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now()
);
create table rsvps (
  guest_id uuid not null references guests(id) on delete cascade,
  function_id uuid not null references functions(id) on delete cascade,
  attending boolean not null,
  people int not null default 1 check (people between 0 and 20),
  veg int not null default 0 check (veg >= 0),
  updated_at timestamptz not null default now(),
  primary key (guest_id, function_id)
);

-- #12 Registry. Reservation is a conditional update: the second guest gets nothing.
create table registry_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  title text not null,
  price_inr bigint,
  reserved_by uuid references guests(id) on delete set null,
  reserved_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function reserve_registry_item(p_item uuid, p_guest uuid)
returns boolean language sql security definer set search_path = public as $$
  with g as (select wedding_id from guests where id = p_guest),
  upd as (
    update registry_items r set reserved_by = p_guest, reserved_at = now()
    from g where r.id = p_item and r.wedding_id = g.wedding_id and r.reserved_by is null
    returning r.id
  )
  select exists (select 1 from upd);
$$;
revoke all on function reserve_registry_item(uuid, uuid) from public, anon, authenticated;

alter table tasks enable row level security;
alter table vendors enable row level security;
alter table guests enable row level security;
alter table rsvps enable row level security;
alter table registry_items enable row level security;
