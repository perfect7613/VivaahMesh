-- Retain the last delivery attempt so a webhook outage or stopped worker can be retried
-- by an independent observer. The provider result and its first receipt time are immutable.
alter table public.calls add column incident_attempted_at timestamptz;
create index calls_pending_incident on public.calls (incident_attempted_at nulls first, result_received_at)
  where result is not null and processed_at is null;

create function public.claim_call_result_incidents(p_call_id uuid default null)
returns table (call_id uuid, finding_id text, received_at timestamptz)
language sql set search_path = ''
as $$
  with candidates as (
    select c.id from public.calls c
    where c.processed_at is null and c.result is not null and c.provider_attempt_id is not null
      and ((p_call_id is not null and c.id = p_call_id)
        or (p_call_id is null and c.result_received_at <= now() - interval '90 seconds'
          and (c.incident_attempted_at is null or c.incident_attempted_at <= now() - interval '5 minutes')))
    order by c.incident_attempted_at nulls first, c.result_received_at, c.id
    limit 25 for update skip locked
  )
  update public.calls c set incident_attempted_at = now() from candidates q where c.id = q.id
  returning c.id, coalesce(nullif(c.result->>'interaction_id', ''), case
    when c.flags->>'channel' = 'browser' then regexp_replace(c.provider_attempt_id, '^browser:', '')
    else c.provider_attempt_id end), c.result_received_at;
$$;

revoke all on function public.claim_call_result_incidents(uuid) from public, anon, authenticated;
grant execute on function public.claim_call_result_incidents(uuid) to service_role;

-- Lease one row per worker tick. A crashed worker's lease expires, and a malformed
-- provider response cannot monopolise the queue. apply_call_evidence owns the atomic commit.
alter table public.calls add column process_attempted_at timestamptz;
create index calls_pending_lease on public.calls (process_attempted_at nulls first, result_received_at)
  where result is not null and processed_at is null;
create function public.claim_next_call_result()
returns uuid language sql set search_path = ''
as $$
  with candidate as (
    select c.id from public.calls c
    where c.result is not null and c.processed_at is null
      and (c.process_attempted_at is null or c.process_attempted_at < now() - interval '2 minutes')
    order by c.process_attempted_at nulls first, c.result_received_at, c.id
    limit 1 for update skip locked
  )
  update public.calls c set process_attempted_at = now()
  from candidate q where q.id = c.id returning c.id;
$$;
revoke all on function public.claim_next_call_result() from public, anon, authenticated;
grant execute on function public.claim_next_call_result() to service_role;
