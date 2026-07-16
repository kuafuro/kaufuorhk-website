// create-checkout — authenticated (user JWT). Returns { url } | { alreadyActive, portalUrl } | { upgrade, portalUrl }.
// Secrets required: STRIPE_SECRET_KEY, PRICE_ALL, PRICE_SUBTITLE, PRICE_MOTIONLAB. Optional (tiers): PRICE_SUBTITLE_MAX.
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
// Price per `${product}:${tier}`. 'pro' is the existing set; '*_MAX' add the higher tier (spec §2.5).
const PRICES: Record<string, string | undefined> = {
  'all:pro':       Deno.env.get('PRICE_ALL'),
  'subtitle:pro':  Deno.env.get('PRICE_SUBTITLE'),
  'motionlab:pro': Deno.env.get('PRICE_MOTIONLAB'),
  'subtitle:max':  Deno.env.get('PRICE_SUBTITLE_MAX'),
};
const TIER_RANK: Record<string, number> = { pro: 1, max: 2 };
const ALLOWED_HOSTS = ['kuafuorhk.com', 'www.kuafuorhk.com', 'localhost'];
const isAllowed = (u: string) => { try { return ALLOWED_HOSTS.includes(new URL(u).hostname); } catch { return false; } };
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authz = req.headers.get('Authorization') ?? '';
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authz } },
    });
    const { data: { user } } = await asUser.auth.getUser(authz.replace('Bearer ', ''));
    if (!user) return json({ error: 'not signed in' }, 401);

    const body = await req.json();
    const { product, success_url, cancel_url } = body;
    const tier: string = body.tier === 'max' ? 'max' : 'pro';   // default 'pro'; only 'pro'|'max' valid
    const reqRank = TIER_RANK[tier];
    if (!PRICES[`${product}:${tier}`]) return json({ error: 'bad product' }, 400);
    if (!isAllowed(success_url) || !isAllowed(cancel_url)) return json({ error: 'bad redirect' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Redundant/upgrade guard: compare the requested tier to the tier the user already holds (via 'all' too).
    const { data: currentTierRaw } = await admin.rpc('entitlement_tier', { p_user: user.id, p_product: product });
    const currentRank = TIER_RANK[(currentTierRaw as string) ?? ''] ?? 0;
    if (currentRank > 0) {
      const { data: row } = await admin.from('entitlements').select('stripe_customer_id')
        .eq('user_id', user.id).not('stripe_customer_id', 'is', null).limit(1).maybeSingle();
      const portalUrl = row?.stripe_customer_id
        ? (await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: cancel_url })).url
        : undefined;
      // Already at/above requested tier -> nothing to buy (manage in portal). Below it -> upgrade:
      // switch the plan on the existing subscription in the portal (avoids a double subscription).
      return currentRank >= reqRank
        ? json({ alreadyActive: true, portalUrl })
        : json({ upgrade: true, portalUrl });
    }

    // Find-or-create the Stripe customer for this user (reuse any stored id).
    const { data: anyRow } = await admin.from('entitlements').select('stripe_customer_id')
      .eq('user_id', user.id).not('stripe_customer_id', 'is', null).limit(1).maybeSingle();
    let customer = anyRow?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripe.customers.create({ email: user.email ?? undefined, metadata: { user_id: user.id } });
      customer = c.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: PRICES[`${product}:${tier}`], quantity: 1 }],
      client_reference_id: user.id,
      metadata: { product, tier },
      subscription_data: { metadata: { user_id: user.id, product, tier } }, // CRITICAL: lifecycle events need this (spec §6.1)
      success_url,
      cancel_url,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error('create-checkout error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
