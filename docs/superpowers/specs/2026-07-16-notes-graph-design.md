# Notes Graph（筆記圖譜）— Design

**Date:** 2026-07-16 · **Route:** `notes/` · **Status:** shipped with implementation (user operating in autonomous "don't ask" mode; design decisions recorded here for review/revision)

## Purpose

An Obsidian-style knowledge graph that links every note/article on the site, per the request: 「整一個類似obsidian的東西連結website中的所有筆記」. One page, no dependencies, matching the site's Classical editorial style.

## Approaches considered

1. **Hand-rolled force simulation on Canvas (chosen)** — zero dependencies (site has none), ~21 nodes is trivial for O(n²) physics, full styling control.
2. d3-force via CDN — adds the site's first external JS dependency for something 60 lines of physics covers. Rejected.
3. Pre-computed static layout — loses the organic drag/settle feel that makes it "Obsidian-like". Rejected.

## Data model

- `NODES`: `{id, type, url, zh, en, sumZh, sumEn}` — 19 nodes across 4 types (2026-07-16 revision: page-hub nodes removed per owner feedback — 頁面唔使存在喺筆記圖譜):
  - `note` (stats/ topics ×4), `chapter` (data-insights chapters ×6)
  - `service`: process automation (+3 sub-services), data analysis
  - `tool`: Motion Lab, Cantonese subtitles, split calculator, class booking
- `EDGES`: directed `[from, to]` pairs (19) — the data-analysis service links the four stats notes; chapters hang off the notes via concept links (e.g. stats "相關≠因果" → article ch.1 虛假關係; 抽樣偏差 → both 選擇性偏差 and 倖存者偏差; 倖存者偏差 → 均值回歸); the automation service links its three sub-services plus its two live examples (Motion Lab, Cantonese subtitles). Directionality feeds the panel's Links vs Backlinks split; rendering is undirected.

## Components

- **Physics:** repulsion (k/d²) + edge springs + center gravity, damped, alpha-decayed; deterministic golden-angle seeding (no `Math.random`) so layout is reproducible. `prefers-reduced-motion`: settle synchronously, no animation loop.
- **Canvas renderer:** DPR-aware; hover highlights the node's neighborhood and dims the rest (Obsidian behaviour); selected node gets a red halo ring; labels always on (21 nodes).
- **Interactions:** drag nodes (reheats sim), drag background to pan, wheel/pinch zoom, +/−/fit/re-layout buttons, click → detail panel, double-click → open the note's URL.
- **Detail panel** (right sidebar; bottom sheet ≤720px): type kicker, title, summary, **連結/Links** and **反向連結/Backlinks** lists (click to hop between notes), 開啟筆記 button.
- **Search:** live filter dims non-matching nodes; Enter jumps to first match.
- **i18n:** zh/en via the site's `kf-lang` localStorage pattern; node labels/summaries bilingual.

## Visual language

Site tokens verbatim: paper `#f3f2f2`, ink `#201f1d`, accent `#a83228`, hairline dividers at 16% ink. Node coding: red fill = stats notes, red outline = article chapters, ink fill = pages, ink outline = services, muted fill = tools. Edges are hairlines; highlight state uses the accent.

## Wiring

- Homepage: Tree 2 hamburger + footer gain 筆記圖譜/Notes Graph (`navGraph` key, zh+en).
- `stats/`: nav + footer link to the graph; the four notes gain anchors `#t1–#t4` so graph deep-links land correctly.
- `data-insights/`: header gains a 筆記圖譜 ↗ link (chapters already had `#s1–#s6` anchors).

## Testing

Playwright (bundled Chromium): desktop + mobile screenshots, zero pageerrors, node click → panel content asserted, search filter asserted, i18n toggle asserted, no body-level horizontal overflow.
