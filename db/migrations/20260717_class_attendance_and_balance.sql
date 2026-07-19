-- 出席點名 → 由堂數扣一堂；學員睇到自己餘額。（已套用到 ikzoxrvnpsseyjviawti）
--
-- 模型：class_packages = 買咗幾多堂（sessions）。每次職員點名 attended=true，
-- 就由學員最舊嘅「未過期 + 仲有餘額」堂數扣一堂（記喺 slot_bookings.consumed_package_id）。
-- 餘額 = sessions − 已扣嘅 booking 數。揀唔到有效堂數（免費／試堂／爆額）就照記出席、唔扣。
-- 呢個係學員自助軸；分成計算器仍然係教練嘅獨立財務工具（各自計數）。

alter table public.slot_bookings
  add column if not exists attended boolean not null default false,
  add column if not exists consumed_package_id uuid references public.class_packages(id) on delete set null;
create index if not exists slot_bookings_consumed_idx on public.slot_bookings(consumed_package_id);

create or replace function public.mark_attendance(p_booking_id uuid, p_attended boolean)
returns json language plpgsql security definer set search_path=public as $$
declare v_b public.slot_bookings%rowtype; v_pkg uuid; v_today date;
begin
  if not public.is_staff() then raise exception '只有教練/管理員先可以點名'; end if;
  select * into v_b from public.slot_bookings where id=p_booking_id for update;
  if not found then raise exception '搵唔到報名紀錄'; end if;
  v_today := (now() at time zone 'Asia/Hong_Kong')::date;
  if p_attended then
    if v_b.attended then return json_build_object('ok',true,'attended',true,'already',true); end if;
    select cp.id into v_pkg from public.class_packages cp
      where cp.student_id = v_b.student_id
        and cp.expires_at >= v_today
        and cp.sessions > (select count(*) from public.slot_bookings sb where sb.consumed_package_id = cp.id)
      order by cp.expires_at, cp.purchased_at limit 1;
    update public.slot_bookings set attended=true, consumed_package_id=v_pkg where id=p_booking_id;
    return json_build_object('ok',true,'attended',true,'deducted', v_pkg is not null);
  else
    update public.slot_bookings set attended=false, consumed_package_id=null where id=p_booking_id;
    return json_build_object('ok',true,'attended',false);
  end if;
end;
$$;
grant execute on function public.mark_attendance(uuid, boolean) to authenticated;

create or replace function public.my_packages()
returns table(id uuid, package text, sessions int, used int, remaining int,
              purchased_at date, expires_at date, expired boolean)
language sql stable security definer set search_path=public as $$
  select cp.id, cp.package, cp.sessions,
    (select count(*)::int from public.slot_bookings sb where sb.consumed_package_id = cp.id) as used,
    (cp.sessions - (select count(*)::int from public.slot_bookings sb where sb.consumed_package_id = cp.id)) as remaining,
    cp.purchased_at, cp.expires_at,
    (cp.expires_at < (now() at time zone 'Asia/Hong_Kong')::date) as expired
  from public.class_packages cp
  where cp.student_id = auth.uid()
  order by (cp.expires_at >= (now() at time zone 'Asia/Hong_Kong')::date) desc, cp.expires_at desc, cp.purchased_at desc;
$$;
grant execute on function public.my_packages() to authenticated;

-- roster 加返 booking_id + attended（畀點名 UI 用）。回傳型別變咗 → 要先 drop。
drop function if exists public.slot_roster(uuid);
create function public.slot_roster(p_slot_id uuid)
returns table(booking_id uuid, student_id uuid, name text, email text, status text, attended boolean, created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select sb.id, sb.student_id, p.name, p.email, sb.status, sb.attended, sb.created_at
  from public.slot_bookings sb join public.profiles p on p.id=sb.student_id
  where sb.slot_id=p_slot_id and public.is_staff()
  order by (sb.status='booked') desc, sb.created_at;
$$;
revoke all on function public.slot_roster(uuid) from public, anon;
grant execute on function public.slot_roster(uuid) to authenticated, service_role;

-- 取消報名時釋放已扣嘅堂數（若曾點名出席）
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
  update public.slot_bookings set status='cancelled', attended=false, consumed_package_id=null
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
revoke all on function public.cancel_booking(uuid,uuid) from public, anon;
grant execute on function public.cancel_booking(uuid,uuid) to authenticated, service_role;
