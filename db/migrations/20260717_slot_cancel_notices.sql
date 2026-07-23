-- 取消時段 → 排隊 WhatsApp 通知已報名學員（bot 掃描 class_cancel_notices 發送）。
-- （已套用到 ikzoxrvnpsseyjviawti）
create table if not exists public.class_cancel_notices (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid references public.slot_bookings(id) on delete set null,
  student_id    uuid,
  name          text,   -- 快照：取消當刻嘅姓名/電話/堂資料，之後改都準
  phone         text,
  session_date  date,
  start_time    time,
  venue         text,
  sent_at       timestamptz,          -- null = 未發；bot claim 時 set
  wa_message_id text,
  created_at    timestamptz not null default now()
);
create index if not exists ccn_pending_idx on public.class_cancel_notices(sent_at) where sent_at is null;

alter table public.class_cancel_notices enable row level security;
-- 冇 policy = 只有 service_role(bot) 掂到（同 whatsapp_reminders 一樣）。

create or replace function public.cancel_slot(p_slot_id uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_slot public.class_slots%rowtype; v_notified int;
begin
  if not public.is_staff() then raise exception '只有教練/管理員先可以取消時段'; end if;
  select * into v_slot from public.class_slots where id=p_slot_id for update;
  if not found then raise exception '搵唔到呢個時段'; end if;
  if v_slot.status = 'cancelled' then return json_build_object('ok',true,'already',true,'notified',0); end if;

  insert into public.class_cancel_notices(booking_id, student_id, name, phone, session_date, start_time, venue)
    select b.id, b.student_id, p.name, p.phone, cs.session_date, cs.start_time, cs.venue
    from public.slot_bookings b
    join public.class_slots cs on cs.id = b.slot_id
    join public.profiles p on p.id = b.student_id
    where b.slot_id = p_slot_id and b.status = 'booked';
  get diagnostics v_notified = row_count;

  update public.class_slots set status='cancelled' where id=p_slot_id;
  return json_build_object('ok',true,'notified',v_notified);
end;
$$;
revoke all on function public.cancel_slot(uuid) from public, anon;
grant execute on function public.cancel_slot(uuid) to authenticated, service_role;
