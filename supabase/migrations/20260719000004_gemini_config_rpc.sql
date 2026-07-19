-- gemini-fuse edge function 攞 key 用：淨係出 GEMINI_API_KEY / GEMINI_MODEL（最小權限，
-- 唔似 ci_config 咁連 Modal token 都出埋）。service_role only。Applied live 2026-07-19.
create or replace function public.gemini_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('GEMINI_API_KEY','GEMINI_MODEL');
$$;
revoke all on function public.gemini_config() from public, anon, authenticated;
grant execute on function public.gemini_config() to service_role;
