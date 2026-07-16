# SenseVoice cloud transcription endpoint (Subtitle Pro)

The GPU endpoint behind the subtitle tool's **☁️ 雲端快速** mode. Cantonese-native
([SenseVoice](https://github.com/FunAudioLLM/SenseVoice) / FunASR), returns **繁體(香港)** text +
**時間軸** + **講者**, per the contract in
[`../docs/superpowers/specs/2026-07-15-sensevoice-cloud-transcription-design.md`](../docs/superpowers/specs/2026-07-15-sensevoice-cloud-transcription-design.md).

Runs on [Modal](https://modal.com) with **scale-to-zero** (no idle cost). **Async**: the web
endpoint only spawns a background GPU job and returns immediately; the job POSTs its result to the
Supabase `transcribe-callback` function, and the website polls the `transcribe_jobs` row — so a
cold start can never time out a request.

## Deploys automatically — do not deploy by hand

Any push to `main` that touches `sensevoice/**` (or the workflow file) triggers
[`.github/workflows/modal-deploy.yml`](../.github/workflows/modal-deploy.yml), which:

1. authenticates itself to the `ci-config` Supabase Edge Function using its **GitHub OIDC token**
   (verified server-side against GitHub's JWKS + strict repository/workflow claims — fork runs are
   rejected, and there are **no secrets in this repo**);
2. fetches the Modal credentials + endpoint secrets from Supabase **Vault**;
3. installs the `sensevoice` Modal secret and runs `modal deploy`;
4. registers the resulting `*.modal.run` URL back into Vault, where the `transcribe-fast`
   Edge Function reads it.

So: edit `modal_app.py`, push, done. Rotating credentials = update the Vault rows
(`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `SENSEVOICE_TOKEN`, `CALLBACK_SECRET`) and re-run the
workflow (any push touching `sensevoice/**`).

## Tuning

`MAX_MINUTES` (per-file length cap) and the GPU type live at the top of `modal_app.py`. T4 is the
cheapest that is fast enough; for faster long files try `gpu="L4"`/`gpu="A10G"`. The monthly
per-user quota (the "never lose money" cap) lives in the `transcribe-fast` Edge Function.

---
*SenseVoice / FunASR © Alibaba — commercial use permitted with attribution. The subtitle UI credits
"廣東話雲端轉錄由 SenseVoice (FunASR · Alibaba) 提供".*
