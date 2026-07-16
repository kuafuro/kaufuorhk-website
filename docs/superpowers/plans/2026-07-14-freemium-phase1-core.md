# Freemium Phase 1 — Core Billing Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable, self-serve Stripe subscription core — an `entitlements` table, three Supabase Edge Functions, and a shared `assets/entitlements.js` — so any tool can gate premium features and users can pay to unlock them instantly.

**Architecture:** Static frontend (GitHub Pages, no bundler) calls Supabase Edge Functions (Deno) that talk to Stripe; a signature-verified webhook is the only writer of the `entitlements` table (RLS default-deny for clients); the frontend reads its own entitlements and unlocks the UI. This phase ships with a tiny demo unlock button to prove the loop end-to-end in Stripe test mode; Phases 2 (轉字幕) and 3 (Motion Lab) wire real tools.

**Tech Stack:** Supabase (Postgres 17 + RLS + Edge Functions/Deno), Stripe (Checkout Subscriptions + Billing Portal + Webhooks), vanilla ES-module JS (no build step), `@supabase/supabase-js@2` (ESM CDN), Stripe Deno SDK.

**Design spec:** `docs/superpowers/specs/2026-07-14-freemium-paid-tiers-design.md` (read it — this plan implements §5, §6, §7 and the §16 review fixes).

## Global Constraints

- **No build step.** Static site served as-is by GitHub Pages. `assets/entitlements.js` must be a plain ES module loadable via `<script type="module">` or dynamic `import()`. No npm/bundler in the frontend.
- **Supabase project:** `ikzoxrvnpsseyjviawti` (`kuafuor-motion-lab`), region ap-southeast-1. `SB_URL = https://ikzoxrvnpsseyjviawti.supabase.co`. Publishable key `sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O` is public and may live in the repo.
- **Secrets never in the repo.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` live only as Supabase Edge Function secrets. Commit nothing secret. Grep every commit for `sk_`, `rk_`, `whsec_`, `service_role`.
- **Prices (monthly, HKD):** `all` = HK$70, `subtitle` = HK$30, `motionlab` = HK$50. Amounts live in Stripe; the frontend only holds price IDs.
- **Entitlements are written only by the webhook** (service role). Clients get RLS `select` on their own rows and no write policy.
- **Free tier requires no login; premium requires login.** `entitlements.js` must lazy-load Supabase only on login/upgrade so a free, offline tool keeps working.
- **UI matches the editorial identity:** fonts `Cormorant Garamond`/`Lora`/`Noto Serif TC`, accent `#a83228`, bg `#f3f2f2`, radius 4px, hairline `#d7d3d3`. Bilingual via the `kf-lang` localStorage key (`zh`|`en`).
- **`product` enum:** exactly `'all' | 'subtitle' | 'motionlab'` this phase. Unlock rule: tool `T` unlocked iff an `active` entitlement exists with `product IN ('all', T)` and (`current_period_end` is null or in the future).
- **Deploy Edge Functions** with `supabase functions deploy <name> --project-ref ikzoxrvnpsseyjviawti` (or the Supabase MCP `deploy_edge_function`). Webhook must be deployed with `--no-verify-jwt` (Stripe calls it unauthenticated; it verifies the Stripe signature itself).

---

### Task 1: Database migration — `entitlements` table, RLS, `has_pro()`

**Files:**
- Create: `supabase/migrations/20260714000001_entitlements.sql`

**Interfaces:**
- Produces: table `public.entitlements`; function `public.has_pro(uuid, text) returns boolean`. Consumed by Tasks 3–6 and Phases 2–3.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260714000001_entitlements.sql`:

```sql
-- Entitlements: billing access, orthogonal to profiles.role (identity). See spec §5.
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
```

- [ ] **Step 2: Apply the migration and verify it fails-safe for clients**

Apply via the Supabase MCP `apply_migration` (name `entitlements`, the SQL above) or `supabase db push`.
Then run these verification queries (via MCP `execute_sql` or `psql`):

```sql
-- (a) table + function exist
select to_regclass('public.entitlements') is not null as has_table;               -- expect: true
select proname from pg_proc where proname = 'has_pro';                             -- expect: has_pro

-- (b) has_pro returns false for a random user (no rows yet)
select public.has_pro('00000000-0000-0000-0000-000000000000'::uuid, 'subtitle');  -- expect: false

-- (c) seed one active row, confirm unlock rule (all unlocks subtitle)
insert into public.entitlements (user_id, product, status)
values ('00000000-0000-0000-0000-000000000000','all','active');
select public.has_pro('00000000-0000-0000-0000-000000000000','subtitle');         -- expect: true
select public.has_pro('00000000-0000-0000-0000-000000000000','motionlab');        -- expect: true
delete from public.entitlements where user_id = '00000000-0000-0000-0000-000000000000';
```

Expected: `has_table=true`, function present, (b) `false`, (c) both `true`, cleanup ok.

- [ ] **Step 3: Verify RLS blocks client writes**

In the SQL editor, simulate the `authenticated` role (or use a real logged-in anon-key session in a scratch page):

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
-- read own: allowed (returns 0 rows, no error)
select count(*) from public.entitlements;
-- write: must be denied
insert into public.entitlements (user_id, product, status)
values ('11111111-1111-1111-1111-111111111111','subtitle','active');  -- expect: ERROR: new row violates row-level security policy
reset role;
```

Expected: the `insert` raises an RLS violation. If it succeeds, a write policy leaked in — fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714000001_entitlements.sql
git commit -m "feat(billing): entitlements table, RLS, has_pro()"
```

---

### Task 2: Stripe test-mode products + frontend billing config

**Prerequisite (user-provided):** a Stripe account with **test-mode** secret key set as a Supabase secret, and the publishable test key handy. Until these exist, this task cannot run; the rest of the plan is written against the IDs it produces.

**Files:**
- Create: `scripts/stripe-setup.mjs` (one-off product/price creator, run locally with the Stripe secret in env — never committed with a key)
- Create: `assets/billing-config.js` (public config: publishable key, price IDs, edge base, preview ratio)

**Interfaces:**
- Produces: `BILLING` config object (global via `assets/billing-config.js`): `{ SB_URL, SB_KEY, EDGE_BASE, STRIPE_PK, PRODUCTS: { all:{price}, subtitle:{price}, motionlab:{price} }, SUBTITLE_FREE_PREVIEW_RATIO }`. Consumed by Task 6 and Phases 2–3.

- [ ] **Step 1: Write the one-off Stripe setup script**

Create `scripts/stripe-setup.mjs` (run with `STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs`; it prints the price IDs):

```js
// One-off: creates 3 monthly HKD products in Stripe test mode and prints their price IDs.
// Run: STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.mjs
import Stripe from 'stripe';                        // npm i -g stripe OR npx; not a repo dependency
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PLANS = [
  { key: 'all',       name: 'Kuafuor Pro (All-access)', amount: 7000 },  // HK$70.00 in cents
  { key: 'subtitle',  name: 'Subtitle Pro',             amount: 3000 },  // HK$30.00
  { key: 'motionlab', name: 'Motion Lab Pro',           amount: 5000 },  // HK$50.00
];
for (const p of PLANS) {
  const product = await stripe.products.create({ name: p.name, metadata: { product_key: p.key } });
  const price = await stripe.prices.create({
    product: product.id, currency: 'hkd', unit_amount: p.amount,
    recurring: { interval: 'month' }, metadata: { product_key: p.key },
  });
  console.log(`${p.key}: price=${price.id}  product=${product.id}`);
}
```

Note: HK$30 is above Stripe's HKD minimum (~HK$4), so all three prices are chargeable.

- [ ] **Step 2: Run it and capture the three price IDs**

Run: `STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs`
Expected output (IDs will differ):
```
all: price_1AbcAll…  product=prod_…
subtitle: price_1AbcSub…  product=prod_…
motionlab: price_1AbcMl…  product=prod_…
```
Record the three `price_…` IDs.

- [ ] **Step 3: Write the public billing config**

Create `assets/billing-config.js` (paste the real price IDs + publishable test key; all public):

```js
// PUBLIC config only. No secret keys here, ever.
export const BILLING = {
  SB_URL: 'https://ikzoxrvnpsseyjviawti.supabase.co',
  SB_KEY: 'sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O',
  EDGE_BASE: 'https://ikzoxrvnpsseyjviawti.supabase.co/functions/v1',
  STRIPE_PK: 'pk_test_REPLACE_ME',
  PRODUCTS: {
    all:       { price: 'price_REPLACE_ALL',       label: 'Kuafuor Pro' },
    subtitle:  { price: 'price_REPLACE_SUBTITLE',  label: 'Subtitle Pro' },
    motionlab: { price: 'price_REPLACE_MOTIONLAB', label: 'Motion Lab Pro' },
  },
  SUBTITLE_FREE_PREVIEW_RATIO: 0.1,
};
```

- [ ] **Step 4: Commit (config only; script has no secret in it)**

```bash
git add scripts/stripe-setup.mjs assets/billing-config.js
git commit -m "feat(billing): stripe test products + public billing config"
```

---

### Task 3: Edge Function `stripe-webhook` (the only writer)

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`
- Create: `supabase/functions/_shared/status.ts` (Stripe→entitlement status map, unit-testable)
- Test: `supabase/functions/_shared/status.test.ts`

**Interfaces:**
- Consumes: `entitlements` table + service role (Task 1); `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` secrets.
- Produces: writes entitlement rows. No code interface consumed by other tasks except `mapStripeStatus`.

- [ ] **Step 1: Write the failing test for the status mapper**

Create `supabase/functions/_shared/status.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { mapStripeStatus } from './status.ts';

Deno.test('active stays active', () => assertEquals(mapStripeStatus('active'), 'active'));
Deno.test('canceled maps canceled', () => assertEquals(mapStripeStatus('canceled'), 'canceled'));
Deno.test('dunning/incomplete/paused => past_due (fail-closed)', () => {
  for (const s of ['past_due','unpaid','incomplete','incomplete_expired','paused'])
    assertEquals(mapStripeStatus(s), 'past_due');
});
Deno.test('unknown future status => past_due (fail-closed)', () =>
  assertEquals(mapStripeStatus('some_new_status'), 'past_due'));
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `deno test supabase/functions/_shared/status.test.ts`
Expected: FAIL — `mapStripeStatus` not found.

- [ ] **Step 3: Implement the status mapper**

Create `supabase/functions/_shared/status.ts`:

```ts
export type Entitlement = 'active' | 'past_due' | 'canceled' | 'inactive';
// Never store Stripe's raw status (CHECK only allows the 4 above). Fail-closed to past_due.
export function mapStripeStatus(s: string): Entitlement {
  if (s === 'active') return 'active';
  if (s === 'canceled') return 'canceled';
  return 'past_due'; // past_due, unpaid, incomplete, incomplete_expired, paused, and anything new
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `deno test supabase/functions/_shared/status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the webhook function**

Create `supabase/functions/stripe-webhook/index.ts`:

```ts
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mapStripeStatus } from '../_shared/status.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const WHSEC = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Apply an update only if this event is newer than the last one we applied to the row (ordering guard).
async function applyIfNewer(match: Record<string, string>, eventCreated: number, patch: Record<string, unknown>) {
  const { data: existing } = await db.from('entitlements').select('last_event_at').match(match).maybeSingle();
  const evtAt = new Date(eventCreated * 1000).toISOString();
  if (existing?.last_event_at && existing.last_event_at >= evtAt) return; // stale/out-of-order → ignore
  await db.from('entitlements').update({ ...patch, last_event_at: evtAt, updated_at: new Date().toISOString() }).match(match);
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text(); // RAW body — required for signature verification
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WHSEC);
  } catch (e) {
    return new Response(`bad signature: ${e.message}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      const user_id = s.client_reference_id!;
      const product = s.metadata?.product!;
      const sub = await stripe.subscriptions.retrieve(s.subscription as string); // authoritative snapshot
      await db.from('entitlements').upsert({
        user_id, product,
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
        current_period_end: new Date(fresh.current_period_end * 1000).toISOString(),
      });

    } else if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.subscription) await applyIfNewer({ stripe_subscription_id: inv.subscription as string }, event.created, { status: 'past_due' });

    } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const charge = (event.data.object as Stripe.Charge & { charge?: string });
      const chargeId = event.type === 'charge.dispute.created' ? (event.data.object as Stripe.Dispute).charge as string : (charge as Stripe.Charge).id;
      const ch = await stripe.charges.retrieve(chargeId, { expand: ['invoice'] });
      const subId = (ch.invoice as Stripe.Invoice | null)?.subscription as string | undefined;
      if (subId) await applyIfNewer({ stripe_subscription_id: subId }, event.created, { status: 'canceled' }); // re-lock
    }
    return new Response('ok', { status: 200 }); // always 2xx once safely handled → Stripe stops retrying
  } catch (e) {
    console.error('webhook handler error', event.type, e);
    return new Response(`handler error: ${e.message}`, { status: 500 }); // Stripe will retry
  }
});
```

- [ ] **Step 6: Deploy the webhook (no JWT) and set secrets**

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… --project-ref ikzoxrvnpsseyjviawti
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref ikzoxrvnpsseyjviawti
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically for Edge Functions.)
Then in the Stripe dashboard (test mode) add a webhook endpoint → the deployed function URL, subscribing to: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET` (re-run `secrets set` + redeploy if it changed).

- [ ] **Step 7: Verify signature rejection + a real event locally**

Run the Stripe CLI: `stripe listen --forward-to https://ikzoxrvnpsseyjviawti.supabase.co/functions/v1/stripe-webhook`
- Bad signature: `curl -X POST <url> -d '{}'` → expect HTTP 400 `bad signature`.
- Real event: `stripe trigger checkout.session.completed` → expect HTTP 200 and (after Task 4 provides a real session with metadata) a row in `entitlements`. For this task's isolated check, confirm the 400/200 signature behaviour; the row write is verified end-to-end in Task 7.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts supabase/functions/_shared/status.ts supabase/functions/_shared/status.test.ts
git commit -m "feat(billing): stripe-webhook — verified, sub-id lookup, status map, ordering guard, refund re-lock"
```

---

### Task 4: Edge Function `create-checkout`

**Files:**
- Create: `supabase/functions/create-checkout/index.ts`
- Create: `supabase/functions/_shared/cors.ts`
- Test: `supabase/functions/_shared/cors.test.ts`

**Interfaces:**
- Consumes: `has_pro` RPC (Task 1), `BILLING.PRODUCTS` price IDs (Task 2), secrets.
- Produces: HTTP `POST` → `{ url }` (checkout) or `{ alreadyActive: true, portalUrl }`. Consumed by Task 6 `ent.upgrade()`.

- [ ] **Step 1: Write the failing test for the redirect allow-list**

Create `supabase/functions/_shared/cors.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isAllowedOrigin } from './cors.ts';

Deno.test('allows our origins', () => {
  assertEquals(isAllowedOrigin('https://kuafuorhk.com/subtitle?upgraded=1'), true);
  assertEquals(isAllowedOrigin('https://www.kuafuorhk.com/'), true);
  assertEquals(isAllowedOrigin('http://localhost:8099/'), true);
});
Deno.test('rejects foreign origins (open-redirect guard)', () => {
  assertEquals(isAllowedOrigin('https://evil.example.com/'), false);
  assertEquals(isAllowedOrigin('not-a-url'), false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `deno test supabase/functions/_shared/cors.test.ts`
Expected: FAIL — `isAllowedOrigin` not found.

- [ ] **Step 3: Implement the allow-list + CORS helper**

Create `supabase/functions/_shared/cors.ts`:

```ts
const ALLOWED_HOSTS = ['kuafuorhk.com', 'www.kuafuorhk.com', 'localhost'];
export function isAllowedOrigin(url: string): boolean {
  try { return ALLOWED_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // tighten to the request Origin if desired; only POST+JWT is exposed
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `deno test supabase/functions/_shared/cors.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the create-checkout function**

Create `supabase/functions/create-checkout/index.ts`:

```ts
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const PRICES: Record<string, string> = {
  all: Deno.env.get('PRICE_ALL')!, subtitle: Deno.env.get('PRICE_SUBTITLE')!, motionlab: Deno.env.get('PRICE_MOTIONLAB')!,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authz = req.headers.get('Authorization') ?? '';
    const jwt = authz.replace('Bearer ', '');
    // Resolve the user from their Supabase JWT using the anon client bound to that token.
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authz } },
    });
    const { data: { user } } = await asUser.auth.getUser(jwt);
    if (!user) return json({ error: 'not signed in' }, 401);

    const { product, success_url, cancel_url } = await req.json();
    if (!PRICES[product]) return json({ error: 'bad product' }, 400);
    if (!isAllowedOrigin(success_url) || !isAllowedOrigin(cancel_url)) return json({ error: 'bad redirect' }, 400);

    // Redundant-purchase guard: already covered? send to portal, don't double-charge.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: covered } = await admin.rpc('has_pro', { p_user: user.id, p_product: product });
    if (covered) {
      const { data: row } = await admin.from('entitlements').select('stripe_customer_id')
        .eq('user_id', user.id).not('stripe_customer_id', 'is', null).limit(1).maybeSingle();
      if (row?.stripe_customer_id) {
        const portal = await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: cancel_url });
        return json({ alreadyActive: true, portalUrl: portal.url });
      }
      return json({ alreadyActive: true }); // covered by 'all' with no customer row for this product
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
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 6: Deploy + set the price-ID secrets**

```bash
supabase secrets set PRICE_ALL=price_… PRICE_SUBTITLE=price_… PRICE_MOTIONLAB=price_… --project-ref ikzoxrvnpsseyjviawti
supabase functions deploy create-checkout --project-ref ikzoxrvnpsseyjviawti
```
(JWT verification stays ON — this function requires the user's token.)

- [ ] **Step 7: Smoke-test the auth guard**

Run: `curl -X POST https://…/functions/v1/create-checkout -H 'Content-Type: application/json' -d '{"product":"subtitle","success_url":"https://kuafuorhk.com/","cancel_url":"https://kuafuorhk.com/"}'`
Expected: `401 {"error":"not signed in"}` (no JWT). Full happy-path is Task 7.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/create-checkout/index.ts supabase/functions/_shared/cors.ts supabase/functions/_shared/cors.test.ts
git commit -m "feat(billing): create-checkout — JWT, redundant-purchase guard, subscription metadata, redirect allow-list"
```

---

### Task 5: Edge Function `create-portal`

**Files:**
- Create: `supabase/functions/create-portal/index.ts`

**Interfaces:**
- Consumes: user JWT, `entitlements.stripe_customer_id`, secrets. Produces: `POST` → `{ url }`. Consumed by Task 6 `ent.manage()`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/create-portal/index.ts`:

```ts
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authz = req.headers.get('Authorization') ?? '';
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authz } } });
    const { data: { user } } = await asUser.auth.getUser(authz.replace('Bearer ', ''));
    if (!user) return json({ error: 'not signed in' }, 401);

    const { return_url } = await req.json();
    if (!isAllowedOrigin(return_url)) return json({ error: 'bad return_url' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row } = await admin.from('entitlements').select('stripe_customer_id')
      .eq('user_id', user.id).not('stripe_customer_id', 'is', null).limit(1).maybeSingle();
    if (!row?.stripe_customer_id) return json({ error: 'no customer' }, 404);

    const portal = await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url });
    return json({ url: portal.url });
  } catch (e) {
    console.error('create-portal error', e);
    return json({ error: e.message }, 500);
  }
});
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy create-portal --project-ref ikzoxrvnpsseyjviawti
```

- [ ] **Step 3: Smoke-test the auth guard**

Run: `curl -X POST https://…/functions/v1/create-portal -d '{"return_url":"https://kuafuorhk.com/"}'`
Expected: `401 {"error":"not signed in"}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-portal/index.ts
git commit -m "feat(billing): create-portal — Stripe billing portal session"
```

---

### Task 6: Reusable frontend module `assets/entitlements.js` + paywall

**Files:**
- Create: `assets/entitlements.js`
- Create: `billing-demo/index.html` (a throwaway page that proves the loop; deleted or kept as a manual test harness)

**Interfaces:**
- Consumes: `BILLING` (Task 2), Edge Functions (Tasks 3–5). Produces the global `Entitlements` API used by Phases 2–3:
  - `await Entitlements.init()` → controller `ent`
  - `ent.hasAccess(tool: 'subtitle'|'motionlab') → boolean`
  - `ent.requirePro(tool, feature?: string) → boolean` (opens paywall + returns false if locked)
  - `ent.upgrade(product: 'all'|'subtitle'|'motionlab') → Promise<void>` (login if needed → Checkout)
  - `ent.manage() → Promise<void>` (billing portal)
  - `ent.on('change', cb)` / `ent.isLoggedIn`

- [ ] **Step 1: Write the module**

Create `assets/entitlements.js`:

```js
import { BILLING } from './billing-config.js';

const T = {
  zh: { title:'升級解鎖', sub:(l)=>`解鎖 ${l} 嘅完整功能`, pro:'Pro', login:'先登入先可以升級',
        activating:'正在啟用你嘅訂閱…', wait:'可能要等一兩秒,遲啲 refresh 下', manage:'管理訂閱',
        buyAll:'Kuafuor Pro（解鎖全部）', close:'閂' },
  en: { title:'Upgrade to unlock', sub:(l)=>`Unlock the full ${l}`, pro:'Pro', login:'Please sign in to upgrade',
        activating:'Activating your subscription…', wait:'This can take a moment — refresh shortly', manage:'Manage subscription',
        buyAll:'Kuafuor Pro (unlock everything)', close:'Close' },
};
const lang = () => { try { return (localStorage.getItem('kf-lang')||'zh').startsWith('en') ? 'en' : 'zh'; } catch { return 'zh'; } };
const t = (k, ...a) => { const v = (T[lang()]||T.zh)[k]; return typeof v === 'function' ? v(...a) : v; };

let _sb = null;                        // lazily created supabase client
async function sb() {                  // load Supabase ONLY when needed (keeps free path offline)
  if (_sb) return _sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _sb = createClient(BILLING.SB_URL, BILLING.SB_KEY);
  return _sb;
}

class Ent {
  constructor() { this._ent = {}; this._session = null; this._cbs = []; }
  get isLoggedIn() { return !!this._session; }
  on(_e, cb) { this._cbs.push(cb); }
  _emit() { this._cbs.forEach((c) => c(this)); }

  async _load() {
    // Only touch the network if there is already a session (never forces login on the free path).
    try {
      const client = await sb();
      this._session = (await client.auth.getSession()).data.session;
      if (!this._session) { this._ent = {}; return; }
      const { data } = await client.from('entitlements')
        .select('product,status,current_period_end').eq('user_id', this._session.user.id);
      const now = Date.now();
      this._ent = {};
      for (const r of data || []) {
        const ok = r.status === 'active' && (!r.current_period_end || new Date(r.current_period_end).getTime() > now);
        if (ok) this._ent[r.product] = true;
      }
    } catch (e) { console.warn('entitlements load failed', e); }
  }

  hasAccess(tool) { return !!(this._ent.all || this._ent[tool]); }

  requirePro(tool, feature) { if (this.hasAccess(tool)) return true; this._paywall(tool, feature); return false; }

  async upgrade(product) {
    const client = await sb();
    this._session = (await client.auth.getSession()).data.session;
    if (!this._session) {                                  // free tier is anonymous → send to login, come back here
      const next = location.pathname + location.search;
      location.href = `/login/?next=${encodeURIComponent(next)}`;
      return;
    }
    const token = this._session.access_token;
    const base = location.origin;
    const success_url = `${base}${location.pathname}?upgraded=1`;
    const cancel_url = `${base}${location.pathname}`;
    const res = await fetch(`${BILLING.EDGE_BASE}/create-checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ product, success_url, cancel_url }),
    }).then((r) => r.json());
    if (res.url) location.href = res.url;
    else if (res.portalUrl) location.href = res.portalUrl;
    else if (res.alreadyActive) { await this._load(); this._emit(); }
  }

  async manage() {
    const client = await sb();
    const s = (await client.auth.getSession()).data.session;
    if (!s) return;
    const res = await fetch(`${BILLING.EDGE_BASE}/create-portal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ return_url: location.href }),
    }).then((r) => r.json());
    if (res.url) location.href = res.url;
  }

  // After Checkout redirects back with ?upgraded=1, poll until the webhook has written the row.
  async _handleReturn() {
    const p = new URLSearchParams(location.search);
    if (p.get('upgraded') !== '1') return;
    history.replaceState({}, '', location.pathname);       // clean the URL
    const banner = this._banner(t('activating'));
    for (let i = 0; i < 6; i++) {                          // ~10s of backoff
      await this._load();
      if (Object.keys(this._ent).length) { banner.remove(); this._emit(); return; }
      await new Promise((r) => setTimeout(r, [800, 1200, 1600, 2000, 2400, 3000][i]));
    }
    banner.textContent = t('wait'); setTimeout(() => banner.remove(), 6000); this._emit();
  }

  _banner(msg) {
    const b = document.createElement('div');
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:3000;background:#a83228;color:#fff;font:14px/1.5 "Lora",serif;text-align:center;padding:10px';
    b.textContent = msg; document.body.appendChild(b); return b;
  }

  _paywall(tool, feature) {
    const l = BILLING.PRODUCTS[tool]?.label || tool;
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(32,31,29,.5);font-family:"Lora","Noto Serif TC",serif';
    wrap.innerHTML = `
      <div style="background:#f8f4f4;border:1px solid #d7d3d3;border-radius:6px;max-width:420px;width:calc(100% - 32px);padding:28px 24px;color:#201f1d">
        <div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;margin-bottom:6px">${t('title')}</div>
        <p style="font-size:14px;color:#605d5d;margin:0 0 18px">${t('sub', l)}${feature ? ` · ${feature}` : ''}</p>
        <button data-buy="${tool}" style="width:100%;min-height:46px;margin-bottom:8px;border:1px solid #a83228;background:#a83228;color:#fff;border-radius:4px;font:600 14px 'Cormorant Garamond',serif;cursor:pointer">${l} — HK$${tool==='subtitle'?30:tool==='motionlab'?50:70}/${lang()==='en'?'mo':'月'}</button>
        <button data-buy="all" style="width:100%;min-height:46px;margin-bottom:14px;border:1px solid #a83228;background:transparent;color:#a83228;border-radius:4px;font:600 14px 'Cormorant Garamond',serif;cursor:pointer">${t('buyAll')} — HK$70/${lang()==='en'?'mo':'月'}</button>
        <button data-close style="width:100%;background:none;border:none;color:#605d5d;font-size:13px;cursor:pointer">${t('close')}</button>
      </div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.hasAttribute('data-close')) return close();
      const buy = e.target.getAttribute?.('data-buy'); if (buy) { close(); this.upgrade(buy); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-buy]').focus();
  }
}

export const Entitlements = {
  async init() { const e = new Ent(); await e._load(); await e._handleReturn(); return e; },
};
```

- [ ] **Step 2: Write the demo harness page**

Create `billing-demo/index.html` (proves the loop without touching a real tool):

```html
<!DOCTYPE html><html lang="zh-Hant-HK"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Billing demo</title></head>
<body style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px">
<h1>Billing loop demo</h1>
<p>Access to <b>subtitle</b>: <span id="state">…</span></p>
<button id="unlock">Unlock (requirePro subtitle)</button>
<button id="manage">Manage</button>
<script type="module">
  import { Entitlements } from '/assets/entitlements.js';
  const ent = await Entitlements.init();
  const render = () => document.getElementById('state').textContent = ent.hasAccess('subtitle') ? 'YES (Pro)' : 'no (free)';
  ent.on('change', render); render();
  document.getElementById('unlock').onclick = () => { if (ent.requirePro('subtitle','demo')) alert('already Pro'); };
  document.getElementById('manage').onclick = () => ent.manage();
</script></body></html>
```

- [ ] **Step 3: Verify the free path stays offline / no-login**

Serve locally: `python3 -m http.server 8099`. Open `http://localhost:8099/billing-demo/` in a throwaway browser profile with **no** session. In DevTools ▸ Network, confirm: on load, **no request** to `cdn.jsdelivr.net` or `/entitlements` fires until you click "Unlock". State shows `no (free)`. Clicking "Unlock" opens the paywall.
Expected: zero Supabase/network calls on initial load; paywall appears on click.

- [ ] **Step 4: Commit**

```bash
git add assets/entitlements.js billing-demo/index.html
git commit -m "feat(billing): reusable entitlements.js — lazy load, paywall, upgrade/portal, post-checkout unlock"
```

---

### Task 7: End-to-end verification (Stripe test card) + `.gitignore`

**Files:**
- Modify: `.gitignore` (ignore any local Stripe env files)

**Interfaces:** none produced; this task proves Tasks 1–6 work together.

- [ ] **Step 1: Guard against committing secrets**

Append to `.gitignore`:
```
.env
.env.*
supabase/.env
stripe-*.env
```

- [ ] **Step 2: Run the full pay → webhook → unlock loop in test mode**

With the Stripe CLI forwarding to the webhook (`stripe listen --forward-to <webhook-url>`):
1. Log in on the demo page (magic link via `/login/`) so a session exists.
2. Click "Unlock" → paywall → "Subtitle Pro" → redirected to Stripe Checkout.
3. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC/postal.
4. Stripe redirects back to `…/billing-demo/?upgraded=1`; the red "Activating…" banner shows, then clears.
5. State flips to `YES (Pro)` within ~10s.

Verify the row:
```sql
select user_id, product, status, current_period_end, stripe_subscription_id
from public.entitlements order by updated_at desc limit 3;   -- expect: product=subtitle, status=active
```
Expected: one `active` `subtitle` (or `all`) row for your user; demo shows `YES (Pro)`.

- [ ] **Step 3: Verify cancel re-locks**

`stripe trigger customer.subscription.deleted` (or cancel via `ent.manage()` portal). Re-check:
```sql
select product, status from public.entitlements order by updated_at desc limit 1;  -- expect: status=canceled
```
Reload the demo → state shows `no (free)`.

- [ ] **Step 4: Verify no secrets were committed**

Run: `git log -p | grep -nE 'sk_(test|live)|whsec_|service_role' || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore(billing): ignore local env files; Phase 1 verified end-to-end in Stripe test mode"
```

---

## Self-Review

**Spec coverage:** §5 data model → Task 1. §6.1 create-checkout (redundant guard, subscription metadata) → Task 4. §6.2 webhook (sub-id lookup, status map, ordering guard, refund re-lock) → Task 3. §6.3 portal → Task 5. §7 entitlements.js (lazy load, paywall, refresh-after-checkout) → Task 6. §9 security (secrets, RLS, allow-list) → Tasks 1/3/4/7. §16 blocker + majors → Tasks 3/4. Phases 2–3 (tool wiring) are separate plans, as designed.

**Type consistency:** `mapStripeStatus` (Task 3) used only in Task 3. `isAllowedOrigin`/`corsHeaders` (Task 4 `_shared/cors.ts`) reused in Task 5. `has_pro(p_user, p_product)` signature (Task 1) matches the RPC call in Task 4. `Entitlements.init()`/`hasAccess`/`requirePro`/`upgrade`/`manage` (Task 6) match the interfaces Phases 2–3 will consume. `?upgraded=1` return flag consistent between Task 6 `upgrade()` and `_handleReturn()`.

**Placeholder scan:** the only intentional fill-ins are the user-supplied Stripe values (`pk_test_REPLACE_ME`, `price_REPLACE_*`) in `billing-config.js` and the Stripe/webhook secrets — these are external credentials, documented in Task 2/3, not plan gaps.

## Execution Handoff

Execution is **blocked on the user providing a Stripe account** (test keys + webhook secret + the three price IDs from Task 2). Once those exist, this plan runs top-to-bottom in Stripe test mode. Phases 2 (轉字幕) and 3 (Motion Lab) get their own plans that consume the `Entitlements` API from Task 6.
