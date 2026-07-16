-- 教練（菁英）／Holder 唔可以自己報名上堂 — 佢哋係教堂，唔係上堂。
-- 代學員報名（p_student）唔受影響。（已套用到 Supabase project ikzoxrvnpsseyjviawti）
create or replace function public.book_slot(p_slot_id uuid, p_student uuid default null)
returns json language plpgsql security definer set search_path=public as $$
declare v_student uuid; v_slot public.class_slots%rowtype; v_count int; v_existing text; v_result text;
begin
  if p_student is null then
    if public.is_staff() then raise exception '教練唔可以自己報名上堂（用名單「代學員報名」就得）'; end if;
    v_student := auth.uid();
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
