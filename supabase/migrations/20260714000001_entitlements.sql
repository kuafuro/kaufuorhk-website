-- Entitlements: billing access, orthogonal to profiles.role (identity). See spec §5.
-- Applied to project ikzoxrvnpsseyjviawti on 2026-07-14.
create table if not exists public.entitlements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  product                text not null check (product in ('all','subtitle','motionlab')),
  status                 text not null default 'inactive'
                           check (status in ('active','past_due','canceled','inactive')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  last_event_at          timestamptz,           -- Stripe event.created of last applied event (ordering guard)
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  unique (user_id, product)
);

create unique index if not exists entitlements_stripe_sub_idx
  on public.entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.entitlements enable row level security;

-- Clients may read only their own rows. No insert/update/delete policy => default-deny (webhook uses service role).
drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own on public.entitlements
  for select to authenticated
  using (auth.uid() = user_id);

-- Unlock check reused by RLS on premium data tables (Phase 3) and by create-checkout's guard.
create or replace function public.has_pro(p_user uuid, p_product text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and e.product in ('all', p_product)
      and e.status = 'active'
      and (e.current_period_end is null or e.current_period_end > now())
  );
$$;

revoke all on function public.has_pro(uuid, text) from public;
grant execute on function public.has_pro(uuid, text) to authenticated, service_role;
