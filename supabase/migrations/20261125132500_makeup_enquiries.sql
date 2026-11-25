-- A conditional schedule option is tied to the deadline shown to the vendor.
create table makeup_enquiries (
  id uuid primary key,
  wedding_id uuid not null references weddings(id) on delete cascade,
  function_kind text not null,
  proposal_id text not null,
  artist_name text not null,
  due_minute int not null check (due_minute between 0 and 1440),
  requested_by uuid references members(id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '1 day'),
  status text not null default 'open' check (status in ('open', 'confirmed', 'withdrawn')),
  reply_source text check (reply_source in ('typed', 'voice')),
  reply_wording text,
  check (
    (status = 'open' and reply_source is null and reply_wording is null)
    or (status <> 'open' and reply_source is not null and reply_wording is not null)
  ),
  unique (wedding_id, function_kind, proposal_id, due_minute)
);

alter table makeup_enquiries enable row level security;

alter table facts drop constraint facts_channel_check;
alter table facts add constraint facts_channel_check
  check (channel in ('samvaad_call', 'browser_agent', 'quote', 'typed', 'seed', 'dictate'));

create or replace function apply_makeup_reply(
  p_token_hash text, p_confirms boolean, p_wording text, p_source text
) returns text
language plpgsql
set search_path = public
as $$
declare
  enquiry makeup_enquiries%rowtype;
  reply_status text;
  previous_facts uuid[];
begin
  select * into enquiry from makeup_enquiries
    where token_hash = p_token_hash and expires_at > now() and status = 'open'
    for update;
  if not found then return null; end if;
  if p_confirms is null or p_source is null or p_source not in ('typed', 'voice')
    or p_wording is null or char_length(trim(p_wording)) not between 1 and 1000 then
    raise exception 'invalid makeup reply';
  end if;

  reply_status := case when p_confirms then 'confirmed' else 'withdrawn' end;
  update makeup_enquiries
    set status = reply_status, reply_wording = p_wording, reply_source = p_source
    where id = enquiry.id;

  if p_confirms then
    perform pg_advisory_xact_lock(hashtextextended(enquiry.wedding_id::text || ':makeup:' || enquiry.function_kind, 0));
    select coalesce(array_agg(f.id), '{}') into previous_facts
      from facts f
      where f.wedding_id = enquiry.wedding_id and f.kind = 'makeup_ready' and f.function_kind = enquiry.function_kind
        and not exists (
          select 1 from facts replacement
          where replacement.wedding_id = enquiry.wedding_id and f.id = any(replacement.supersedes)
        );
    insert into facts (wedding_id, kind, function_kind, value, status, channel, ref, wording, supersedes)
      values (enquiry.wedding_id, 'makeup_ready', enquiry.function_kind, enquiry.due_minute,
        'confirmed', case when p_source = 'voice' then 'dictate' else 'typed' end,
        enquiry.id::text, p_wording, previous_facts);
  end if;
  return reply_status;
end;
$$;

revoke execute on function apply_makeup_reply(text, boolean, text, text) from public, anon, authenticated;
grant execute on function apply_makeup_reply(text, boolean, text, text) to service_role;
