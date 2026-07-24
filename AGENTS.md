# AGENTS.md — Kuafuor HK workspace workflow

Kuafuor HK (kuafuorhk.com) is a bilingual (Cantonese/English) **multi-page static site
with no build step**, backed by a **live hosted Supabase project** and optional Node/Python
services. Read `PRODUCT.md` (product register, users, principles) and `DESIGN.md` (visual
tokens, components) before changing any user-facing UI.

---

## Repo map

| Path | What it is |
|---|---|
| `/`, `stats/`, `notes/`, `data-insights/` | Editorial marketing pages (public) |
| `cantonese-subtitle/`, `motion-lab/`, `motion-lab/posture/` | Free tools (public) |
| `login/` | Supabase auth entry |
| `schedule/`, `split-calculator/`, `billing-demo/`, `agent-dashboard/` | Coach/admin tools — **auth-gated** via `assets/guard.js` |
| `assets/` | Shared JS (`guard.js`, `entitlements.js`, `billing-config.js`) |
| `supabase/functions/` | Deno edge functions (deployed to hosted Supabase; no local `config.toml`) |
| `supabase/migrations/`, `db/migrations/` | SQL migrations (apply on hosted Supabase) |
| `whatsapp-bot/` | Node service (Railway): conversational booking + reminders |
| `sensevoice/`, `whisper/`, `motionlab-cloud/` | Modal GPU endpoints (CI-deployed) |
| `local-test/` | Mac-only subtitle pipeline dev tool (optional, heavy deps) |
| `docs/superpowers/specs/` | Approved design specs |
| `docs/superpowers/plans/` | Implementation plans for agents |
| `.claude/skills/` | Superpowers agent skills (brainstorming, TDD, debugging, etc.) |

**Deployment:** GitHub Pages (`CNAME`, `.nojekyll`). Supabase URL + publishable key are
hardcoded in `assets/*.js` and `login/`.

---

## Agent workflow (Superpowers)

Skills live in `.claude/skills/`. **Always invoke `using-superpowers` first**, then the
relevant process skill before acting.

| Task type | Skill chain |
|---|---|
| New feature / behaviour change | `brainstorming` → spec in `docs/superpowers/specs/` → user approval → `writing-plans` → plan in `docs/superpowers/plans/` → `subagent-driven-development` or `executing-plans` |
| Bug / test failure | `systematic-debugging` → fix → `verification-before-completion` |
| Frontend polish | `impeccable` (after design is approved) |
| Before claiming done | `verification-before-completion` — run commands, show output |
| Before merge | `finishing-a-development-branch` |

**Design constraints (non-negotiable):**
- zh copy = Cantonese (廣東話), not translated Mandarin
- Single light theme; vermilion `#a83228` is a stroke, not a flood
- Client-side gating is convenience; **RLS/RPC is the law** (see specs)
- No build step for site pages — each tool is a self-contained `index.html`

---

## Git & PR workflow

1. Branch off `main`: `cursor/<descriptive-name>-0d68` (lowercase).
2. Keep diffs focused; match existing file conventions.
3. Commit with clear messages; push `git push -u origin <branch>`.
4. Open a draft PR against `main`; update it after each push.
5. Do **not** commit secrets (`.env`, tokens, service role keys).

**Modal deploys:** push to `main` touching `sensevoice/**`, `whisper/**`,
`motionlab-cloud/**`, or `.github/workflows/modal-deploy.yml` triggers CI
(`.github/workflows/modal-deploy.yml`). Do not deploy Modal by hand.

---

## Verification commands

Run the checks relevant to your change before marking work complete.

```bash
# Site (no deps) — manual smoke in browser
python3 -m http.server 8000
# → http://127.0.0.1:8000/

# whatsapp-bot unit tests (25 tests, Node >= 18)
cd whatsapp-bot && npm test

# Optional: only when working on subtitle/pose pipelines
# cd local-test && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

---

## Cursor Cloud specific instructions

Cloud agents boot with `.cursor/environment.json` → `bash .cursor/install.sh`
(whatsapp-bot deps). Python 3 and Node 18+ are available on the base image.

### Serving the site (the main app)

- From repo root: `python3 -m http.server 8000` → `http://127.0.0.1:8000/`
- **Public pages:** `/`, `cantonese-subtitle/`, `motion-lab/`, `motion-lab/posture/`,
  `stats/`, `notes/`, `data-insights/`, `login/`
- **Auth-gated tool pages:** `schedule/`, `split-calculator/`, `billing-demo/`,
  `agent-dashboard/` include `assets/guard.js` and **fail closed** — they redirect to
  `/login/` unless logged into the live Supabase project with `coach`/`admin` role.
  End-to-end testing needs real Supabase credentials (add as Cloud Agent secrets).
  Tool logic is client-side once past the guard.

### whatsapp-bot (Node service)

- `cd whatsapp-bot && npm test` — 25 unit tests, no external services needed
- `npm start` needs real env vars (WhatsApp Cloud API + Supabase service role);
  see `whatsapp-bot/.env.example` and `whatsapp-bot/README.md`

### Heavy / optional subprojects

- `local-test/`, `sensevoice/`, `whisper/`, `motionlab-cloud/` — Python GPU/ML apps
  with large deps; deploy to Modal via CI. **Not required** for website development.
- `supabase/functions/*` — applied to hosted Supabase; no local Supabase CLI config in repo.

### Secrets (Cloud Agent dashboard)

Add via [Cursor Cloud Agents → Secrets](https://cursor.com/dashboard?tab=cloud-agents)
when end-to-end testing needs them:

| Secret | Used for |
|---|---|
| Supabase test account | Auth-gated pages (`schedule/`, etc.) |
| `GEMINI_API_KEY` | Subtitle fusion / local-test |
| `STRIPE_SECRET_KEY` | Billing setup script (`scripts/stripe-setup.mjs`) |
| WhatsApp / service role | whatsapp-bot integration (Railway, not Cloud Agent default) |
