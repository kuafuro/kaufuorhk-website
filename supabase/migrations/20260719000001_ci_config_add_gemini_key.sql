-- ci_config(): surface GEMINI_API_KEY / GEMINI_MODEL (optional) so the CI Modal deploy can inject
-- them into the Modal "sensevoice" secret. Used by 字幕準確模式 to fuse Whisper + SenseVoice via
-- Gemini. 冇入 Vault 就唔會出現 → workflow 當空字串 → Modal 內部唔做融合（graceful fallback）。
-- Applied live 2026-07-19.
create or replace function public.ci_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('MODAL_TOKEN_ID','MODAL_TOKEN_SECRET','SENSEVOICE_TOKEN','CALLBACK_SECRET','CALLBACK_URL',
                 'GEMINI_API_KEY','GEMINI_MODEL');
$$;
revoke all on function public.ci_config() from public, anon, authenticated;
grant execute on function public.ci_config() to service_role;
