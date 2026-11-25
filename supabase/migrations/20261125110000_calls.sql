-- Issue #6/#10: authorized vendor calls through Sarvam Samvaad, and their stored results.
-- A result is persisted BEFORE it is processed, so a paused or crashed worker can replay it
-- later without a second call. provider_attempt_id makes duplicate webhooks harmless.

create table calls (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  function_kind text not null,
  fact_kind text not null,
  recipient_role text not null,
  recipient_name text not null,
  recipient_phone text not null,
  purpose text not null,
  language text not null default 'Hindi',
  authorized_by uuid references members(id) on delete set null,
  -- Flag values in effect when the call was created (caller_prompt variant, kill switches).
  flags jsonb not null default '{}',
  caller_prompt text not null default 'baseline',
  status text not null default 'authorized'
    check (status in ('authorized','blocked','dialing','completed','no_answer','failed')),
  provider_attempt_id text unique,
  error text,
  -- Raw webhook payload, kept verbatim as evidence.
  result jsonb,
  result_received_at timestamptz,
  processed_at timestamptz,
  fact_id uuid references facts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index on calls (wedding_id, created_at desc);
create index calls_unprocessed on calls (result_received_at) where result is not null and processed_at is null;
alter table calls enable row level security;
