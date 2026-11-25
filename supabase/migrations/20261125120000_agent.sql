-- The always-on VivaahMesh agent (GLM-5.3 via Sarvam Token Factory).
-- Every run is recorded: what woke it, what it saw, what it did, and the model and flags used.

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  trigger text not null check (trigger in ('message','voice','call_result','heartbeat','manual')),
  model text not null,
  status text not null default 'running' check (status in ('running','done','skipped','failed')),
  -- One line for the families' activity feed, in English, Hindi and Marathi.
  summary jsonb,
  actions jsonb not null default '[]',
  flags jsonb not null default '{}',
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index on agent_runs (wedding_id, started_at desc);
alter table agent_runs enable row level security;

-- Transcripts of voice notes (Sarvam Saaras), kept next to the note they came from.
alter table priorities add column if not exists transcript text;
alter table priorities add column if not exists transcript_lang text;
