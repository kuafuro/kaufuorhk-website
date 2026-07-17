# Kuafuor HK — DESIGN.md

Visual system extracted from the shipped pages (index, stats, data-insights zh/en, notes,
login, schedule, split-calculator, cantonese-subtitle, guard.js). Two dialects, one system.

## Theme

Classical 書卷編輯風 — scholarly editorial print on paper. Single light theme by design
(`color-scheme: light`; dark-mode media queries pin the same light tokens). Motion Lab is
exempt: it keeps its own dark product identity.

## Color

| Token | Value | Use |
|---|---|---|
| paper / bg | `#f3f2f2` | page ground everywhere |
| surface | `#eae9e9` | soft panels, plates, table aggregate rows |
| card | `#f8f4f4` | tool-page cards, guard screens |
| ink | `#201f1d` | text, solid ghost-button borders |
| divider | `color-mix(in srgb, #201f1d 16%, transparent)` (editorial pages) / `#d7d3d3` (tool pages) | hairlines |
| muted | 55% ink (`#605d5d` on tools) | secondary text |
| faint | 42% ink | captions, legends |
| vermilion accent | `#a83228` (hover `#8c2a21`, deep `#732219`) | kickers, numerals, links, solid primary buttons, selection |
| accent soft | `#fdeeec` | accent-tinted pills/hover |
| ok | `#1e7d46` on `#e6f0e9` | confirmed states |
| warn | `#7a5400` on `#f3ecd9` | open/pending states |
| error | `#6f1e16` bg + white ink | error messages |

Rule: red is a stroke/point, never a flood. Semantic ok/warn are separate from the accent.

## Typography

| Role | Face | Notes |
|---|---|---|
| Chinese display & body | Noto Serif TC 400/600/700 | headings on editorial pages |
| Latin display & numerals | Cormorant Garamond 400/600 | logo, chapter numbers `01`, slot times, big stats — always with `font-feature-settings:'tnum'` |
| Latin body | Lora 400/600 (+italic on article pages) | body on tool pages pairs `"Lora","Noto Serif TC",serif` |

- Kickers: 12px, `letter-spacing:0.24em`, uppercase, vermilion. Used deliberately (section
  heads on the homepage), not on every block.
- Chinese long-form (data-insights): 2em first-line indents, justified, ~36 chars/line
  (`--measure:42rem`), line-height 2.
- English long-form: 1.6em indents after opening paragraph, justified + hyphens,
  `--measure:46rem`, line-height 1.75.
- `text-wrap:balance` on headings.

## Components

- **Buttons**: primary = vermilion border + vermilion text, transparent bg (editorial) or
  solid vermilion bg + white (tools `.btn.solid` / `button.primary`); ghost = 1.5px ink
  border. Radius 2px (editorial) / 4px (tools). Min-height 40–44px on touch surfaces.
- **Cards**: tool pages only — `#f8f4f4`, 1px `#d7d3d3`, radius 6px. Editorial pages use
  hairline rules and whitespace instead of cards.
- **Status pills**: 99px radius, soft bg + semantic ink + matching 25–30% hairline border
  (`.tag.open/.confirmed/.mine/.full`).
- **Badges** (login): 99px pills; role/coach solid, plan Pro/Max solid vermilion, level
  outline; free plan shows no badge.
- **Plates** (photo frames): 6px `#eae9e9` border + 1px hairline outline; grey hatched
  slot as honest placeholder.
- **Tables** (articles): 2px ink top rule, `表一/Table 1` caption in caption-side:top,
  hairline row borders, aggregate row on `--surface`, wrapped in `overflow-x:auto`.
- **Forms**: labels 12px muted above inputs; inputs 1px hairline, bg paper, radius 2–4px,
  `:focus-visible` 2px vermilion outline; progressive reveal groups get a 2px vermilion
  left rule (`.reveal-grp`) — the one sanctioned left-accent, it means "conditional".
- **Toast**: ink bg, paper text, bottom-center, radius 4px.

## Layout

- Editorial pages: `.wrap` max 1140px; article measure 42–46rem centered; section padding
  56px (32px mobile); two-tier nav (Tree 1 links + Tree 2 hamburger, also on desktop).
- Tool pages: single column `max-width` 430px (login) / 720px (schedule, calculator).
- Sticky mobile CTA bar ≤840px on the homepage (`#stickyCta`).
- Wide content always scrolls in its own container; the body never scrolls sideways.

## Motion

Sparse and stateful: `.fade` IntersectionObserver reveals on the homepage with a 2s
visibility safety net (content never gated on JS); notes-graph physics settles and honors
`prefers-reduced-motion` by settling synchronously; toasts fade 200ms. No page-load
choreography, no bounce.

## Voice

zh = Cantonese (廣東話), en = idiomatic English. All strings in per-page `I18N` dicts keyed
by `kf-lang` localStorage. Error copy explains what happened and what to do next.
