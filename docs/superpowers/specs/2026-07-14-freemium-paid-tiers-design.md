# Freemium + Stripe self-serve paid tiers — Design Spec

- **Date:** 2026-07-14
- **Status:** Approved shape · hardened by a 5-dimension adversarial review (see §16) · pending written-spec review
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
| **轉字幕** (`subtitle`) | run the transcription; **preview only ~10% of the transcript** (a teaser); **no export, no full text** | **full transcript** view + copy; **export `.txt` / `.srt` / `.vtt`**; turbo model; advanced settings; long files |
| **Motion Lab** (`motionlab`) | local analysis; **1 saved athlete + up to 3 saved sessions**; basic score | unlimited athletes / sessions; **cloud sync**; detailed reports; **PDF / CSV export**; highlight reels |

Notes:
- The exact free-tier Motion Lab quota (1 athlete / 3 sessions) is a starting value, adjustable in config.
- **轉字幕 model (user decision):** the free tier lets a user *run* a transcription but reveals only
  a **~10% preview** of the result — the paywall is on **seeing the full transcript and any export**
  (`.txt`/`.srt`/`.vtt`). This proves the tool works, then gates the whole payoff. The 10% fraction
  is config (`SUBTITLE_FREE_PREVIEW_RATIO`).
- **Honesty caveat (must stay explicit):** 轉字幕 runs 100% in the browser, so the withheld 90% is
  computed **client-side** and lives in JS memory — a devtools-savvy user can recover it. The 10%
  teaser deters casual users; it is not a hard wall. Truly withholding the full text would require
  server-side transcription, which breaks the "runs locally / free / private" promise and adds cost —
  **out of scope**. We ship the client-side teaser and say so plainly (§9).

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
                           check (status in ('active','past_due','canceled','inactive')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  last_event_at          timestamptz,      -- Stripe event.created of the last applied event (ordering guard, §6.2)
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  unique (user_id, product)
);
create unique index entitlements_stripe_sub_idx
  on public.entitlements (stripe_subscription_id) where stripe_subscription_id is not null;
alter table public.entitlements enable row level security;
```

> **Design note (review finding — status enum):** `'trialing'` was removed — this is freemium
> with no time-boxed trial, so a `trialing` state would be dead/ambiguous. Only
> `active/past_due/canceled/inactive` are reachable.

> **Design note (review finding — dual lookup keys):** lifecycle webhooks (`subscription.updated/
> deleted`, `invoice.*`) do **not** carry the Checkout Session's `client_reference_id`/`metadata`,
> so they cannot be matched by `(user_id, product)`. We therefore also index
> `stripe_subscription_id` uniquely and let those handlers locate the row by subscription id.
> `checkout.session.completed` (which *does* carry `client_reference_id`+`metadata.product`) is the
> only event that can create a new row keyed by `(user_id, product)`. See §6.

> **Design note (review finding — 'all' + per-tool coexistence):** the schema *permits* a user to
> hold both an `all` row and a per-tool row (unique is on the pair). The unlock rule already handles
> this (either grants access). To avoid **redundant double-billing**, `create-checkout` refuses to
> start a checkout for a product the user is already covered for (see §6.1), and points them at the
> billing portal to switch instead.

**RLS policies:**
- `select`: `auth.uid() = user_id` (a user reads only their own entitlements).
- **No** insert/update/delete policy for `authenticated` / `anon` → clients can never write
  (RLS is default-deny, so the absence of a write policy is what blocks writes).
- The webhook uses the **service role key** (bypasses RLS) to upsert.
- **Premium *data* is gated in its own table's RLS too, not just the UI:** Motion Lab's
  premium-only rows/columns (cloud-synced sessions beyond the free quota, detailed-report data)
  are protected by policies that call `public.has_pro(auth.uid(),'motionlab')`, so a locked user
  cannot read/write them via a direct Supabase query (see §8.2). Purely-local premium (轉字幕) has
  no server data to protect (§9).

**Helper** (used by RLS-adjacent checks and server data limits):
```sql
create or replace function public.has_pro(p_user uuid, p_product text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and e.product in ('all', p_product)
      and e.status = 'active'
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
- **Input:** `{ product: 'all'|'subtitle'|'motionlab', success_url, cancel_url }` (monthly is implied).
- **Behaviour:**
  1. Resolve the user from the JWT.
  2. **Redundant-purchase guard:** if `has_pro(user, product)` is already true (an `all` sub covers
     everything), do **not** open a new checkout — return `{ alreadyActive: true, portalUrl }` so the
     frontend sends them to the billing portal instead of double-charging.
  3. Find-or-create a Stripe Customer keyed by `user.id` (store `stripe_customer_id`; also set Stripe
     customer `metadata.user_id` so any customer-scoped event is traceable).
  4. Create a **subscription-mode** Checkout Session for the product's monthly price, with
     `client_reference_id = user.id`, `metadata.product`, **and — critically —
     `subscription_data.metadata = { user_id, product }`** so the *Subscription* object (hence every
     later lifecycle/invoice event) carries the mapping. (Session `client_reference_id`/`metadata`
     are NOT copied onto the Subscription; without this, renewals/cancels can't find their row — see
     the blocker in §6.2.)
  5. Return `{ url }`; frontend redirects.
- **Guards:** validate `product`; validate `success_url`/`cancel_url` against an allow-list of
  our own origins (prevents open-redirect); CORS locked to our origins.

### 6.2 `stripe-webhook`
- **Auth:** Stripe signature verification with `STRIPE_WEBHOOK_SECRET` over the **raw** request body.
  Reject on bad signature. This is the **only** writer of `entitlements`. Uses the **service role**.
- **Row lookup (blocker fix):**
  - `checkout.session.completed` carries `client_reference_id` (user) + `metadata.product` → this is
    the **only** event that may *create* a row, keyed by `(user_id, product)`.
  - All other events (`customer.subscription.updated/deleted`, `invoice.payment_failed`) carry only
    the **subscription id** (+ our `subscription_data.metadata` from §6.1). They locate the row by the
    unique `stripe_subscription_id` index. If no row is found (e.g. events raced ahead of checkout),
    fall back to `subscription.metadata.{user_id,product}` to upsert.
- **Status mapping (constraint-safety fix):** never store the raw Stripe status. Map it:
  | Stripe subscription status | entitlement `status` |
  |---|---|
  | `active` | `active` |
  | `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `paused` | `past_due` |
  | `canceled` | `canceled` |
  A status Stripe adds in future defaults to `past_due` (fail-closed), never a CHECK violation.
- **Ordering guard (out-of-order-delivery fix):** Stripe does not guarantee delivery order and
  retries for ~3 days. Each handler compares the incoming `event.created` to the row's stored
  `last_event_at` and **ignores older events**; on apply it writes `last_event_at`. For the
  authoritative fields (`status`, `current_period_end`) the handler **re-fetches the subscription
  from Stripe** and writes that snapshot rather than trusting a possibly-stale event payload.
- **Events handled:**
  - `checkout.session.completed` → create/activate row; set customer/subscription id + `period_end`.
  - `customer.subscription.updated` → re-fetch sub → map status + `current_period_end`.
  - `customer.subscription.deleted` → `status='canceled'`.
  - `invoice.payment_failed` → `status='past_due'`.
  - **`charge.refunded` / `charge.dispute.created` (re-lock fix)** → resolve the subscription/customer
    → set `status='canceled'` (revoke Pro) and log for manual follow-up. A refunded/disputed user
    must lose access.
- **Idempotency:** upsert keyed as above + the ordering guard; duplicate **and** out-of-order
  re-delivery are both safe. Optionally persist processed `event.id`s for exact-dedup.
- Always returns 2xx once the event is safely processed (or safely ignored) so Stripe stops retrying.

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
  Modal is accessible: focus-trap, `Esc` to close, `aria-modal`, returns focus on close.
- Bilingual (zh/en) via the same `kf-lang` localStorage key as the rest of the site.
- Config object: `{ SB_URL, SB_KEY, EDGE_BASE, STRIPE_PUBLISHABLE_KEY, PRODUCTS: { all:{price:'price_…'}, subtitle:{…}, motionlab:{…} } }`.
- **Lazy Supabase load (offline/no-login fix):** the free path must not require Supabase. The
  Supabase client + entitlements fetch are loaded **only** when the user logs in or clicks upgrade,
  so 轉字幕's free tier keeps working offline with no network/login (its "runs locally" promise).
- **Refresh-after-Checkout (webhook-lag fix):** the webhook may land a second or two after Stripe
  redirects back. `success_url` returns to the originating tool with a `?upgraded=1` flag;
  `entitlements.js` then polls `has_pro` with short backoff (a few tries over ~10s), shows a brief
  "activating your subscription…" state, and unlocks the UI the moment it flips — no manual refresh.
  If it doesn't flip in time, show "it can take a moment; refresh shortly" rather than a hard error.

**To gate a future tool:** add a Stripe product + price, add the product key to the enum
migration and `PRODUCTS` config, then in the tool call `ent.requirePro('<tool>', '<feature>')`
around premium actions. No new backend code.

## 8. Per-tool integration

### 8.1 轉字幕 (`cantonese-subtitle`)
- Load `entitlements.js` lazily (§7); the base transcription flow stays **login-free and offline**.
- After a free transcription finishes, render only the **first ~10% of segments**
  (`SUBTITLE_FREE_PREVIEW_RATIO`), then a paywall card over the remainder
  ("睇全文 / 匯出字幕 → 升級 Subtitle Pro 或 Kuafuor Pro").
- `ent.requirePro('subtitle', …)` gates: **full-transcript reveal**, **copy**, and **all exports**
  (`.txt` / `.srt` / `.vtt`), plus the **turbo model** and **advanced settings**.
- Unlocked (Subtitle Pro or All-access) → full transcript + every export button live.
- Enforcement is **client-side** (the tool runs 100% locally) — see §9 and the §3 honesty caveat;
  the withheld 90% exists in JS memory and is not a hard wall.

### 8.2 Motion Lab (`motion-lab`)
- Reuse Motion Lab's existing magic-link auth + Supabase session; init `entitlements.js` with it.
- Gate **cloud sync**, **unlimited athletes/sessions** (free = 1 athlete / 3 sessions),
  **PDF/CSV export**, **detailed reports**, **highlight reels**.
- **Server-enforced quota (concrete mechanism):** a `before insert` trigger on `athletes` /
  `training_sessions` runs (as `security definer`) `if not has_pro(new.owner,'motionlab') and
  (count of caller's existing rows) >= <free limit> then raise exception`. The UI-side check is
  courtesy only; the trigger is the real guard. Premium-only *reads* (detailed-report columns,
  synced rows beyond the free quota) are protected by RLS policies that call `has_pro`, so a free
  user can't pull locked data via a direct query.
- **Downgrade / over-quota grandfathering (review finding):** when a Motion Lab Pro user cancels
  while holding more than the free quota, we **never delete their data**. Existing rows stay
  **readable** (grandfathered); the quota trigger only blocks *new* inserts beyond the free limit
  until they re-subscribe. Export/report/sync premium actions re-lock immediately. This is the
  humane, data-safe behaviour and must be explicit in the UI ("你嘅資料仲喺度,升級返可以再新增/同步").

## 9. Security & honesty

- Stripe **secret** + **webhook** keys live only in Supabase Function secrets; repo holds only
  the **publishable** key + price IDs (public by design).
- `entitlements` is written only by the signature-verified webhook via service role; **RLS blocks
  all client writes** → users can't forge Pro.
- **轉字幕 is 100% local** → the full transcript (including the withheld 90% behind the 10% preview)
  is computed in the browser and sits in JS memory, so the gate is **client-side and bypassable via
  devtools**. This is inherent to a local tool; the teaser + export paywall monetises convenience and
  deters casual users. We accept it and do **not** pretend otherwise (see §3 caveat). Anything backed
  by server data (Motion Lab cloud features, quotas) **is** server-enforced via `has_pro`.
- Checkout/portal Edge Functions validate JWT, product, and redirect URLs (allow-list); CORS locked
  to our origins.
- **Refunds/disputes auto-revoke:** `charge.refunded` / `charge.dispute.created` flip the entitlement
  to `canceled` (§6.2), so a refunded user loses Pro without manual work.
- **PDPO / privacy:** we store Stripe **customer/subscription ids** (identifiers only — **card data
  never touches us**, Stripe holds it). This is disclosed in the site privacy note; deleting a user
  cascades their `entitlements` rows (`on delete cascade`), and their Stripe customer can be deleted
  on request. Card payments are PCI-handled entirely by Stripe Checkout (hosted).

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

## 16. Review-hardening changelog

This spec was reviewed by 5 parallel adversarial reviewers (Stripe/payments, Supabase/RLS,
freemium-enforcement, reuse/API-UX, completeness) with each finding verified before folding in.
Confirmed issues addressed:

1. **[blocker] Lifecycle events couldn't find their row.** Checkout Session `client_reference_id`/
   `metadata` are not copied onto the Subscription, so `subscription.updated/deleted`+`invoice.*`
   had no `(user_id,product)` to match. → §6.1 now sets `subscription_data.metadata`; §5 adds a
   unique `stripe_subscription_id` index; §6.2 looks lifecycle events up by subscription id.
2. **[major] Out-of-order webhook delivery** could re-grant a canceled sub or lock out a payer.
   → §6.2 adds a `last_event_at` freshness guard + authoritative re-fetch of the subscription.
3. **[major] Raw Stripe status → CHECK violation** (`incomplete/unpaid/paused/…`) → retry storm.
   → §6.2 adds an explicit Stripe→entitlement status map, fail-closed to `past_due`.
4. **[major] `all` + per-tool coexistence → double billing.** → §6.1 redundant-purchase guard
   (send already-covered users to the portal); §5 note clarifies the unlock rule handles coexistence.
5. **[major] Locked Motion Lab data readable via direct query.** → §5/§8.2 gate premium reads with
   `has_pro` RLS policies, not just the UI.
6. **[major] Free-quota enforcement was vague.** → §8.2 specifies a `before insert` trigger.
7. **[major] Subtitle tool would lose its offline/no-login promise.** → §7 lazy-loads Supabase only
   on login/upgrade; free path stays offline.
8. **[major] No unlock after returning from Checkout** (webhook lag). → §7 poll-with-backoff on
   `?upgraded=1` return, with an "activating…" state.
9. **[minor] Refunds/disputes didn't re-lock.** → §6.2 handles `charge.refunded`/`dispute.created`.
10. **[minor] Dead `trialing` status** (no trial exists). → removed from the enum + `has_pro`.
11. **[minor] Over-quota-after-downgrade undefined.** → §8.2 grandfathers data read-only, blocks only
    new inserts.
12. **[minor] PDPO of stored Stripe ids / card handling.** → §9 disclosure; cards never touch us.

Remaining review notes deferred by choice (YAGNI for v1): conversion analytics, a bespoke receipt
email (Stripe sends its own receipt), and annual/team plans.
