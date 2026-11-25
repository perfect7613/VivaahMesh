-- VivaahMesh onboarding schema.
-- All reads and writes go through server routes using the service role after
-- Telegram initData verification. RLS is enabled with no anon policies, so the
-- public anon key can read nothing directly.

create extension if not exists pgcrypto;

create table weddings (
  id uuid primary key default gen_random_uuid(),
  partner_a text not null,
  partner_b text not null,
  wedding_date date,
  city text,
  guest_count int check (guest_count is null or guest_count between 1 and 5000),
  budget_inr bigint check (budget_inr is null or budget_inr >= 0),
  stage text not null default 'brief'
    check (stage in ('brief','sourcing','booking','guests','day_of','closeout')),
  couple_code text not null unique default encode(gen_random_bytes(5), 'hex'),
  created_by_tg bigint,
  created_at timestamptz not null default now()
);

create table households (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  side text not null check (side in ('A','B')),
  name text not null,
  invite_code text not null unique default encode(gen_random_bytes(5), 'hex'),
  created_at timestamptz not null default now(),
  unique (wedding_id, side)
);

create table members (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  household_id uuid references households(id) on delete set null,
  tg_user_id bigint,
  wa_jid text,
  display_name text not null,
  role text not null default 'family'
    check (role in ('couple','parent','grandparent','sibling','cousin','relative','friend','family')),
  is_couple boolean not null default false,
  language text not null default 'en' check (language in ('en','hi','mr')),
  joined_via text not null default 'telegram' check (joined_via in ('telegram','whatsapp','pwa','seed')),
  created_at timestamptz not null default now(),
  unique (wedding_id, tg_user_id)
);

create table functions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  kind text not null check (kind in ('haldi','mehendi','sangeet','ceremony','reception','engagement','other')),
  title text not null,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (wedding_id, kind)
);

-- A family's priorities. visibility='household' keeps a priority within that family.
create table priorities (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  function_kind text,
  kind text not null,
  note text,
  source text not null default 'app' check (source in ('app','telegram','whatsapp','voice','seed')),
  visibility text not null default 'shared' check (visibility in ('shared','household')),
  created_at timestamptz not null default now()
);

-- Lightweight activity feed used for "what changed" and bot notifications.
create table events (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references weddings(id) on delete cascade,
  actor_member_id uuid references members(id) on delete set null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index on households (wedding_id);
create index on members (tg_user_id);
create index on members (wedding_id);
create index on priorities (wedding_id);
create index on events (wedding_id, created_at desc);

alter table weddings enable row level security;
alter table households enable row level security;
alter table members enable row level security;
alter table functions enable row level security;
alter table priorities enable row level security;
alter table events enable row level security;
