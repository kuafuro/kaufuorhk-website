-- Pipeline config moved into Vault (encrypted at rest), read ONLY via service-role RPCs — removes
-- the dependency on dashboard-managed Edge Function env secrets. The secret VALUES are inserted
-- separately (never committed); this migration is structure only. Applied 2026-07-16.

create or replace function public.transcribe_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('SENSEVOICE_URL','SENSEVOICE_TOKEN','CALLBACK_SECRET','SWEEP_SECRET','CALLBACK_URL');
$$;
revoke all on function public.transcribe_config() from public, anon, authenticated;
grant execute on function public.transcribe_config() to service_role;

-- sweep-audio helper: expired object names (PostgREST does not expose the storage schema to .schema()).
create or replace function public.expired_subtitle_audio(p_hours int default 6)
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'subtitle-audio'
    and o.created_at < now() - make_interval(hours => p_hours)
  limit 1000;
$$;
revoke all on function public.expired_subtitle_audio(int) from public, anon, authenticated;
grant execute on function public.expired_subtitle_audio(int) to service_role;
