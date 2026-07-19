-- 補返：profiles.role 張表本身嘅 CHECK constraint 要包埋 'developer'（技術人員／開發）。
-- 20260719000002 只改咗 set_user_role() 內部嘅 allow-list，漏咗張表個 constraint，
-- 所以喺用戶管理揀「技術人員（開發）」會撞 profiles_role_check（改唔到）。Applied live 2026-07-19.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['member'::text,'student'::text,'coach'::text,'developer'::text,'admin'::text]));
