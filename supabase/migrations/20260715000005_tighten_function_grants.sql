-- Least-privilege on the billing/usage SECURITY DEFINER functions (Supabase advisor 0028/0029).
-- These take an arbitrary uuid arg, so no client role should call them directly: the Edge Functions
-- reach them via service_role, and RLS/trigger evaluation runs them internally regardless of caller
-- EXECUTE grants. Applied to ikzoxrvnpsseyjviawti on 2026-07-15.

-- Only ever called server-side (service_role) by transcribe-fast / create-checkout.
revoke all on function public.entitlement_tier(uuid, text) from public, anon, authenticated;
grant execute on function public.entitlement_tier(uuid, text) to service_role;

revoke all on function public.transcribe_minutes_this_month(uuid) from public, anon, authenticated;
grant execute on function public.transcribe_minutes_this_month(uuid) to service_role;

-- has_pro: used inside authenticated-only RLS checks + service_role; anon never needs it.
revoke execute on function public.has_pro(uuid, text) from anon;

-- Trigger function: fires from the trigger, never needs a direct RPC grant.
revoke all on function public.enforce_motionlab_quota() from public, anon, authenticated;
