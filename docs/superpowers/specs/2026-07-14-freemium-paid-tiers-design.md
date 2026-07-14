# Freemium + Stripe self-serve paid tiers — Design Spec

- **Date:** 2026-07-14
- **Status:** Approved shape (pending written-spec review)
- **Owner:** Kuafuor HK (mingcheng@kuafuorhk.com)
- **Repo:** kuafuro/kaufuorhk-website (static site, GitHub Pages, CNAME kuafuorhk.com)
- **Supabase project:** `kuafuor-motion-lab` (`ikzoxrvnpsseyjviawti`)

## 1. Goal & scope

Add a **reusable freemium + self-serve paid** layer to the side-project tools so users
can use base features free (no login) and unlock premium features by paying via
**Stripe Checkout** (instant, automatic unlock).

**In scope (this spec):**
- A reusable entitlement mechanism usable by any current or future tool.
- Two tools wired up: **轉字幕 (cantonese-subtitle)** and **Motion Lab (motion-lab)**.

**Out of scope:**
- `split-calculator` (internal coach/admin tool, not sold).
- Any change to the marketing homepage, `/stats`, or the existing `guard.js` role gate
  (role and entitlement are separate concerns; see §10).
- Redesigning Motion Lab's own auth (we reuse it).

## 2. Product & pricing model

Customer can buy **either** an all-access bundle **or** a single-tool subscription.
**Monthly only.** Prices are the source values; the implementation reads them from config
(and from Stripe), never hard-codes amounts in logic.

| Stripe product | `product` key | Price (HK$/mo) | Unlocks |
|---|---|---|---|
| Kuafuor Pro (All-access) | `all` | **70** | every premium tool |
| Subtitle Pro | `subtitle` | **30** | 轉字幕 premium |
| Motion Lab Pro | `motionlab` | **50** | Motion Lab premium |

**Unlock rule:** a tool `T` is unlocked for a user iff there exists an active entitlement
with `product = 'all'` **or** `product = T`.

Billing currency: **HKD**. Each product has one recurring monthly Stripe Price.

## 3. Free vs premium feature split

Base (free) tiers stay usable **without login**. Premium requires login + active entitlement.

| Tool | Free (no login) | Premium (paid) |
|---|---|---|
| **轉字幕** (`subtitle`) | base Whisper model; view / copy transcript; download **`.txt`** | **turbo** model; export **`.srt` / `.vtt`**; advanced settings; long-file handling |
| **Motion Lab** (`motionlab`) | local analysis; **1 saved athlete + up to 3 saved sessions**; basic score | unlimited athletes / sessions; **cloud sync**; detailed reports; **PDF / CSV export**; highlight reels |

Notes:
- The exact free-tier Motion Lab quota (1 athlete / 3 sessions) is a starting value, adjustable in config.
- 轉字幕's premium value is the **subtitle-format export** (`.srt`/`.vtt`) + turbo model.

## 4. Architecture

Static frontend has no server, so all privileged logic lives in **Supabase Edge Functions**
(Deno serverless). Stripe hosts Checkout and the billing portal. A single **`entitlements`**
table is the source of truth, written **only** by the webhook (service role).

```
 Tool frontend (static, GH Pages)
   │  ① click "Upgrade"  (Supabase user JWT)
   ▼
 Edge: create-checkout ──creates/loads Stripe customer, creates Checkout Session──▶ Stripe Checkout (hosted)
                                                                                        │ ② user pays
 Stripe ──③ webhook event (signed)──▶ Edge: stripe-webhook ──verify sig, upsert──▶ Supabase: entitlements
                                                                                        ▲
 Tool frontend ──④ read own entitlements (RLS: self read-only)──────────────────────────┘
   │  ⑤ unlock premium features in the UI
   ▼
 Edge: create-portal ──Stripe Billing Portal session──▶ user manages / cancels
```

Why not the alternatives (rejected):
- **Query Stripe on every page load** for status: extra latency + Stripe rate limits + fragile. No.
- **Store plan in `profiles.role`**: conflates identity/role with billing, and can't express
  "all-access OR per-tool" cleanly for multiple products. No.

## 5. Data model

New table `public.entitlements`:

```sql
create table public.entitlements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  product                text not null check (product in ('all','subtitle','motionlab')),
  status                 text not null default 'inactive'
                           check (status in ('active','trialing','past_due','canceled','inactive')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  unique (user_id, product)
);
alter table public.entitlements enable row level security;
```

**RLS policies:**
- `select`: `auth.uid() = user_id` (a user reads only their own entitlements).
- **No** insert/update/delete policy for `authenticated` / `anon` → clients can never write.
- The webhook uses the **service role key** (bypasses RLS) to upsert.

**Helper** (used by RLS-adjacent checks and server data limits):
```sql
create or replace function public.has_pro(p_user uuid, p_product text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and e.product in ('all', p_product)
      and e.status in ('active','trialing')
      and (e.current_period_end is null or e.current_period_end > now())
  );
$$;
```

`product` is an open enum by convention; adding a future tool = add its key to the
check constraint (migration) + Stripe product. `('all', p_product)` keeps the unlock rule reusable.

## 6. Edge Functions (Deno)

All three deployed to the `kuafuor-motion-lab` Supabase project. Secrets set as Supabase
Function secrets, **never in the repo**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. Publishable Stripe key + price IDs are public config.

### 6.1 `create-checkout`
- **Auth:** requires the caller's Supabase JWT (from the logged-in session); reject if absent.
- **Input:** `{ product: 'all'|'subtitle'|'motionlab', period: 'monthly', success_url, cancel_url }`.
- **Behaviour:**
  1. Resolve the user from the JWT.
  2. Find-or-create a Stripe Customer keyed by `user.id` (store `stripe_customer_id` on first use).
  3. Create a **subscription-mode** Checkout Session for the product's monthly price,
     with `client_reference_id = user.id` and `metadata.product`.
  4. Return `{ url }`; frontend redirects.
- **Guards:** validate `product`; validate `success_url`/`cancel_url` against an allow-list of
  our own origins (prevents open-redirect); CORS locked to our origins.

### 6.2 `stripe-webhook`
- **Auth:** Stripe signature verification with `STRIPE_WEBHOOK_SECRET` (raw body). Reject on
  bad signature. This is the **only** writer of `entitlements`.
- **Events handled:**
  - `checkout.session.completed` → read `client_reference_id` (user), `metadata.product`,
    subscription id → upsert entitlement `status='active'`, set customer/subscription/period_end.
  - `customer.subscription.updated` → sync `status` + `current_period_end`.
  - `customer.subscription.deleted` → `status='canceled'`.
  - (`invoice.payment_failed` → `status='past_due'`.)
- **Idempotency:** upsert on `(user_id, product)`; safe to receive duplicate events.
- Uses the **service role** client to write.

### 6.3 `create-portal`
- **Auth:** Supabase JWT.
- Creates a Stripe Billing Portal session for the user's customer → returns `{ url }` so the
  user can update card / cancel. Cancel flows back through the webhook.

## 7. Reusable frontend module — `assets/entitlements.js`

One shared module (sibling to `guard.js`) any tool imports. Uses the existing Supabase
publishable client + session.

```js
const ent = await Entitlements.init(supabaseClient);   // reads session + own entitlements (if logged in)
ent.hasAccess('subtitle')            // → boolean (all-access OR subtitle active)
ent.requirePro('subtitle', 'srt')    // → true if unlocked; else opens the paywall modal, returns false
ent.upgrade('all' | 'subtitle' | 'motionlab')   // → login if needed, then redirect to Checkout
ent.manage()                         // → open Stripe billing portal
ent.on('change', cb)                 // re-render when entitlement/session changes
```

- Ships a small, on-brand (editorial identity) **paywall modal** + "Pro" badges, reused everywhere.
- Bilingual (zh/en) via the same `kf-lang` localStorage key as the rest of the site.
- Config object: `{ SB_URL, SB_KEY, EDGE_BASE, STRIPE_PUBLISHABLE_KEY, PRODUCTS: { all:{price:'price_…'}, subtitle:{…}, motionlab:{…} } }`.

**To gate a future tool:** add a Stripe product + price, add the product key to the enum
migration and `PRODUCTS` config, then in the tool call `ent.requirePro('<tool>', '<feature>')`
around premium actions. No new backend code.

## 8. Per-tool integration

### 8.1 轉字幕 (`cantonese-subtitle`)
- Load `entitlements.js`. Base flow unchanged and login-free.
- Gate the **turbo model option**, **`.srt` / `.vtt` download** buttons, and **advanced settings**
  behind `ent.requirePro('subtitle', …)`; free `.txt` download stays open.
- Locked controls show a "Pro" badge; clicking opens the paywall (upgrade to Subtitle Pro or All-access).
- Enforcement is **client-side** (the tool runs 100% locally) — see §9.

### 8.2 Motion Lab (`motion-lab`)
- Reuse Motion Lab's existing magic-link auth + Supabase session; init `entitlements.js` with it.
- Gate **cloud sync**, **unlimited athletes/sessions** (free = 1 athlete / 3 sessions),
  **PDF/CSV export**, **detailed reports**, **highlight reels**.
- **Server-enforced limits:** the free athlete/session quota is enforced in Postgres
  (RLS/policy or a `before insert` trigger calling `has_pro`), not only in the UI, because this
  data lives in Supabase (`athletes`, `training_sessions`). Premium-only cloud writes check `has_pro`.

## 9. Security & honesty

- Stripe **secret** + **webhook** keys live only in Supabase Function secrets; repo holds only
  the **publishable** key + price IDs (public by design).
- `entitlements` is written only by the signature-verified webhook via service role; **RLS blocks
  all client writes** → users can't forge Pro.
- **轉字幕 is 100% local** → client-side gating is bypassable via devtools. This is inherent to a
  local tool; freemium here monetises convenience and deters casual users. We accept it and do **not**
  pretend otherwise. Anything backed by server data (Motion Lab cloud features, quotas) **is**
  server-enforced via `has_pro`.
- Checkout/portal Edge Functions validate JWT, product, and redirect URLs (allow-list); CORS locked
  to our origins.

## 10. Relationship to existing `guard.js` / roles

`profiles.role` (member/student/coach/admin) stays **untouched** — it's *identity/role* (e.g. gating
the internal calculator to coaches). `entitlements` is *billing access*. They are orthogonal and
composable (a coach may or may not have Pro). No change to `guard.js` in this work.

## 11. What the user (Kuafuor) provides

1. **Stripe account** (HK Stripe is supported) with:
   - Test + live **API keys** and a **webhook signing secret**.
   - 3 products, each one **monthly HKD price**: All-access (70), Subtitle Pro (30), Motion Lab Pro (50).
     (Can be created via API during implementation once keys exist, or by hand in the dashboard.)
2. Setting the Edge Function **secrets** in Supabase (or authorising us to, without committing them).

Everything else (table, RLS, functions, frontend module, tool wiring) is built by us. Until real
Stripe keys are in place, we develop/verify against **Stripe test mode**.

## 12. Phasing

- **Phase 1 — core mechanism:** `entitlements` table + RLS + `has_pro`; `create-checkout`,
  `stripe-webhook`, `create-portal`; Stripe 3 products (test mode); `assets/entitlements.js` +
  paywall modal + config. Verifiable end-to-end with a Stripe test card.
- **Phase 2 — 轉字幕:** wire premium gates (turbo, `.srt`/`.vtt`, advanced). Smallest, pure-frontend.
- **Phase 3 — Motion Lab:** wire premium gates + **server-enforced** free quota + cloud/export gating.

## 13. Testing / verification

- Stripe **test mode** + test cards for the full pay→webhook→unlock loop.
- Webhook: verify signature rejection; verify idempotent re-delivery; verify each event → correct status.
- RLS: confirm a logged-in user can read only their own rows and **cannot** insert/update entitlements.
- Motion Lab quota: confirm free user blocked from the 2nd athlete / 4th session at the **DB** layer.
- 轉字幕: confirm locked controls gated and paywall opens; free `.txt` stays open.
- Both tools: zh/en paywall copy; no horizontal overflow; keyboard/focus on the modal.

## 14. Open items / assumptions

- Motion Lab free quota (1 athlete / 3 sessions) is an initial guess — confirm during Phase 3.
- No annual plan, no per-seat/team billing (YAGNI; monthly single-user only).
- `EDGE_BASE` = the Supabase Functions URL for the `kuafuor-motion-lab` project.

## 15. Related (not in this spec)

`contact_requests.service` CHECK allows only `consulting/motionlab/other`, but the homepage form now
also sends `data` (data-analysis enquiries) → those inserts currently fail. Tracked separately from
this billing work; worth a one-line migration to add `'data'` to the constraint.
