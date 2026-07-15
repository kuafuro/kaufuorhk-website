// create-portal — authenticated (user JWT). Returns { url } to Stripe's billing portal.
// Secrets required: STRIPE_SECRET_KEY. (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY auto-injected.)
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
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
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authz } } });
    const { data: { user } } = await asUser.auth.getUser(authz.replace('Bearer ', ''));
    if (!user) return json({ error: 'not signed in' }, 401);

    const { return_url } = await req.json();
    if (!isAllowed(return_url)) return json({ error: 'bad return_url' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row } = await admin.from('entitlements').select('stripe_customer_id')
      .eq('user_id', user.id).not('stripe_customer_id', 'is', null).limit(1).maybeSingle();
    if (!row?.stripe_customer_id) return json({ error: 'no customer' }, 404);

    const portal = await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url });
    return json({ url: portal.url });
  } catch (e) {
    console.error('create-portal error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
