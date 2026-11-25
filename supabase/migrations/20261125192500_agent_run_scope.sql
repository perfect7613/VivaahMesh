-- A scheduler invocation and a direct request can otherwise claim the same wedding concurrently.
begin;

lock table agent_runs in share row exclusive mode;

update agent_runs
set status = 'failed', error = 'agent_run_expired', finished_at = now()
where status = 'running';

create unique index agent_runs_one_running_per_wedding
  on agent_runs (wedding_id) where status = 'running';

create index agent_messages_wedding_chat_idx
  on agent_messages (wedding_id, chat_id, created_at desc);

commit;
