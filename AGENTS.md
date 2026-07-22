# AGENTS.md

## Cursor Cloud specific instructions

Kuafuor HK (kuafuorhk.com) is a bilingual (Cantonese/English) **multi-page
static site with no build step** — each top-level directory is a self-contained
HTML page/tool. It is deployed via GitHub Pages (`CNAME`, `.nojekyll`); the
frontend talks to a **live hosted Supabase project** whose URL + publishable key
are hardcoded in `assets/*.js` and `login/`.

### Serving the site (the main app)
- From the repo root: `python3 -m http.server 8000`, then open
  `http://127.0.0.1:8000/`. No build/deps needed for the site itself.
- Public (ungated) pages: homepage `/`, `cantonese-subtitle/`, `motion-lab/`,
  `motion-lab/posture/`, `stats/`, `notes/`, `data-insights/`, `login/`.
- **Auth-gated tool pages**: `schedule/`, `split-calculator/`, `billing-demo/`,
  `agent-dashboard/` include `assets/guard.js` and **fail closed** — they
  redirect to `/login/` unless you are logged into the live Supabase project
  with a `coach`/`admin` role. Fully testing these tools end-to-end therefore
  needs a real Supabase account (test credentials). The tool logic still runs
  purely client-side once past the guard.

### whatsapp-bot (Node service)
- `cd whatsapp-bot` then `npm test` runs the 25-test unit suite
  (`node test/booking.test.js`). Deps are installed by the startup update script
  (`npm install` in `whatsapp-bot/`). Node >= 18 required.
- `npm start` needs real env vars (WhatsApp Cloud API + Supabase service role);
  see `whatsapp-bot/.env.example`.

### Heavy / optional subprojects (not needed for site dev)
- `local-test/`, `sensevoice/`, `whisper/`, `motionlab-cloud/` are Python
  GPU/ML apps (Whisper/FunASR/Modal) with large deps; they deploy to Modal and
  are not required to develop or run the website. Only install their
  requirements if you are specifically working on the subtitle/pose pipelines.
- `supabase/functions/*` are Deno edge functions applied to the hosted Supabase
  project; there is no local Supabase config (`config.toml`) in the repo.
