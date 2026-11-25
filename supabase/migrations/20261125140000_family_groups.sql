-- The agent listens to each family's own group chat and remembers conversations.

-- A family group (Telegram today; the WhatsApp bridge, #18, writes to the same tables).
create table channels (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  kind text not null default 'telegram_group' check (kind in ('telegram_group','whatsapp_group')),
  chat_id text not null unique,
  title text,
  linked_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Raw group messages, read by the agent on its next heartbeat (or at once when it is mentioned).
create table group_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  wedding_id uuid not null references weddings(id) on delete cascade,
  from_name text not null,
  from_tg_id bigint,
  text text not null,
  kind text not null default 'text' check (kind in ('text','voice')),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_messages_pending on group_messages (wedding_id, created_at) where processed_at is null;

-- Conversation memory per chat (a person's DM with the bot, or a family group).
create table agent_messages (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  chat_id text not null,
  role text not null check (role in ('user','assistant')),
  author text,
  content text not null,
  created_at timestamptz not null default now()
);
create index on agent_messages (chat_id, created_at desc);

-- Notes the agent picks out of a group keep the name of whoever said it.
alter table priorities add column if not exists author_name text;

alter table agent_runs drop constraint if exists agent_runs_trigger_check;
alter table agent_runs add constraint agent_runs_trigger_check
  check (trigger in ('message','voice','call_result','heartbeat','manual','group','approval'));

alter table channels enable row level security;
alter table group_messages enable row level security;
alter table agent_messages enable row level security;
