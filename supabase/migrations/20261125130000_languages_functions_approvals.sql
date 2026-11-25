-- Any language Sarvam supports (22 scheduled Indian languages + English).
alter table members drop constraint if exists members_language_check;
alter table members add constraint members_language_check check (language in (
  'en','hi','mr','bn','gu','ta','te','kn','ml','pa','od','as','ur','kok','mai','ne','sa','doi','brx','mni','sat','ks','sd'));

-- Mini App UI strings translated by GLM-5.3 (Sarvam Token Factory), cached per language.
create table if not exists ui_strings (
  lang text primary key,
  data jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);
alter table ui_strings enable row level security;

-- Functions the families name themselves (Roka, Tilak, Jaggo, Nikah…) and their details.
alter table functions drop constraint if exists functions_wedding_id_kind_key;
alter table functions add column if not exists on_date date;
alter table functions add column if not exists starts_at time;
alter table functions add column if not exists venue text;
alter table functions add column if not exists details text;
create unique index if not exists functions_wedding_title on functions (wedding_id, lower(title));

-- Issue #5: couple approval bound to the plan revision it was made on.
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  function_kind text not null,
  proposal_id text not null,
  proposal jsonb not null,
  snapshot_revision int not null,
  policy_version text not null,
  approved_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One approval per revision: a second tap, or a tap on an outdated screen, cannot add another.
  unique (wedding_id, function_kind, snapshot_revision)
);
alter table approvals enable row level security;
