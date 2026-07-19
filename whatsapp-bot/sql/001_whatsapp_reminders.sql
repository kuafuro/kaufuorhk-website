-- ==========================================================================
--  WhatsApp 提醒:記錄表 + 「到期提醒」查詢 function
--  喺 Supabase → SQL Editor 貼上呢段 run 一次即可。
-- ==========================================================================

-- 1) 記錄已發出嘅提醒,避免重複發
create table if not exists public.whatsapp_reminders (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.slot_bookings(id) on delete cascade,
  hours_before int  not null,
  wa_message_id text,
  sent_at      timestamptz not null default now(),
  unique (booking_id, hours_before)   -- 同一個 booking + 同一個提醒窗,只發一次
);

alter table public.whatsapp_reminders enable row level security;
-- 冇任何 policy = 只有 service_role(後端 bot)先掂到,學生/anon 掂唔到。

-- 2) 搵「上堂時間差唔多 = 而家 + p_hours_before」而又未提過嘅 booking
--    class_slots.session_date + start_time 當作香港時間,轉做絕對時間(UTC instant)比較。
create or replace function public.due_reminders(p_hours_before int, p_window_min int)
returns table (
  booking_id   uuid,
  student_id   uuid,
  name         text,
  phone        text,
  session_date date,
  start_time   time,
  venue        text,
  coach        text,
  starts_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id as booking_id,
    b.student_id,
    p.name,
    p.phone,
    cs.session_date,
    cs.start_time,
    cs.venue,
    cs.coach,
    ((cs.session_date + cs.start_time) at time zone 'Asia/Hong_Kong') as starts_at
  from slot_bookings b
  join class_slots cs on cs.id = b.slot_id
  join profiles    p  on p.id  = b.student_id
  where b.status = 'booked'                          -- 只提正取(唔提後補/取消)
    and coalesce(cs.status, 'open') in ('open', 'confirmed')
    and p.phone is not null and p.phone <> ''
    and ((cs.session_date + cs.start_time) at time zone 'Asia/Hong_Kong')
        between now() + make_interval(hours => p_hours_before) - make_interval(mins => p_window_min)
            and now() + make_interval(hours => p_hours_before) + make_interval(mins => p_window_min)
    and not exists (
      select 1 from whatsapp_reminders wr
      where wr.booking_id = b.id and wr.hours_before = p_hours_before
    );
$$;

-- 呢個 function 淨係俾後端(service_role)用,唔對外公開。
-- 注意:一定要 revoke 埋 public — Postgres 默認 grant EXECUTE 俾 PUBLIC,
-- 淨 revoke anon/authenticated 佢哋仍然經 PUBLIC 承繼到(會漏晒學生姓名電話)。
revoke all on function public.due_reminders(int, int) from public, anon, authenticated;
grant execute on function public.due_reminders(int, int) to service_role;
