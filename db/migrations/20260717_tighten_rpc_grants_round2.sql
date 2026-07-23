-- 收緊 RPC grants（Supabase advisor 0028/0029，已套用到 ikzoxrvnpsseyjviawti）
-- 問題：create function 默認 grant EXECUTE 俾 PUBLIC，anon 經 PUBLIC 承繼到
-- slot_list（未登入睇到成個時間表+教練+備註）、user_level/user_plan（知 uuid 就查到人哋等級）等。
-- 修法：全部 revoke public+anon，只留 authenticated（+service_role）。
-- 特登唔郁 is_admin/is_staff：contact_requests 等 to-public RLS policy 評估時 anon 要 EXECUTE。
revoke all on function public.slot_list(date,date) from public, anon;
grant execute on function public.slot_list(date,date) to authenticated, service_role;
revoke all on function public.book_slot(uuid,uuid) from public, anon;
grant execute on function public.book_slot(uuid,uuid) to authenticated, service_role;
revoke all on function public.cancel_booking(uuid,uuid) from public, anon;
grant execute on function public.cancel_booking(uuid,uuid) to authenticated, service_role;
revoke all on function public.slot_roster(uuid) from public, anon;
grant execute on function public.slot_roster(uuid) to authenticated, service_role;
revoke all on function public.my_tiers() from public, anon;
grant execute on function public.my_tiers() to authenticated;
revoke all on function public.user_plan(uuid) from public, anon;
grant execute on function public.user_plan(uuid) to authenticated, service_role;
revoke all on function public.user_level(uuid) from public, anon;
grant execute on function public.user_level(uuid) to authenticated, service_role;
revoke all on function public.record_class_package(uuid, text, int, numeric, text) from public, anon;
grant execute on function public.record_class_package(uuid, text, int, numeric, text) to authenticated;
revoke all on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;
