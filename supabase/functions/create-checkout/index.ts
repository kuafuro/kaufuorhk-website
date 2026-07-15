// create-checkout — authenticated (user JWT). Returns { url } or { alreadyActive, portalUrl }.
// Secrets required: STRIPE_SECRET_KEY, PRICE_ALL, PRICE_SUBTITLE, PRICE_MOTIONLAB.
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const PRICES: Record<string, string> = {
  all: Deno.env.get('PRICE_ALL')!, subtitle: Deno.env.get('PRICE_SUBTITLE')!, motionlab: Deno.env.get('PRICE_MOTIONLAB')!,
};
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

    const { product, success_url, cancel_url } = await req.json();
    if (!PRICES[product]) return json({ error: 'bad product' }, 400);
    if (!isAllowed(success_url) || !isAllowed(cancel_url)) return json({ error: 'bad redirect' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Redundant-purchase guard: already covered (e.g. by 'all')? Send to portal, don't double-charge.
    const { data: covered } = await admin.rpc('has_pro', { p_user: user.id, p_product: product });
    if (covered) {
      const { data: row } = await admin.from('entitlements').select('stripe_customer_id')
        .eq('user_id', user.id).not('stripe_customer_id', 'is', null).limit(1).maybeSingle();
      if (row?.stripe_customer_id) {
        const portal = await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: cancel_url });
        return json({ alreadyActive: true, portalUrl: portal.url });
      }
      return json({ alreadyActive: true });
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
      line_items: [{ price: PRICES[product], quantity: 1 }],
      client_reference_id: user.id,
      metadata: { product },
      subscription_data: { metadata: { user_id: user.id, product } }, // CRITICAL: lifecycle events need this (spec §6.1)
      success_url,
      cancel_url,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error('create-checkout error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
