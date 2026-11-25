alter table public.tasks
  add column escalation_path text not null default 'Ask the couple',
  add column invoice_discrepancy boolean not null default false;

-- Remove financial amounts from the shared task title and keep one working task per vendor.
with previous as (
  select t.id, v.name, row_number() over (partition by t.vendor_id order by
    (t.status <> 'done') desc, t.created_at desc, t.id) as position
  from public.tasks t join public.vendors v on v.id = t.vendor_id
  where t.kind = 'incident' and t.stage = 'closeout' and t.title like 'Invoice from % off the approved %'
)
update public.tasks t
set title = 'Invoice from ' || previous.name || ' differs from the approved amount',
    invoice_discrepancy = previous.position = 1
from previous where previous.id = t.id;

create unique index tasks_vendor_invoice_discrepancy on public.tasks (vendor_id)
  where invoice_discrepancy;

create function public.record_lifecycle_vendor_money(
  p_wedding uuid, p_vendor uuid, p_member uuid, p_invoice bigint, p_paid bigint
)
returns text language plpgsql set search_path = public as $$
declare
  v vendors%rowtype;
begin
  perform 1 from members where id = p_member and wedding_id = p_wedding and is_couple;
  if not found then return 'forbidden'; end if;
  if (p_invoice is null and p_paid is null) or p_invoice < 0 or p_paid < 0 then
    return 'invalid_amount';
  end if;

  update vendors set invoice_inr = coalesce(p_invoice, invoice_inr),
    paid_inr = coalesce(p_paid, paid_inr),
    paid_at = case when p_paid is null then paid_at else now() end
  where id = p_vendor and wedding_id = p_wedding and status in ('authorized', 'accepted')
  returning * into v;
  if not found then return 'unavailable'; end if;

  if p_invoice is null then return 'ok'; end if;
  if v.committed_inr is not null and p_invoice <> v.committed_inr then
    insert into tasks (
      wedding_id, title, kind, owner_member_id, vendor_id, escalated, stage, seeded, invoice_discrepancy
    )
    values (p_wedding, 'Invoice from ' || v.name || ' differs from the approved amount',
      'incident', coalesce(v.authorized_by, p_member), v.id, true, 'closeout', v.seeded, true)
    on conflict (vendor_id) where invoice_discrepancy do update
    set status = 'open', done_at = null, escalated = true, signed_off_at = null, signed_off_by = null
    where tasks.status = 'done';
  else
    update tasks set status = 'done', done_at = now(), escalated = false
    where wedding_id = p_wedding and vendor_id = v.id and invoice_discrepancy and status <> 'done';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.record_lifecycle_vendor_money(uuid, uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.record_lifecycle_vendor_money(uuid, uuid, uuid, bigint, bigint)
  to service_role;
