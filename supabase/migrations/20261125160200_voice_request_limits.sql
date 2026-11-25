-- Limits are shared by all web instances and consume one slot before paid upstream work.
create table voice_request_limits (
  scope text not null,
  operation text not null,
  window_ends_at timestamptz not null,
  request_count integer not null,
  primary key (scope, operation)
);

alter table voice_request_limits enable row level security;
revoke all on table voice_request_limits from public, anon, authenticated;

create or replace function take_voice_request(
  p_scope text, p_operation text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  requested_at timestamptz := clock_timestamp();
  accepted boolean;
begin
  insert into voice_request_limits as limits (scope, operation, window_ends_at, request_count)
    values (p_scope, p_operation, requested_at + make_interval(secs => p_window_seconds), 1)
  on conflict (scope, operation) do update
    set window_ends_at = case when limits.window_ends_at <= requested_at
          then excluded.window_ends_at else limits.window_ends_at end,
        request_count = case when limits.window_ends_at <= requested_at
          then 1 else limits.request_count + 1 end
    where limits.window_ends_at <= requested_at or limits.request_count < p_limit
  returning true into accepted;
  return coalesce(accepted, false);
end;
$$;

revoke execute on function take_voice_request(text, text, integer, integer) from public, anon, authenticated;
grant execute on function take_voice_request(text, text, integer, integer) to service_role;
grant select, insert, update on table voice_request_limits to service_role;

alter table calls add column browser_reference text unique;

-- Sarvam echoes the authenticated webhook URL and telephony contact fields.
update calls
set result = result - 'webhook_config' - 'channel_info'
where result ? 'webhook_config' or result ? 'channel_info';
