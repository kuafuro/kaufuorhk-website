# SenseVoice cloud fast transcription (Subtitle Pro) — Design Spec

- **Date:** 2026-07-15
- **Status:** APPROVED — all decisions locked (Modal host · Pro HK$30/5hr · Max HK$88/20hr · ~6h retention · Kuafuor Max deferred). Building P1.
- **Depends on:** the freemium/Stripe billing (shipped) — this is a new Subtitle **Pro** capability.
- **Quality gate:** PASSED — SenseVoice tested on a real Cantonese meeting clip; it preserves colloquial 口語 (瞓死咗/係啦/佢哋/唔該), converts cleanly to Traditional (OpenCC `s2hk`), and supports timestamps + speaker diarization (`cam++`).

## 1. Goal & scope

Make the subtitle tool **actually usable on long audio** by adding a fast **cloud** transcription
mode as a **Subtitle Pro** feature, using **SenseVoice** (Cantonese-native, ~15× faster than Whisper).

- **Free tier — unchanged:** 100% local Whisper (transformers.js), audio never uploaded, slow, private.
- **Pro tier — new "☁️ 雲端快速":** upload audio → SenseVoice on a GPU endpoint → seconds, not minutes;
  returns **Traditional (s2hk)** text + **timestamps** + **speaker labels** + a downloadable **`.srt`**.

**Why SenseVoice over Groq-Whisper:** on Cantonese, SenseVoice keeps colloquial form (Whisper mandarin-izes
it) and is faster; the only cost is it must run on our own/served GPU (Whisper had turnkey APIs).

**Out of scope:** Motion Lab (separate); changing the free local path; realtime/streaming transcription.

## 2. Product positioning

| | Free | Subtitle Pro (cloud fast) |
|---|---|---|
| Engine | local Whisper (browser) | **SenseVoice** on GPU endpoint |
| Speed (1 hr audio) | ~10–40 min (WASM) | **~15–60 sec** |
| Output | preview 10% (see freemium spec) | full **繁體** + 時間軸 + 講者 + `.srt` |
| Audio | never leaves device | **uploaded** (opt-in, deleted after) |
| Privacy | maximal | audio processed on our endpoint, then deleted |

Cloud fast becomes the headline Pro upsell (not just export). Free stays the private/offline option.

## 2.5 Tiers (Pro / Max) — usage-based upsell

Cloud transcription costs real GPU money per minute, so cloud-fast minutes are **metered against a
monthly quota that depends on the user's tier**. Two paid tiers per tool:

| Tier | Price | Cloud-fast quota / month |
|---|---|---|
| **Subtitle Pro** | HK$30 (existing) | **300 min (5 hr)** |
| **Subtitle Max** | **HK$88** | **1 200 min (20 hr)** |

**"Never lose money" guarantee (owner's only constraint):** the monthly quota **hard-caps the per-user
GPU cost**, and each tier is priced well above the worst-case cost at full quota. Real GPU cost ≈
HK$0.4 / hr audio (T4); padded 5× to **HK$2 / hr** for safety:
- Pro: 5 hr × HK$2 = HK$10 worst-case cost vs HK$30 → **≥ HK$20 margin**.
- Max: 20 hr × HK$2 = HK$40 worst-case cost vs HK$88 → **≥ HK$48 margin**.
- Even at an absurd HK$4/hr (10× estimate), Max still nets +HK$8. **Structurally cannot lose money per subscriber.**
- P1's real timing test confirms the true cost; quotas/prices can be tuned up with confidence afterwards.

**Over-quota behaviour (per your call):** when a Pro user uses up their monthly cloud minutes, we do
**not** hard-stop — we show an **upgrade-to-Max** prompt ("你今個月嘅雲端額度用完喇,升 Max 解鎖更多")
and they can still use the **free local** engine meanwhile. Upgrading to Max raises the quota immediately.

**Entitlement model change:** add a `tier text default 'pro' check (tier in ('pro','max'))` column to the
existing `entitlements` table. `has_pro()` is unchanged (any active row = access). A new
`entitlement_tier(user, product)` returns the highest active tier (`max` > `pro` > none) to pick the quota.

**Stripe change:** add **"Subtitle Max"** (monthly) — and, if wanted, **"Kuafuor Max"** (all-access Max).
`create-checkout` gains a `tier` param; `subscription_data.metadata` carries `{ user_id, product, tier }`;
the webhook maps price → `(product, tier)` and writes `tier` on the entitlement row.

(Same structure generalises to Motion Lab later: motionlab Pro vs Max = different session/athlete quotas.)

## 3. Architecture

```
[Subtitle tool · Pro · "☁️ 雲端快速"]
  │ 1. upload audio → Supabase Storage (private bucket, RLS: own folder, Pro-only)
  │ 2. POST {path} + user JWT
  ▼
[Edge Function: transcribe-fast]  (verify JWT + has_pro('subtitle'); rate-limit)
  │ 3. signed URL for the audio → POST to SenseVoice endpoint (+ endpoint token)
  ▼
[SenseVoice endpoint (GPU)]  SenseVoice(yue) + fsmn-vad + cam++ + OpenCC s2hk
  │ 4. returns [{start,end,spk,text(繁體)}]
  ▼
[Edge Function] → returns segments to client; audio kept ~6h for re-run (§7)
  ▼
[Subtitle tool] renders segments (時間+講者), builds .srt, reuses existing cloud-save/export
```

- The Edge Function is the **gatekeeper** (Pro/tier check + quota + secrets + orchestration); the GPU endpoint does inference.
- **Audio is kept ~6 hours for re-run, then auto-deleted** (§7) — a scheduled sweep enforces the window.
- `s2hk` (簡→繁 HK) runs on the **endpoint** (Python OpenCC), so the client/Edge never handle conversion.

## 4. Hosting the SenseVoice endpoint — options + cost

This is the one infra decision. Both are supported by the same Edge Function (it just needs an
`SENSEVOICE_URL` + `SENSEVOICE_TOKEN`).

### Option A — Modal serverless GPU (**recommended to start**)
- We ship a ready `modal deploy sensevoice_app.py`; you run it once → get an HTTPS endpoint + token.
- **Scale-to-zero:** idle = **$0**; you pay per-second GPU only while transcribing.
- **Cost:** ~1 min GPU per 1 hr audio on a T4/A10G → **~US$0.02–0.06 per hour of audio**. A Pro user doing
  50 hrs/month ≈ **US$1–3 ≈ HK$8–23**, well under the HK$30/mo Subtitle Pro price → healthy margin.
- **Trade-off:** cold start (~10–30 s model load) on the first request after idle. Fine for a subtitle tool.
- **Ops:** minimal (Modal manages the box).

### Option B — Self-hosted GPU/CPU VPS
- We ship a FunASR **OpenAI-compatible** server (Docker); you run it on a VPS.
- **GPU VPS** (~US$150–360/mo always-on): fastest, no cold start. Only worth it at high volume.
- **CPU VPS** (~US$20–40/mo): SenseVoice-Small runs on CPU (<1 GB), ~1–3 min per clip — still far better
  than 41 min local, cheaper than a GPU box, no per-call fee. Good "fixed cheap" middle ground.
- **Privacy:** audio stays on **your** server (best privacy story).
- **Ops:** you manage uptime/patching.

**Recommendation:** **Modal (A)** to launch — lowest cost + effort at low volume, migrate to a self-hosted
GPU box (B) if usage grows. The Edge Function is identical either way.

## 5. SenseVoice endpoint contract

`POST {SENSEVOICE_URL}/transcribe`  (auth: `Authorization: Bearer {SENSEVOICE_TOKEN}`)

- **Input:** `{ audio_url: string (signed), language: "yue", diarize: true }`
- **Behaviour:** download audio → `AutoModel(SenseVoiceSmall, vad=fsmn-vad, spk=cam++)` → for each
  sentence produce `{start_ms, end_ms, spk, text}` → `rich_transcription_postprocess` → OpenCC `s2hk`.
- **Output:** `{ segments: [{ start_ms, end_ms, spk, text }], duration_ms }`
- **Limits:** reject > N minutes (config, e.g. 120) to cap cost; 60 s request timeout guard.

We provide this as `sensevoice_app.py` (Modal) **or** a Dockerfile+server (VPS) — same JSON contract.

## 6. Edge Function `transcribe-fast`

- **Auth:** Supabase JWT; reject if not `has_pro('subtitle')` (server-enforced; also enforced by Storage RLS).
- **Input:** `{ storage_path }`.
- **Steps:** validate ownership of the path → check the user's monthly quota (below) → create a
  short-lived signed URL → POST to `SENSEVOICE_URL` with the token → receive segments → record the
  minutes used → return `{ segments, duration_ms }`. The audio is **kept for a short re-run window**
  (see §7), not deleted here.
- **Tiered quota:** minutes used this calendar month are tracked in a `usage_transcribe` table; the cap
  is the user's tier quota (`entitlement_tier` → Pro 300 min / Max 1 800 min, config). **Over quota →
  `402 { error: 'quota', tier: 'pro' }`** → client shows the **upgrade-to-Max** prompt (not a hard error);
  the free local engine still works. A pre-flight estimate (audio duration) blocks a request that would
  clearly exceed the remaining quota, so we don't pay for a transcription we then refuse.
- **Secrets (Supabase):** `SENSEVOICE_URL`, `SENSEVOICE_TOKEN`. Never in the repo.

## 7. Storage

- Private bucket `subtitle-audio`; RLS: a user may `insert`/`read`/`delete` only under `"{auth.uid()}/…"`
  **and** only if `has_pro('subtitle')`.
- **Short re-run retention (per your call):** the uploaded audio is kept for a **short window
  (default 6 hours)** so the user can re-run (e.g. tweak language, retry) without re-uploading; after
  that a scheduled sweep (Supabase cron / `pg_cron` + edge) auto-deletes it. The user can also delete
  immediately. This is disclosed in the opt-in notice (§9).

## 8. Frontend integration (cantonese-subtitle)

- Add a mode toggle in the tool: **本地(免費)** vs **☁️ 雲端快速(Pro)**.
- Cloud mode is `ent.requirePro('subtitle', '雲端快速')`-gated; non-Pro → paywall.
- Flow: pick file → upload to Storage → call `transcribe-fast` → render segments with `[時間] 講者N：繁體`
  → build `.srt` → reuse the existing **☁️ 存去雲端 / history / export** (Phase-2 features).
- **Progress UX:** show "上傳中… / 雲端轉錄中…"; on cold start show "首次啟動,約 15–30 秒".
- **Fallback:** if the endpoint is down/times out, offer "改用本地(免費)" — the tool still works locally.

## 9. Privacy (must stay explicit)

- Free/local path: audio never uploaded — **unchanged**, still the default and the privacy pitch.
- Cloud fast: **audio IS uploaded** (to our Storage → our SenseVoice endpoint) and processed. The audio is
  **kept ~6 hours for re-run, then auto-deleted** (§7). Clearly opt-in, one-line notice at the toggle:
  "雲端快速會上傳你嘅音檔去我哋伺服器處理,保留約 6 小時俾你重試,之後自動刪除;唔想上傳就用本地(免費)。"
  Transcript text is saved only if the user uses ☁️ 存去雲端.

## 10. Cost control & abuse

- Pro-gated at 3 layers: Storage RLS (`has_pro`), Edge Function (`has_pro`), and per-user monthly minute cap.
- Endpoint rejects over-long files. Modal scale-to-zero bounds idle cost to $0.

## 11. Attribution (license)

SenseVoice/FunASR code is MIT; **model weights = FunASR Model Open Source License → commercial OK but
requires attribution.** Add to the tool's footer/about: "廣東話雲端轉錄由 SenseVoice(FunASR · Alibaba)提供".

## 12. Fallback & resilience

- Endpoint error/timeout → client falls back to local Whisper (no dead end).
- Edge Function returns typed errors (`monthly_cap`, `too_long`, `endpoint_down`) → localized messages.

## 13. Phasing

- **P1 — endpoint:** ship `sensevoice_app.py` (Modal) + the JSON contract; you deploy → we get a URL/token.
- **P2 — backend:** Storage bucket + RLS; `transcribe-fast` Edge Function + secrets + usage cap table.
- **P3 — frontend:** local/cloud toggle, upload+progress, render 時間/講者, `.srt`, fallback, attribution.

Each phase is independently testable (endpoint via curl; Edge via a test call; frontend end-to-end).

## 14. What you provide

**Decisions locked:** host = **Modal**; tiers = **Pro + Max**; audio kept **~6 h** for re-run.

1. A free **Modal** account → run `modal deploy` on the script we give you → gives `SENSEVOICE_URL` + `SENSEVOICE_TOKEN`.
2. **Stripe:** create "Subtitle Max" (monthly) price — and, if wanted, "Kuafuor Max" (all-access Max) — send the price IDs.
3. Set the two SenseVoice secrets + the Max price IDs in Supabase (same as the Stripe keys before).

Everything else (Modal deploy script, Storage, RLS, `tier` migration, Edge Function, frontend) is built by us.

## 15. Open items

- **Locked (owner delegated under "don't lose money"):** Subtitle Pro HK$30 / 5 hr; Subtitle Max HK$88 / 20 hr.
- **Kuafuor Max (all-access Max): deferred** — keep it simple; all-access stays Pro-tier (includes subtitle
  cloud at the Pro 5 hr quota). Add Kuafuor Max later if there's demand.
- Modal GPU class (T4 cheapest vs A10G faster) — pick after the real timing test in P1; quotas/prices can
  be tuned up afterwards with the true cost in hand.
