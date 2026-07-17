# Kuafuor HK — PRODUCT.md

## Register

`brand` — the homepage, notes, articles and graph are the primary surface: an editorial
marketing site where the design IS the pitch (a data/automation consultancy that looks like
a well-set book proves its own claim to rigour). Tool pages (`login/`, `schedule/`,
`split-calculator/`, `cantonese-subtitle/`, `motion-lab/`) run in the **product** register:
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
