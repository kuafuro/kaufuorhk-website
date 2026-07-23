-- 堂數（新星／挑戰者／苦行僧）+ 修行 level 改為跟「學員買咗邊種堂數」
-- 依據《踢拳小班教學合辦協議書 Rev.3（2026-07-13）》條款 1.1：
--   新星堂數（標準價）  HK$800 / 4 堂（小班）
--   挑戰者堂數（標準價）HK$1,400 / 8 堂（小班）
--   苦行僧（單對單）    收費同教練議定（彈性議價）
--   堂數兩個月有效（條款 1.2）；可個別議價（條款 1.1.5）
-- （已套用到 Supabase project ikzoxrvnpsseyjviawti）
--
-- 同時保留：user_plan（訂閱 Holder/Pro/Max，由 entitlements.tier 衍生）— 網站數碼服務課金，
-- 同堂數係兩條獨立軸。

create table if not exists public.class_packages(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  package text not null check (package in ('rising','challenger','ascetic')),
  sessions int not null check (sessions >= 1),
  price_hkd numeric(8,2) not null check (price_hkd >= 0),
  purchased_at date not null,
  expires_at date not null,           -- 購買日 + 2 個月（協議條款 1.2）
  notes text,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists class_packages_student_idx on public.class_packages(student_id, purchased_at desc);

alter table public.class_packages enable row level security;
-- 學員睇自己嘅；職員睇全部。寫入只可以經 record_class_package RPC（無 client 寫入 policy = default deny）。
drop policy if exists cp_read on public.class_packages;
create policy cp_read on public.class_packages for select to authenticated
  using (student_id = auth.uid() or public.is_staff());

-- 職員記錄堂數購買。標準價自動帶入（協議 1.1.1／1.1.2）；苦行僧／議價必須自報堂數同實價。
create or replace function public.record_class_package(
  p_student uuid, p_package text,
  p_sessions int default null, p_price numeric default null, p_notes text default null)
returns json language plpgsql security definer set search_path=public as $$
declare v_sessions int; v_price numeric; v_today date;
begin
  if not public.is_staff() then raise exception '只有教練/管理員先可以記錄堂數'; end if;
  if p_package not in ('rising','challenger','ascetic') then raise exception '堂數類型唔啱: %', p_package; end if;
  if p_package = 'rising' then
    v_sessions := coalesce(p_sessions, 4);  v_price := coalesce(p_price, 800);
  elsif p_package = 'challenger' then
    v_sessions := coalesce(p_sessions, 8);  v_price := coalesce(p_price, 1400);
  else -- ascetic 單對單：議價，必須明確俾堂數同價錢
    if p_sessions is null or p_price is null then raise exception '苦行僧（單對單）須列明堂數同議定價錢'; end if;
    v_sessions := p_sessions; v_price := p_price;
  end if;
  v_today := (now() at time zone 'Asia/Hong_Kong')::date;
  insert into public.class_packages(student_id, package, sessions, price_hkd, purchased_at, expires_at, notes, recorded_by)
  values (p_student, p_package, v_sessions, v_price, v_today, (v_today + interval '2 months')::date, p_notes, auth.uid());
  return json_build_object('ok', true, 'package', p_package, 'sessions', v_sessions, 'price', v_price,
                           'expires', (v_today + interval '2 months')::date);
end;
$$;
grant execute on function public.record_class_package(uuid, text, int, numeric, text) to authenticated;

-- 修行 level ＝ 學員買咗邊種堂數：有效（未過期）堂數優先，最高級數行先（苦行僧＞挑戰者＞新星）；
-- 全部過晒期就以最近一次購買為準（榮譽保留）；從未買過 → null（唔顯示 badge）。
create or replace function public.user_level(p_user uuid)
returns table(level text, attended int)
language sql stable security definer set search_path=public as $$
  with hk as (select (now() at time zone 'Asia/Hong_Kong')::date as today),
  rank as (select 'ascetic' p, 3 r union all select 'challenger', 2 union all select 'rising', 1)
  select coalesce(
      (select cp.package from public.class_packages cp, hk
        where cp.student_id = p_user and cp.expires_at >= hk.today
        order by (select r from rank where p = cp.package) desc, cp.purchased_at desc limit 1),
      (select cp.package from public.class_packages cp
        where cp.student_id = p_user
        order by cp.purchased_at desc, cp.created_at desc limit 1)
    ),
    (select count(*)::int
     from public.slot_bookings b
     join public.class_slots s on s.id = b.slot_id, hk
     where b.student_id = p_user and b.status = 'booked'
       and s.status <> 'cancelled' and s.session_date < hk.today);
$$;
grant execute on function public.user_level(uuid) to authenticated;
