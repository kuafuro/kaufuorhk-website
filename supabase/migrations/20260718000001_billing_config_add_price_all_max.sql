-- billing_config(): add PRICE_ALL_MAX to the surfaced Vault secrets. It was omitted from the
-- name list, so create-checkout could not resolve `all:max` -> Kuafuor Max (HK$120) checkouts
-- returned "bad product", and setup-billing re-created a duplicate Max product on every run.
-- Values live only in Vault (never committed); this migration is structure only. Applied 2026-07-18.
create or replace function public.billing_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('PRICE_ALL','PRICE_ALL_MAX','PRICE_SUBTITLE','PRICE_MOTIONLAB','PRICE_SUBTITLE_MAX',
                 'STRIPE_WEBHOOK_SECRET','SETUP_SECRET');
$$;
revoke all on function public.billing_config() from public, anon, authenticated;
grant execute on function public.billing_config() to service_role;
