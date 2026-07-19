-- WhatsApp 對話式報堂:bot 專用 RPC（已套用到 Supabase project ikzoxrvnpsseyjviawti）
-- 把報名/取消核心抽出做 _book_core / _cancel_core（book_slot / cancel_booking 改成叫佢哋，行為不變），
-- 再加 service_role 專用嘅 bot_* function（anon/authenticated 掂唔到）。

create or replace function public._book_core(p_slot_id uuid, p_student uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_slot public.class_slots%rowtype; v_count int; v_existing text; v_result text;
begin
  if p_student is null then raise exception '未指定學員'; end if;
  select * into v_slot from public.class_slots where id=p_slot_id for update;
  if not found then raise exception '搵唔到呢個時段'; end if;
  if v_slot.status not in ('open','confirmed') then raise exception '呢個時段唔接受報名'; end if;
  if v_slot.session_date < (now() at time zone 'Asia/Hong_Kong')::date then raise exception '呢個時段已經過咗'; end if;
  if v_slot.book_by is not null and now() > v_slot.book_by then raise exception '已過報名截止時間'; end if;
  select status into v_existing from public.slot_bookings
    where slot_id=p_slot_id and student_id=p_student and status<>'cancelled';
  if v_existing is not null then
    return json_build_object('ok',true,'status',v_existing,'already',true,
      'session_date',v_slot.session_date,'start_time',v_slot.start_time,'venue',v_slot.venue,'coach',v_slot.coach);
  end if;
  select count(*) into v_count from public.slot_bookings where slot_id=p_slot_id and status='booked';
  v_result := case when v_count >= v_slot.capacity then 'waitlist' else 'booked' end;
  insert into public.slot_bookings(slot_id,student_id,status) values (p_slot_id,p_student,v_result);
  select count(*) into v_count from public.slot_bookings where slot_id=p_slot_id and status='booked';
  if v_slot.status='open' and v_count >= v_slot.min_to_open then
    update public.class_slots set status='confirmed' where id=p_slot_id;
  end if;
  return json_build_object('ok',true,'status',v_result,'booked_count',v_count,
    'confirmed', v_count >= v_slot.min_to_open, 'capacity', v_slot.capacity, 'min_to_open', v_slot.min_to_open,
    'session_date',v_slot.session_date,'start_time',v_slot.start_time,'venue',v_slot.venue,'coach',v_slot.coach);
end; $$;
revoke all on function public._book_core(uuid,uuid) from anon, authenticated;

create or replace function public._cancel_core(p_slot_id uuid, p_student uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_slot public.class_slots%rowtype; v_count int; v_upd int;
begin
  if p_student is null then raise exception '未指定學員'; end if;
  select * into v_slot from public.class_slots where id=p_slot_id for update;
  if not found then raise exception '搵唔到呢個時段'; end if;
  update public.slot_bookings set status='cancelled'
    where slot_id=p_slot_id and student_id=p_student and status<>'cancelled';
  get diagnostics v_upd = row_count;
  if v_upd=0 then return json_build_object('ok',false,'msg','冇搵到你嘅報名'); end if;
  update public.slot_bookings set status='booked'
    where id = (select id from public.slot_bookings
                where slot_id=p_slot_id and status='waitlist' order by created_at limit 1);
  select count(*) into v_count from public.slot_bookings where slot_id=p_slot_id and status='booked';
  if v_slot.status='confirmed' and v_count < v_slot.min_to_open then
    update public.class_slots set status='open' where id=p_slot_id;
  end if;
  return json_build_object('ok',true,'booked_count',v_count,
    'session_date',v_slot.session_date,'start_time',v_slot.start_time,'venue',v_slot.venue,'coach',v_slot.coach);
end; $$;
revoke all on function public._cancel_core(uuid,uuid) from anon, authenticated;

create or replace function public.book_slot(p_slot_id uuid, p_student uuid default null)
returns json language plpgsql security definer set search_path=public as $$
declare v_student uuid;
begin
  if p_student is null then v_student := auth.uid();
  else
    if not public.is_staff() then raise exception '只有教練/管理員先可以代人報名'; end if;
    v_student := p_student;
  end if;
  if v_student is null then raise exception '未登入'; end if;
  return public._book_core(p_slot_id, v_student);
end; $$;
grant execute on function public.book_slot(uuid,uuid) to authenticated;

create or replace function public.cancel_booking(p_slot_id uuid, p_student uuid default null)
returns json language plpgsql security definer set search_path=public as $$
declare v_student uuid;
begin
  if p_student is null then v_student := auth.uid();
  else
    if not public.is_staff() then raise exception '只有教練/管理員先可以代人取消'; end if;
    v_student := p_student;
  end if;
  if v_student is null then raise exception '未登入'; end if;
  return public._cancel_core(p_slot_id, v_student);
end; $$;
grant execute on function public.cancel_booking(uuid,uuid) to authenticated;

create or replace function public.bot_book_slot(p_slot_id uuid, p_student uuid)
returns json language sql security definer set search_path=public as $$
  select public._book_core(p_slot_id, p_student);
$$;
revoke all on function public.bot_book_slot(uuid,uuid) from anon, authenticated;

create or replace function public.bot_cancel_booking(p_slot_id uuid, p_student uuid)
returns json language sql security definer set search_path=public as $$
  select public._cancel_core(p_slot_id, p_student);
$$;
revoke all on function public.bot_cancel_booking(uuid,uuid) from anon, authenticated;

create or replace function public.bot_my_bookings(p_student uuid)
returns table(slot_id uuid, session_date date, start_time time, venue text, coach text, slot_status text, my_status text)
language sql stable security definer set search_path=public as $$
  select cs.id, cs.session_date, cs.start_time, cs.venue, cs.coach, cs.status, b.status
  from public.slot_bookings b join public.class_slots cs on cs.id=b.slot_id
  where b.student_id=p_student and b.status in ('booked','waitlist')
    and cs.session_date >= (now() at time zone 'Asia/Hong_Kong')::date
    and cs.status <> 'cancelled'
  order by cs.session_date, cs.start_time;
$$;
revoke all on function public.bot_my_bookings(uuid) from anon, authenticated;
