-- SenseVoice cloud transcription: tier + monthly usage metering (spec §2.5, §6).
-- Additive & safe: existing entitlement rows default to tier 'pro' (identical access to today).
-- Applied to project ikzoxrvnpsseyjviawti on 2026-07-15.

-- 1. Tier on entitlements. 'pro' | 'max'. has_pro() is unchanged (any active row = access);
--    tier only picks the quota. Default 'pro' so every existing/legacy write stays valid.
alter table public.entitlements add column if not exists tier text not null default 'pro';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'entitlements_tier_check') then
    alter table public.entitlements add constraint entitlements_tier_check check (tier in ('pro','max'));
  end if;
end $$;

-- 2. Highest active tier for (user, product), counting 'all' coverage. Returns null if none.
create or replace function public.entitlement_tier(p_user uuid, p_product text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when bool_or(e.tier = 'max') then 'max'
    when bool_or(e.tier = 'pro') then 'pro'
    else null
  end
  from public.entitlements e
  where e.user_id = p_user
    and e.product in ('all', p_product)
    and e.status = 'active'
    and (e.current_period_end is null or e.current_period_end > now());
$$;
revoke all on function public.entitlement_tier(uuid, text) from public;
grant execute on function public.entitlement_tier(uuid, text) to authenticated, service_role;

-- 3. Per-transcription usage log (minutes). Written only by the transcribe-fast Edge Function
--    (service role). Users may read their own usage; no client write path.
create table if not exists public.usage_transcribe (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  minutes      numeric not null default 0 check (minutes >= 0),
  storage_path text,
  created_at   timestamptz not null default now()
);
create index if not exists usage_tx_user_month_idx on public.usage_transcribe (user_id, created_at desc);

alter table public.usage_transcribe enable row level security;
drop policy if exists usage_tx_select on public.usage_transcribe;
create policy usage_tx_select on public.usage_transcribe
  for select to authenticated using (auth.uid() = user_id);
-- No insert/update/delete policy => default-deny for clients; the Edge Function uses the service role.

-- 4. Minutes used this calendar month (drives the quota check).
create or replace function public.transcribe_minutes_this_month(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutes), 0)
  from public.usage_transcribe
  where user_id = p_user
    and created_at >= date_trunc('month', now());
$$;
revoke all on function public.transcribe_minutes_this_month(uuid) from public;
grant execute on function public.transcribe_minutes_this_month(uuid) to authenticated, service_role;
