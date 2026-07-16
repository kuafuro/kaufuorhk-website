# SenseVoice cloud transcription endpoint (Subtitle Pro)

The GPU endpoint behind the subtitle tool's **☁️ 雲端快速** mode. Cantonese-native
([SenseVoice](https://github.com/FunAudioLLM/SenseVoice) / FunASR), ~15× faster than local Whisper,
returns **繁體(香港)** text + **時間軸** + **講者** per the contract in
[`../docs/superpowers/specs/2026-07-15-sensevoice-cloud-transcription-design.md`](../docs/superpowers/specs/2026-07-15-sensevoice-cloud-transcription-design.md) §5.

Runs on [Modal](https://modal.com) with **scale-to-zero** — no idle cost. First request after
it's been idle pays a ~30–60 s cold start; after that it's warm for 5 minutes.

---

## Deploy (one time)

You need a Modal account (free tier is enough to start).

```bash
# 1. Install the CLI on your machine (fastapi is needed locally to build the web endpoint)
pip install modal fastapi

# 2. Log in (opens a browser)
modal token new

# 3. Create the shared secret the endpoint checks on every request.
#    Generate a strong random token and KEEP A COPY — this becomes SENSEVOICE_TOKEN.
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
#    -> paste the value into the command below:
modal secret create sensevoice SENSEVOICE_TOKEN=paste_the_value_here

# 4. Pre-download the model weights into a cached Volume (one-off, ~2-3 min on a GPU).
#    Skipping this just means your FIRST live request downloads them instead.
modal run sensevoice/modal_app.py

# 5. Deploy the live endpoint.
modal deploy sensevoice/modal_app.py
```

The deploy prints a URL ending in `.modal.run`, e.g.

```
https://<your-workspace>--kuafuor-sensevoice-sensevoice-transcribe.modal.run
```

**That URL is your `SENSEVOICE_URL`** (the `/transcribe` path is built in — no need to append it;
if you prefer, the base is the URL as printed). Send me:

- `SENSEVOICE_URL` = the `.modal.run` URL above
- `SENSEVOICE_TOKEN` = the random value from step 3

I'll put them in Supabase as Edge Function secrets (P2). They are **not** committed to the repo.

---

## Timing test (the "does it lose money?" check)

Point it at any publicly reachable Cantonese audio file (or a Supabase signed URL). This measures
real wall-clock so we can confirm the per-hour GPU cost the pricing assumes:

```bash
time curl -sS -X POST \
  "https://<your-workspace>--kuafuor-sensevoice-sensevoice-transcribe.modal.run" \
  -H "Authorization: Bearer <SENSEVOICE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"audio_url":"https://example.com/your-cantonese-clip.mp3","language":"yue","diarize":true}'
```

Expected `200` shape:

```json
{
  "segments": [
    { "start_ms": 0, "end_ms": 3200, "spk": 0, "text": "喂你好，今日開會講咩？" },
    { "start_ms": 3200, "end_ms": 7000, "spk": 1, "text": "講下個新項目嘅進度。" }
  ],
  "duration_ms": 725000
}
```

Tell me the `real` time for a clip of a known length (e.g. a 10-min file) and I'll confirm the
cost math. The first call includes cold start; run it **twice** and use the second number for the
true transcription speed.

Watch cost live at [modal.com](https://modal.com) → your app → **Metrics**.

---

## Troubleshooting (Modal API version drift)

I wrote this against Modal's current (late-2025) API. If `modal deploy` errors on a name, it's
almost certainly one of these renames — swap and re-run:

| If you see an error about… | Change | To |
|---|---|---|
| `scaledown_window` | `scaledown_window=300` | `container_idle_timeout=300` (older Modal) |
| `min_containers` | remove `min_containers=0` | (it's the default) |
| `fastapi_endpoint` | `@modal.fastapi_endpoint(...)` | `@modal.web_endpoint(...)` (older Modal) |
| `gpu="T4"` | `gpu="T4"` | `gpu=modal.gpu.T4()` (older Modal) |
| fastapi ImportError locally | — | `pip install fastapi` |

Send me the exact error text if it's something else — I can't run Modal from my sandbox, so your
first deploy is our test.

**Tuning:** `MAX_MINUTES` (per-file length cap) and the GPU type live at the top of `modal_app.py`.
T4 is the cheapest that's fast enough; if long files feel slow, try `gpu="L4"` or `gpu="A10G"`.

---

*SenseVoice / FunASR © Alibaba — commercial use permitted with attribution. The subtitle UI credits
"廣東話雲端轉錄由 SenseVoice (FunASR · Alibaba) 提供".*
