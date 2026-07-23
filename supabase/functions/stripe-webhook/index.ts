// Stripe webhook — the ONLY writer of public.entitlements. Deploy with verify_jwt=false
// (Stripe calls it unauthenticated; it verifies the Stripe signature itself).
// Secrets required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Config is Vault-first (billing_config RPC) with env fallback, fetched per request so a
// re-provisioning (e.g. test -> live via setup-billing) takes effect without a redeploy.
async function billingCfg(): Promise<Record<string, string>> {
  const { data } = await db.rpc('billing_config');
  return (data ?? {}) as Record<string, string>;
}

type Ent = 'active' | 'past_due' | 'canceled' | 'inactive';
// Never store Stripe's raw status (CHECK only allows the 4 above). Fail-closed to past_due.
function mapStripeStatus(s: string): Ent {
  if (s === 'active') return 'active';
  if (s === 'canceled') return 'canceled';
  return 'past_due'; // past_due, unpaid, incomplete, incomplete_expired, paused, and anything new
}

// Which price IDs are the 'max' tier (spec §2.5). Everything else (the 'pro' prices) -> 'pro'.
// Price is authoritative, so a portal plan-switch (Pro<->Max on the same subscription) is captured
// on customer.subscription.updated.
function tierForSub(sub: Stripe.Subscription, maxPrices: Set<string>): 'pro' | 'max' {
  const priceId = sub.items?.data?.[0]?.price?.id;
  return priceId && maxPrices.has(priceId) ? 'max' : 'pro';
}

// Apply an update only if this event is newer than the last one applied to the row (ordering guard).
async function applyIfNewer(match: Record<string, string>, eventCreated: number, patch: Record<string, unknown>) {
  const { data: existing } = await db.from('entitlements').select('last_event_at').match(match).maybeSingle();
  const evtAt = new Date(eventCreated * 1000).toISOString();
  if (existing?.last_event_at && existing.last_event_at >= evtAt) return; // stale / out-of-order → ignore
  await db.from('entitlements').update({ ...patch, last_event_at: evtAt, updated_at: new Date().toISOString() }).match(match);
}

Deno.serve(async (req) => {
  const cfg = await billingCfg();
  const WHSEC = cfg.STRIPE_WEBHOOK_SECRET || Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
  const maxPrices = new Set([
    cfg.PRICE_SUBTITLE_MAX || Deno.env.get('PRICE_SUBTITLE_MAX'),
    cfg.PRICE_ALL_MAX || Deno.env.get('PRICE_ALL_MAX'),
  ].filter(Boolean) as string[]);
  const sig = req.headers.get('stripe-signature');
  const body = await req.text(); // RAW body — required for signature verification
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WHSEC);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error).message}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      const user_id = s.client_reference_id!;
      const product = s.metadata?.product!;
      const sub = await stripe.subscriptions.retrieve(s.subscription as string); // authoritative snapshot
      await db.from('entitlements').upsert({
        user_id, product,
        tier: tierForSub(sub, maxPrices),
        status: mapStripeStatus(sub.status),
        stripe_customer_id: s.customer as string,
        stripe_subscription_id: sub.id,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        last_event_at: new Date(event.created * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,product' });

    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const fresh = await stripe.subscriptions.retrieve(sub.id); // re-fetch to avoid stale payload
      await applyIfNewer({ stripe_subscription_id: sub.id }, event.created, {
        status: event.type === 'customer.subscription.deleted' ? 'canceled' : mapStripeStatus(fresh.status),
        tier: tierForSub(fresh, maxPrices), // captures a portal Pro<->Max plan-switch on the same subscription
        current_period_end: new Date(fresh.current_period_end * 1000).toISOString(),
      });

    } else if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.subscription) await applyIfNewer({ stripe_subscription_id: inv.subscription as string }, event.created, { status: 'past_due' });

    } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const chargeId = event.type === 'charge.dispute.created'
        ? (event.data.object as Stripe.Dispute).charge as string
        : (event.data.object as Stripe.Charge).id;
      const ch = await stripe.charges.retrieve(chargeId, { expand: ['invoice'] });
      const subId = (ch.invoice as Stripe.Invoice | null)?.subscription as string | undefined;
      if (subId) await applyIfNewer({ stripe_subscription_id: subId }, event.created, { status: 'canceled' }); // re-lock
    }
    return new Response('ok', { status: 200 }); // always 2xx once safely handled → Stripe stops retrying
  } catch (e) {
    console.error('webhook handler error', event.type, e);
    return new Response(`handler error: ${(e as Error).message}`, { status: 500 }); // Stripe will retry
  }
});
