-- 排堂引擎：時段 + 報名（已套用到 Supabase project ikzoxrvnpsseyjviawti）
-- 供應主導模式：教練開放時段 → 學生報名 → 夠人（min_to_open，預設 2）自動開班。
-- 報名 = 排位；實際扣堂／出席仍由教練點名（分成計數機）決定。

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('coach','admin'));
$$;
grant execute on function public.is_staff() to authenticated, anon;

create table if not exists public.class_slots(
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  start_time time not null,
  end_time time,
  venue text not null check (venue in ('KT','MK')),
  coach text not null check (coach in ('ming','tom')),
  capacity int not null default 6 check (capacity > 0),
  min_to_open int not null default 2 check (min_to_open >= 1),
  book_by timestamptz,
  status text not null default 'open' check (status in ('open','confirmed','cancelled','closed')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists class_slots_date_idx on public.class_slots(session_date);

create table if not exists public.slot_bookings(
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.class_slots(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked','waitlist','cancelled')),
  created_at timestamptz not null default now()
);
create unique index if not exists slot_bookings_active_uniq
  on public.slot_bookings(slot_id, student_id) where status <> 'cancelled';
create index if not exists slot_bookings_slot_idx on public.slot_bookings(slot_id);
create index if not exists slot_bookings_student_idx on public.slot_bookings(student_id);

alter table public.class_slots enable row level security;
alter table public.slot_bookings enable row level security;

drop policy if exists slots_read on public.class_slots;
create policy slots_read on public.class_slots for select to authenticated using (true);
drop policy if exists slots_staff_all on public.class_slots;
create policy slots_staff_all on public.class_slots for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists bk_read on public.slot_bookings;
create policy bk_read on public.slot_bookings for select to authenticated using (student_id = auth.uid() or public.is_staff());
drop policy if exists bk_staff_all on public.slot_bookings;
create policy bk_staff_all on public.slot_bookings for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 學生睇時段：只回傳人數 + 自己狀態（唔洩露其他學生身份）
create or replace function public.slot_list(p_from date default null, p_to date default null)
returns table(
  id uuid, session_date date, start_time time, end_time time, venue text, coach text,
  capacity int, min_to_open int, book_by timestamptz, status text, notes text,
  booked_count int, my_status text
) language sql stable security definer set search_path=public as $$
  select s.id, s.session_date, s.start_time, s.end_time, s.venue, s.coach,
         s.capacity, s.min_to_open, s.book_by, s.status, s.notes,
         coalesce(c.cnt,0)::int as booked_count,
         b.status as my_status
  from public.class_slots s
  left join lateral (select count(*) cnt from public.slot_bookings sb where sb.slot_id=s.id and sb.status='booked') c on true
  left join public.slot_bookings b on b.slot_id=s.id and b.student_id=auth.uid() and b.status<>'cancelled'
  where (p_from is null or s.session_date >= p_from)
    and (p_to  is null or s.session_date <= p_to)
  order by s.session_date, s.start_time;
$$;
grant execute on function public.slot_list(date,date) to authenticated;

-- 報名（自己；職員可代學生報，畀 WhatsApp / 手動用）
create or replace function public.book_slot(p_slot_id uuid, p_student uuid default null)
returns json language plpgsql security definer set search_path=public as $$
declare v_student uuid; v_slot public.class_slots%rowtype; v_count int; v_existing text; v_result text;
begin
  if p_student is null then v_student := auth.uid();
  else
    if not public.is_staff() then raise exception '只有教練/管理員先可以代人報名'; end if;
    v_student := p_student;
  end if;
  if v_student is null then raise exception '未登入'; end if;

  select * into v_slot from public.class_slots where id=p_slot_id for update;
  if not found then raise exception '搵唔到呢個時段'; end if;
  if v_slot.status not in ('open','confirmed') then raise exception '呢個時段唔接受報名'; end if;
  if v_slot.session_date < (now() at time zone 'Asia/Hong_Kong')::date then raise exception '呢個時段已經過咗'; end if;
  if v_slot.book_by is not null and now() > v_slot.book_by then raise exception '已過報名截止時間'; end if;

  select status into v_existing from public.slot_bookings
    where slot_id=p_slot_id and student_id=v_student and status<>'cancelled';
  if v_existing is not null then
    return json_build_object('ok',true,'status',v_existing,'already',true);
  end if;

  select count(*) into v_count from public.slot_bookings where slot_id=p_slot_id and status='booked';
  v_result := case when v_count >= v_slot.capacity then 'waitlist' else 'booked' end;

  insert into public.slot_bookings(slot_id, student_id, status) values (p_slot_id, v_student, v_result);

  select count(*) into v_count from public.slot_bookings where slot_id=p_slot_id and status='booked';
  if v_slot.status='open' and v_count >= v_slot.min_to_open then
    update public.class_slots set status='confirmed' where id=p_slot_id;
  end if;

  return json_build_object('ok',true,'status',v_result,'booked_count',v_count,
    'confirmed', v_count >= v_slot.min_to_open, 'capacity', v_slot.capacity, 'min_to_open', v_slot.min_to_open);
end;
$$;
grant execute on function public.book_slot(uuid,uuid) to authenticated;

-- 取消（自己；職員可代取消）；有後補自動補上；跌返落門檻以下變返 open
create or replace function public.cancel_booking(p_slot_id uuid, p_student uuid default null)
returns json language plpgsql security definer set search_path=public as $$
declare v_student uuid; v_slot public.class_slots%rowtype; v_count int; v_upd int;
begin
  if p_student is null then v_student := auth.uid();
  else
    if not public.is_staff() then raise exception '只有教練/管理員先可以代人取消'; end if;
    v_student := p_student;
  end if;
  if v_student is null then raise exception '未登入'; end if;

  select * into v_slot from public.class_slots where id=p_slot_id for update;
  if not found then raise exception '搵唔到呢個時段'; end if;

  update public.slot_bookings set status='cancelled'
    where slot_id=p_slot_id and student_id=v_student and status<>'cancelled';
  get diagnostics v_upd = row_count;
  if v_upd=0 then return json_build_object('ok',false,'msg','冇搵到你嘅報名'); end if;

  update public.slot_bookings set status='booked'
    where id = (select id from public.slot_bookings
                where slot_id=p_slot_id and status='waitlist' order by created_at limit 1);

  select count(*) into v_count from public.slot_bookings where slot_id=p_slot_id and status='booked';
  if v_slot.status='confirmed' and v_count < v_slot.min_to_open then
    update public.class_slots set status='open' where id=p_slot_id;
  end if;

  return json_build_object('ok',true,'booked_count',v_count);
end;
$$;
grant execute on function public.cancel_booking(uuid,uuid) to authenticated;

-- 職員睇名單（有名／email）；非職員回傳空
create or replace function public.slot_roster(p_slot_id uuid)
returns table(student_id uuid, name text, email text, status text, created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select sb.student_id, p.name, p.email, sb.status, sb.created_at
  from public.slot_bookings sb join public.profiles p on p.id=sb.student_id
  where sb.slot_id=p_slot_id and public.is_staff()
  order by (sb.status='booked') desc, sb.created_at;
$$;
grant execute on function public.slot_roster(uuid) to authenticated;
