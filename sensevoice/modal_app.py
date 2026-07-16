# SenseVoice cloud transcription endpoint — Kuafuor HK (Subtitle Pro) · ASYNC
# The web endpoint only SPAWNS a background GPU job and returns immediately, so a cold start
# never times out the caller. When the job finishes it POSTs the result to the Supabase
# transcribe-callback function; the website polls the job row. See the design spec §6 (async).
#
#   POST {url}   Authorization: Bearer {SENSEVOICE_TOKEN}
#   body:  { "audio_url": "<signed url>", "job_id": "<uuid>", "language": "yue", "diarize": true }
#   202:   { "spawned": true, "job_id": "<uuid>" }   (result arrives later via the callback)
#
# Modal secret "sensevoice" must provide: SENSEVOICE_TOKEN, CALLBACK_URL, CALLBACK_SECRET.
# Deploy: see sensevoice/README.md (or the Colab notebook). SenseVoice/FunASR © Alibaba (attribution).

import modal

# fastapi is needed LOCALLY too (Header(...) default is evaluated when `modal deploy` builds the graph).
from fastapi import Header, HTTPException

app = modal.App("kuafuor-sensevoice")

MODEL_DIR = "/models"
model_cache = modal.Volume.from_name("kuafuor-sensevoice-cache", create_if_missing=True)
MAX_MINUTES = 120  # per-file backstop (the real monthly cap is the Edge Function quota)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "funasr",  # unpinned on purpose: matches the empirically-validated Colab environment
        "torch==2.4.1",
        "torchaudio==2.4.1",
        "opencc-python-reimplemented==0.1.7",
        "modelscope==1.20.1",
        "requests==2.32.3",
        "fastapi[standard]==0.115.6",
    )
    .env({"MODELSCOPE_CACHE": MODEL_DIR, "HF_HOME": MODEL_DIR})
)


@app.cls(
    gpu="T4",
    image=image,
    volumes={MODEL_DIR: model_cache},
    secrets=[modal.Secret.from_name("sensevoice")],  # SENSEVOICE_TOKEN, CALLBACK_URL, CALLBACK_SECRET
    scaledown_window=300,   # stay warm 5 min after a job (older Modal: container_idle_timeout)
    timeout=1800,           # a background job may run a while (cold start + long audio)
)
class SenseVoice:
    @modal.enter()
    def load(self):
        import torch, opencc
        from funasr import AutoModel
        self.cc = opencc.OpenCC("s2hk")
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.model = AutoModel(
            model="iic/SenseVoiceSmall", trust_remote_code=True,
            vad_model="fsmn-vad", vad_kwargs={"max_single_segment_time": 30000},
            punc_model="ct-punc",       # REQUIRED with spk_model: sentence assembly reads punc_res
            spk_model="cam++", device=self.device, disable_update=True,
        )
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

    def _transcribe(self, wav_path, duration_ms):
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
        res = self.model.generate(input=wav_path, cache={}, language="yue", use_itn=True, batch_size_s=300)
        info = res[0].get("sentence_info")
        segments = []
        if info:
            for seg in info:
                text = self.cc.convert(rich_transcription_postprocess(seg.get("text", "")).strip())
                if not text:
                    continue
                segments.append({
                    "start_ms": int(seg["start"]), "end_ms": int(seg["end"]),
                    "spk": int(seg.get("spk", 0)), "text": text,
                })
        else:
            text = self.cc.convert(rich_transcription_postprocess(res[0].get("text", "")).strip())
            if text:
                segments.append({"start_ms": 0, "end_ms": duration_ms, "spk": 0, "text": text})
        return segments

    def _transcribe_plain(self, wav_path, duration_ms):
        """Fallback when the diarization pipeline errors: plain SenseVoice, one whole-file segment."""
        from funasr import AutoModel
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
        if not hasattr(self, "plain_model"):
            self.plain_model = AutoModel(
                model="iic/SenseVoiceSmall", trust_remote_code=True,
                vad_model="fsmn-vad", vad_kwargs={"max_single_segment_time": 30000},
                device=self.device, disable_update=True,
            )
        res = self.plain_model.generate(input=wav_path, cache={}, language="yue", use_itn=True, batch_size_s=300)
        text = self.cc.convert(rich_transcription_postprocess(res[0].get("text", "")).strip())
        return [{"start_ms": 0, "end_ms": duration_ms, "spk": 0, "text": text}] if text else []

    @modal.method()
    def run(self, audio_url: str, job_id: str):
        """Background job: download -> transcribe -> POST the result to the Supabase callback."""
        import os, tempfile, subprocess, requests

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

                try:
                    segments = self._transcribe(wav, duration_ms)
                except Exception as e:  # noqa: BLE001
                    print("diarized transcribe failed, falling back to plain:", e)
                    segments = self._transcribe_plain(wav, duration_ms)
            report({"segments": segments, "duration_ms": duration_ms})
        except Exception as e:  # noqa: BLE001
            report({"error": str(e)[:300]})


# Lightweight CPU web endpoint: authenticate, spawn the GPU job, return immediately.
# Slim image (fastapi only) so the ack path never waits on the multi-GB GPU image.
web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.6")


@app.function(image=web_image, secrets=[modal.Secret.from_name("sensevoice")])
@modal.fastapi_endpoint(method="POST", docs=False)
def transcribe(data: dict, authorization: str = Header(default=None)):
    import os
    if not authorization or authorization != "Bearer " + os.environ["SENSEVOICE_TOKEN"]:
        raise HTTPException(status_code=401, detail="unauthorized")
    audio_url = (data or {}).get("audio_url")
    job_id = (data or {}).get("job_id")
    if not audio_url or not job_id:
        raise HTTPException(status_code=400, detail="audio_url and job_id required")
    SenseVoice().run.spawn(audio_url, job_id)   # fire-and-forget; result arrives via the callback
    return {"spawned": True, "job_id": job_id}
