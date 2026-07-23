-- 訂閱 plan tier-aware（已套用）：以 entitlements.tier 為準
-- Holder（免費）/ Pro（任一 active）/ Max（任一 active tier='max'）
create or replace function public.user_plan(p_user uuid)
returns text language sql stable security definer set search_path=public as $$
  select case
    when exists (select 1 from public.entitlements e
                 where e.user_id = p_user and e.status = 'active' and e.tier = 'max'
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
