-- 用戶等級三軸整理（已套用到 Supabase project ikzoxrvnpsseyjviawti）
--
-- 軸一 身份 role（權限，admin 先改得）：member（Holder 帳戶持有人）/ student / coach / admin
--   → 已存在：public.profiles.role + set_user_role() RPC
-- 軸二 訂閱 plan（課金，billing 自助）：holder（免費）/ pro（單一產品）/ max（product='all'）
--   → 由已存在嘅 public.entitlements 衍生，唔另外儲存，冇 drift
-- 軸三 修行 level（練出嚟，唔影響權限）：新星（<10 堂）/ 挑戰者（10–49 堂）/ 苦行僧（≥50 堂）
--   → 由 slot_bookings 過去出席（booked + 過咗堂）衍生
--
-- 三個 function 都係唯讀衍生值：冇 schema 改動、冇 policy 改動。

-- 訂閱 plan：max > pro > holder
create or replace function public.user_plan(p_user uuid)
returns text language sql stable security definer set search_path=public as $$
  select case
    when exists (select 1 from public.entitlements e
                 where e.user_id = p_user and e.product = 'all' and e.status = 'active'
                   and (e.current_period_end is null or e.current_period_end > now()))
      then 'max'
    when exists (select 1 from public.entitlements e
                 where e.user_id = p_user and e.status = 'active'
                   and (e.current_period_end is null or e.current_period_end > now()))
      then 'pro'
    else 'holder'
  end;
$$;
grant execute on function public.user_plan(uuid) to authenticated;

-- 修行 level：計過去（香港時區）已 booked 嘅堂數
create or replace function public.user_level(p_user uuid)
returns table(level text, attended int)
language sql stable security definer set search_path=public as $$
  with c as (
    select count(*)::int n
    from public.slot_bookings b
    join public.class_slots s on s.id = b.slot_id
    where b.student_id = p_user and b.status = 'booked'
      and s.status <> 'cancelled'
      and s.session_date < (now() at time zone 'Asia/Hong_Kong')::date
  )
  select case when n >= 50 then 'ascetic'
              when n >= 10 then 'challenger'
              else 'rising' end,
         n
  from c;
$$;
grant execute on function public.user_level(uuid) to authenticated;

-- 一次過攞自己三軸（login 頁顯示 badge 用）
create or replace function public.my_tiers()
returns json language sql stable security definer set search_path=public as $$
  select json_build_object(
    'role', coalesce((select role from public.profiles where id = auth.uid()), 'member'),
    'plan', public.user_plan(auth.uid()),
    'level', (select level from public.user_level(auth.uid())),
    'attended', (select attended from public.user_level(auth.uid()))
  );
$$;
grant execute on function public.my_tiers() to authenticated;
