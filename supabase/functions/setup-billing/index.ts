// setup-billing — idempotent Stripe provisioning for whichever mode STRIPE_SECRET_KEY is in
// (test or live). Ensures the products + monthly HKD prices exist (Kuafuor Pro 70 / Kuafuor Max 120 /
// Subtitle Pro 30 + Subtitle Max 88 / Motion Lab Pro 50 — max tiers as their OWN products for
// portal plan-switching), ensures our webhook endpoint exists (its signing secret goes straight
// into Vault — no human ever sees it), configures the billing portal for Pro<->Max switching,
// and stores all price ids in Vault (billing_config). Re-run after swapping in a live key.
// Auth: x-setup-secret must equal Vault SETUP_SECRET. Deploy with verify_jwt=false.
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WEBHOOK_URL = 'https://ikzoxrvnpsseyjviawti.supabase.co/functions/v1/stripe-webhook';
const WEBHOOK_EVENTS = [
  'checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created',
] as Stripe.WebhookEndpointCreateParams.EnabledEvent[];

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b, null, 1), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await admin.rpc('billing_config');
  const SETUP_SECRET = (cfg?.SETUP_SECRET as string) || '';
  if (!SETUP_SECRET || req.headers.get('x-setup-secret') !== SETUP_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const sk = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (!sk) return json({ error: 'STRIPE_SECRET_KEY not set' }, 500);
  const stripe = new Stripe(sk, { apiVersion: '2024-06-20' });
  const live = sk.startsWith('sk_live');
  const out: Record<string, unknown> = { mode: live ? 'live' : 'test' };
  const setV = (n: string, v: string) => admin.rpc('vault_set_secret', { p_name: n, p_value: v });

  try {
    // A stored price id is reused only if it is active AND belongs to the current mode —
    // so re-running with a live key automatically re-provisions everything for live.
    async function existingPrice(name: string): Promise<Stripe.Price | null> {
      const id = ((cfg?.[name] as string) || Deno.env.get(name) || '').trim();
      if (!id) return null;
      try {
        const p = await stripe.prices.retrieve(id);
        if (p.active && p.livemode === live) return p;
      } catch (_) { /* wrong mode / deleted */ }
      return null;
    }
    async function ensure(name: string, prodName: string, amount: number): Promise<Stripe.Price> {
      let price = await existingPrice(name);
      if (!price) {
        const product = await stripe.products.create({ name: prodName });
        price = await stripe.prices.create({
          product: product.id, currency: 'hkd', unit_amount: amount,
          recurring: { interval: 'month' }, nickname: prodName,
        });
      }
      await setV(name, price.id);
      return price;
    }

    const pAll = await ensure('PRICE_ALL', 'Kuafuor Pro', 7000);
    const pSub = await ensure('PRICE_SUBTITLE', 'Subtitle Pro', 3000);
    const pMot = await ensure('PRICE_MOTIONLAB', 'Motion Lab Pro', 5000);
    // Kuafuor Max：全站 max tier，自己一個 product（portal 先切到 plan）
    const pAllMax = await ensure('PRICE_ALL_MAX', 'Kuafuor Max', 12000);

    // Subtitle Max is its OWN product: the billing portal can only switch plans across
    // products when the prices share a billing interval (same-product monthly+monthly is rejected).
    let pMax = await existingPrice('PRICE_SUBTITLE_MAX');
    if (pMax && pMax.product === pSub.product) pMax = null;   // migrate off the shared product
    if (!pMax) {
      const maxProduct = await stripe.products.create({ name: 'Subtitle Max' });
      pMax = await stripe.prices.create({
        product: maxProduct.id, currency: 'hkd', unit_amount: 8800,
        recurring: { interval: 'month' }, nickname: 'Subtitle Max',
      });
    }
    await setV('PRICE_SUBTITLE_MAX', pMax.id);
    out.prices = { all: pAll.id, all_max: pAllMax.id, subtitle: pSub.id, motionlab: pMot.id, subtitle_max: pMax.id };

    // Webhook endpoint: create only if absent (the signing secret is only revealed at creation).
    const eps = await stripe.webhookEndpoints.list({ limit: 100 });
    const ours = eps.data.find((e) => e.url === WEBHOOK_URL && e.status === 'enabled');
    if (!ours) {
      const ep = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: WEBHOOK_EVENTS });
      if (ep.secret) await setV('STRIPE_WEBHOOK_SECRET', ep.secret);
      out.webhook = 'created';
    } else {
      out.webhook = 'exists (signing secret unchanged)';
    }

    // Billing portal: cancel at period end + Pro<->Max plan switch (subtitle + site-wide pairs).
    try {
      const features: Stripe.BillingPortal.ConfigurationUpdateParams.Features = {
        payment_method_update: { enabled: true },   // required for subscription_update
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        subscription_update: {
          enabled: true, default_allowed_updates: ['price'],
          products: [
            { product: pSub.product as string, prices: [pSub.id] },
            { product: pMax.product as string, prices: [pMax.id] },
            { product: pAll.product as string, prices: [pAll.id] },
            { product: pAllMax.product as string, prices: [pAllMax.id] },
          ],
        },
        invoice_history: { enabled: true },
      };
      const confs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
      if (confs.data.length) {
        await stripe.billingPortal.configurations.update(confs.data[0].id, { features });
        out.portal = 'updated';
      } else {
        await stripe.billingPortal.configurations.create({
          business_profile: { headline: 'Kuafuor HK' }, features,
        });
        out.portal = 'created';
      }
    } catch (e) {
      out.portal = 'skipped: ' + (e as Error).message.slice(0, 140);
    }

    return json(out);
  } catch (e) {
    console.error('setup-billing error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
