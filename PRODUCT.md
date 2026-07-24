# Kuafuor HK — PRODUCT.md

## Project overview (專案概覽)

**Kuafuor HK** (`kuafuorhk.com`) is one bilingual (Cantonese-first 廣東話 + English) product surface that
does two jobs at once: it **markets** a Hong Kong process-automation and data-analysis consultancy, and it
**runs** a kickboxing class business (booking, attendance, pack balances, WhatsApp reminders, coach revenue
split). There is **no frontend build step** — each route is a self-contained `index.html` on GitHub Pages,
talking to a **live hosted Supabase** project (publishable key in `assets/*.js` and `login/`).

### Architecture (high level)

```
Browser (static HTML/JS on GitHub Pages)
    ├── Supabase Auth + Postgres (RLS/RPC) — profiles, booking, entitlements, transcripts, contact_requests
    ├── Supabase Edge Functions (Deno) — Stripe, transcribe/pose jobs, Gemini fuse, audio sweep
    ├── Modal GPU — sensevoice/, whisper/, motionlab-cloud/ (CI via .github/workflows/modal-deploy.yml)
    └── Railway — whatsapp-bot/ (WhatsApp Cloud API booking + reminders; see whatsapp-bot/README.md)
```

Client-side `assets/guard.js` on coach/admin tools is **convenience only**; privileges are enforced in
Postgres RLS and SECURITY DEFINER RPCs (see `docs/superpowers/specs/`).

### Site map (main routes)

| Path | Audience | Notes |
|---|---|---|
| `/` | Public | Homepage — automation + data positioning, contact form → `contact_requests` |
| `stats/`, `data-insights/` (+ `en/`) | Public | Statistical essays / proof content |
| `notes/` | Public | Obsidian-style notes graph linking site content |
| `cantonese-subtitle/` | Public (+ tiers) | Local + cloud transcription; Pro/Max quotas |
| `motion-lab/`, `motion-lab/posture/` | Public | Motion analysis showcase; cloud features gated in-app |
| `login/` | All users | Supabase auth, subscriptions, admin user/class-pack tools |
| `schedule/` | student, coach, admin | Class booking — guard + `book_slot` RPC |
| `split-calculator/` | coach, admin | Partnership revenue split (Rev.3 agreement) |
| `billing-demo/`, `agent-dashboard/` | admin (demo) | Internal demos; auth-gated |
| `assets/guard.js` | — | Shared role gate (`data-roles` on `<script>`) |

Nav visibility also depends on role (e.g. 排堂報名, 分成計數機 in homepage hamburger).

### Users & permissions (three axes)

Documented in `docs/superpowers/specs/2026-07-16-user-tiers-design.md`:

1. **Role** (`profiles.role`) — member / student / coach (菁英) / admin (Holder) / developer — set by Holder via RPC.
2. **Plan** (Stripe → `entitlements`) — free / Pro HK$70 / Max HK$120 — subtitles and cloud quotas.
3. **Class pack level** (`class_packages`) — 新星 4堂 / 挑戰者 8堂 / 苦行僧 1-on-1 — bought offline, recorded by staff.

Coaches and Holder cannot self-book as students; Holder can cancel whole slots; students get WhatsApp reminders via the bot when configured.

### Backend inventory (where logic lives)

| Area | Location |
|---|---|
| SQL migrations | `supabase/migrations/`, `db/migrations/` (apply on hosted Supabase) |
| Edge functions | `supabase/functions/*` — checkout, portal, stripe-webhook, transcribe-fast/callback, pose-fast/callback, gemini-fuse, sweep-audio, ci-config, setup-billing |
| Shared frontend | `assets/entitlements.js`, `assets/billing-config.js` |
| Booking bot | `whatsapp-bot/` — `npm test` (25 tests) |
| GPU ASR / pose | `sensevoice/`, `whisper/`, `motionlab-cloud/` — Modal apps, not needed for static site dev |
| Local subtitle R&D | `local-test/` — heavy Python deps, Mac-oriented |

### Agent / contributor pointers

- **Visual & UX law:** `DESIGN.md` (Classical 書卷編輯風 tokens, components, motion rules).
- **Approved behaviour specs:** `docs/superpowers/specs/`; implementation plans in `docs/superpowers/plans/`.
- **Cloud Agent workflow & commands:** `AGENTS.md` (repo map, Superpowers skills, verification).
- **Copy:** zh strings are Cantonese in each page's I18N object; `localStorage` key `kf-lang` (`zh` \| `en`).

### Deployment & secrets

- **Site:** push to `main` → GitHub Pages (`CNAME`, `.nojekyll`).
- **Modal:** path-filtered workflow on `main` for GPU folders.
- **Secrets:** never commit `.env` or service-role keys; Stripe/Gemini/WhatsApp via Supabase Vault or Cloud Agent secrets for E2E tests.

---

## Register

`brand` — the homepage, notes, articles and graph are the primary surface: an editorial
marketing site where the design IS the pitch (a data/automation consultancy that looks like
a well-set book proves its own claim to rigour). Tool pages (`login/`, `schedule/`,
`split-calculator/`, `cantonese-subtitle/`, `motion-lab/`, `motion-lab/posture/`) run in the **product** register:
same visual dialect, utility-first. Motion Lab's video stage and canvas overlays keep their
own high-contrast palette (drawn over video frames), but its page chrome follows the site
system.

## Platform

`web` — multi-page static site (GitHub Pages + Supabase backend). No build step; each page
is a self-contained HTML file. Mobile web matters: students book classes from phones.

## Users

1. **企業客戶** — Hong Kong SME owners/managers evaluating process automation (customer-service
   automation, automated reporting, approval workflows) and data analysis. Bilingual, skim in
   Cantonese first.
2. **踢拳學員** — kickboxing students (Holder 免費會員起步): book classes, watch their 堂數
   balance (新星 4堂 / 挑戰者 8堂 / 苦行僧 1-on-1), get WhatsApp reminders.
3. **教練／主理人** — 菁英 (coach, e.g. Tom) and Holder (owner, Ming): open/cancel slots,
   roll-call, record class packs, split revenue per the partnership agreement Rev.3.
4. **工具用戶** — anyone using the free tools (Cantonese subtitles) with Pro/Max paid tiers.

## Purpose

One site that both **markets** the consultancy (企業流程自動化 × 數據分析, with Motion Lab
and the subtitle tool as live proof of automation capability) and **runs** the kickboxing
class business end-to-end (booking → attendance → pack deduction → WhatsApp notices →
revenue split).

## Positioning

"由策略到落地" — a Hong Kong studio that shows rather than tells: the statistical essays,
the notes graph and the working tools are the portfolio. Cantonese-first (廣東話 voice, not
translated Mandarin), English as the parallel edition.

## Brand personality

Classical 書卷編輯風 (scholarly editorial): paper, ink, one vermilion accent used as a
stroke/point — never flooded. Serif-first (Noto Serif TC display + Cormorant Garamond
numerals/Latin display + Lora Latin body). Hairline rules instead of boxes. Calm, precise,
bilingual, quietly confident. Numbers set beautifully (tabular figures) because numbers are
the product.

## Anti-references

- Generic SaaS landing slop: gradient heroes, glassmorphism, purple-blue gradients, emoji
  section markers, hero-metric templates.
- Translated-feeling 書面語 where 廣東話 belongs; machine-translation English.
- Dark mode on site pages — the identity is deliberately single-theme light (paper).

## Strategic design principles

1. **One dialect everywhere**: site pages use the Classical tokens (`#f3f2f2` paper,
   `#f8f4f4` card, `#201f1d` ink, `#a83228` vermilion, `#d7d3d3` hairline); tools use the
   utility dialect of the same tokens (4px controls, 6px cards, pill status tags).
2. **Red is a stroke, not a fill** — except solid primary buttons and small state pills.
3. **Typography carries hierarchy**; boxes and shadows don't. Hairline dividers.
4. **Bilingual is structural**: every user-facing string lives in the page's zh/en I18N
   dict (`kf-lang` in localStorage); zh is Cantonese.
5. **Client-side gating is convenience; RLS/RPC is the law.** Every privilege is enforced
   server-side (see docs/superpowers/specs).
6. **Accessibility floor**: 4.5:1 body contrast on paper, `:focus-visible` outlines,
   `prefers-reduced-motion` alternatives, 44px touch targets on booking actions.

## Proof & conversion (brand surfaces)

- Proof = working artifacts: Motion Lab, subtitle tool, stats notes, six-concepts essay
  (zh + en), the notes graph.
- Conversion = the contact form (`#contact`, progressive per service) and 排堂報名 for
  students. Keep both one click from anywhere (nav + sticky mobile CTA).
