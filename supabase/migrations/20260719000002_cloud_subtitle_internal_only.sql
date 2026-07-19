-- 雲端轉字幕（Whisper+SenseVoice→Gemini 融合）測試期間「只限內部」：holder + 技術人員。
--   holder      = role 'admin'（UI 叫「Holder（主理人）」）
--   技術人員／開發 = 新增 role 'developer'
-- Ming 心智模型：「supabase 應該有寫邊個係開發同 holder」→ 用 profiles.role 做單一真相來源。
-- 呢個 migration 係純附加（唔會影響現有 member/student/coach/admin 邏輯）。Applied live 2026-07-19.

-- 1) 準 Holder 喺用戶管理揀到「技術人員（開發）」呢個身份
create or replace function public.set_user_role(target_id uuid, new_role text)
returns void language plpgsql security definer set search_path = 'public' as $$
begin
  if not public.is_admin() then
    raise exception 'only admin can change roles';
  end if;
  if new_role not in ('member','student','coach','admin','developer') then
    raise exception 'invalid role: %', new_role;
  end if;
  update public.profiles set role = new_role, updated_at = now() where id = target_id;
end;
$$;

-- 2) 邊個可以用內部雲端功能（而家淨係雲端轉字幕用）：holder(admin) ∪ 技術人員(developer)
create or replace function public.is_tech_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles
    where id = p_user and role in ('admin','developer')
  );
$$;
revoke all on function public.is_tech_staff(uuid) from public, anon, authenticated;
grant execute on function public.is_tech_staff(uuid) to service_role;
