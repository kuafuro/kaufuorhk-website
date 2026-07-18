# Whisper large-v3 cloud transcription — Kuafuor HK「🎯 準確模式」(Subtitle Pro) · ASYNC
# 同 SenseVoice 一樣嘅 async 樣式：web endpoint 只係 spawn background GPU job 即刻返，
# 完成後 POST 去 Supabase transcribe-callback；網站 poll job row。
#
#   POST {url}   Authorization: Bearer {SENSEVOICE_TOKEN}
#   body:  { "audio_url": "<signed url>", "job_id": "<uuid>" }
#   202:   { "spawned": true, "job_id": "<uuid>" }
#
# 準確模式 trade-off（產品決定：一定要準行先）：
#   + faster-whisper large-v3：廣東話準確度明顯高過 SenseVoiceSmall
#   + 逐段 confidence（avg_logprob → 0-1）：前端 highlight 低信心句俾人校
#   - 冇講者分離、冇背景音標註（嗰啲係 SenseVoice「快速模式」嘅嘢）
# Modal secret "sensevoice" 提供 SENSEVOICE_TOKEN, CALLBACK_URL, CALLBACK_SECRET（同一套）。
import math

import modal

# fastapi is needed LOCALLY too (Header(...) default is evaluated when `modal deploy` builds the graph).
from fastapi import Header, HTTPException

app = modal.App("kuafuor-whisper")

MODEL_DIR = "/models"
model_cache = modal.Volume.from_name("kuafuor-whisper-cache", create_if_missing=True)
MAX_MINUTES = 120  # per-file backstop (the real monthly cap is the Edge Function quota)

# 廣東話口語 prompt：bias 個 decoder 出「係、喺、佢哋、咁樣、嘅、㗎、喇」呢啲口語字
CANTO_PROMPT = "呢段係廣東話口語對話，保留原汁原味嘅廣東話字詞：係囉、咁樣、佢哋、喺度、嘅、㗎、喇、唔係。"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "faster-whisper==1.1.0",
        "opencc-python-reimplemented==0.1.7",
        "requests==2.32.3",
        "fastapi[standard]==0.115.6",
    )
    .env({"HF_HOME": MODEL_DIR})
)


@app.cls(
    gpu="T4",
    image=image,
    volumes={MODEL_DIR: model_cache},
    secrets=[modal.Secret.from_name("sensevoice")],  # SENSEVOICE_TOKEN, CALLBACK_URL, CALLBACK_SECRET
    scaledown_window=300,
    timeout=1800,
)
class WhisperLarge:
    @modal.enter()
    def load(self):
        import opencc
        from faster_whisper import WhisperModel
        self.cc = opencc.OpenCC("s2hk")
        # T4 冇 bf16：float16 啱使；模型 ~3GB，落一次入 volume 之後好快
        self.model = WhisperModel("large-v3", device="cuda", compute_type="float16", download_root=MODEL_DIR)
        model_cache.commit()

    def _probe_ms(self, path):
        import subprocess
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=nokey=1:noprint_wrappers=1", path],
            capture_output=True, text=True,
        ).stdout.strip()
        try:
            return int(float(out) * 1000)
        except ValueError:
            return 0

    @modal.method()
    def run(self, audio_url: str, job_id: str):
        import os
        import subprocess
        import tempfile

        import requests

        callback_url = os.environ["CALLBACK_URL"]
        callback_secret = os.environ["CALLBACK_SECRET"]

        def report(payload):
            try:
                requests.post(callback_url, json={"job_id": job_id, **payload},
                              headers={"x-callback-secret": callback_secret}, timeout=30)
            except Exception as e:  # noqa: BLE001
                print("callback POST failed:", e)

        try:
            with tempfile.TemporaryDirectory() as tmp:
                src = os.path.join(tmp, "src")
                wav = os.path.join(tmp, "audio.wav")

                with requests.get(audio_url, stream=True, timeout=120) as r:
                    r.raise_for_status()
                    total = 0
                    with open(src, "wb") as f:
                        for chunk in r.iter_content(chunk_size=1 << 20):
                            total += len(chunk)
                            if total > 500 * (1 << 20):
                                return report({"error": "audio too large (>500MB)"})
                            f.write(chunk)

                norm = subprocess.run(
                    ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", wav],
                    capture_output=True, text=True,
                )
                if norm.returncode != 0 or not os.path.exists(wav):
                    return report({"error": "unsupported or corrupt audio"})

                duration_ms = self._probe_ms(wav)
                if duration_ms > MAX_MINUTES * 60 * 1000:
                    return report({"error": f"audio exceeds {MAX_MINUTES} min limit"})

                # condition_on_previous_text=False：防重複 loop；vad_filter 跳過長靜位
                segs_iter, _info = self.model.transcribe(
                    wav, language="yue", beam_size=5,
                    initial_prompt=CANTO_PROMPT,
                    condition_on_previous_text=False,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 500},
                )
                segments = []
                for s in segs_iter:
                    text = self.cc.convert((s.text or "").strip())
                    if not text:
                        continue
                    conf = round(min(1.0, max(0.0, math.exp(s.avg_logprob))), 3) if s.avg_logprob is not None else None
                    segments.append({
                        "start_ms": int(s.start * 1000), "end_ms": int(s.end * 1000),
                        "spk": None, "text": text, "conf": conf,
                    })
            report({"segments": segments, "duration_ms": duration_ms})
        except Exception as e:  # noqa: BLE001
            report({"error": str(e)[:300]})


# Lightweight CPU web endpoint: authenticate, spawn the GPU job, return immediately.
web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.6")


@app.function(image=web_image, secrets=[modal.Secret.from_name("sensevoice")])
@modal.fastapi_endpoint(method="POST", docs=False)
def whisper(data: dict, authorization: str = Header(default=None)):
    import os
    if not authorization or authorization != "Bearer " + os.environ["SENSEVOICE_TOKEN"]:
        raise HTTPException(status_code=401, detail="unauthorized")
    audio_url = (data or {}).get("audio_url")
    job_id = (data or {}).get("job_id")
    if not audio_url or not job_id:
        raise HTTPException(status_code=400, detail="audio_url and job_id required")
    WhisperLarge().run.spawn(audio_url, job_id)   # fire-and-forget; result arrives via the callback
    return {"spawned": True, "job_id": job_id}
