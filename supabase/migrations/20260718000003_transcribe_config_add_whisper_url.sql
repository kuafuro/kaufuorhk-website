-- transcribe_config(): surface WHISPER_URL — 「🎯 準確模式」Whisper large-v3 endpoint,
-- deployed + registered by CI (modal-deploy workflow -> ci-config). Applied live 2026-07-18.
create or replace function public.transcribe_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('SENSEVOICE_URL','WHISPER_URL','SENSEVOICE_TOKEN','CALLBACK_SECRET','SWEEP_SECRET','CALLBACK_URL');
$$;
revoke all on function public.transcribe_config() from public, anon, authenticated;
grant execute on function public.transcribe_config() to service_role;
