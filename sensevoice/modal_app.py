# SenseVoice cloud transcription endpoint — Kuafuor HK (Subtitle Pro)
# Implements the endpoint contract in
#   docs/superpowers/specs/2026-07-15-sensevoice-cloud-transcription-design.md §5
#
#   POST {url}/transcribe   Authorization: Bearer {SENSEVOICE_TOKEN}
#   body:  { "audio_url": "<signed url>", "language": "yue", "diarize": true }
#   200:   { "segments": [ { "start_ms", "end_ms", "spk", "text" } ], "duration_ms": <int> }
#   401 unauthorized · 400 bad request · 413 audio too long · 500 transcription failed
#
# The heavy libs (funasr/torch/opencc/requests) are imported INSIDE the container methods
# on purpose — this file is also executed locally by `modal deploy` to build the app graph,
# and the local machine only has `modal` installed, not the GPU stack.
#
# Deploy + get your URL/TOKEN: see sensevoice/README.md
# SenseVoice / FunASR © Alibaba — commercial use permitted with attribution.

import modal

# fastapi is needed LOCALLY too: `Header(...)` in the endpoint signature is evaluated when
# `modal deploy` builds the app graph on your machine. If this import fails, run
# `pip install fastapi` alongside `modal` (see README). It is also in the container image.
from fastapi import Header, HTTPException

app = modal.App("kuafuor-sensevoice")

# Model weights are cached in a Volume so we download once, not on every cold start.
MODEL_DIR = "/models"
model_cache = modal.Volume.from_name("kuafuor-sensevoice-cache", create_if_missing=True)

# Reject audio longer than this to hard-cap per-request GPU cost (spec §5 "Limits").
# The real per-user monthly cap lives in the Edge Function quota; this is a per-file backstop.
MAX_MINUTES = 120

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "funasr==1.2.6",
        "torch==2.4.1",
        "torchaudio==2.4.1",
        "opencc-python-reimplemented==0.1.7",
        "modelscope==1.20.1",
        "requests==2.32.3",
        "fastapi[standard]==0.115.6",
    )
    # FunASR downloads from ModelScope by default; point its cache at the mounted Volume.
    .env({"MODELSCOPE_CACHE": MODEL_DIR, "HF_HOME": MODEL_DIR})
)


@app.cls(
    gpu="T4",
    image=image,
    volumes={MODEL_DIR: model_cache},
    secrets=[modal.Secret.from_name("sensevoice")],  # provides SENSEVOICE_TOKEN
    scaledown_window=300,   # scale to zero 5 min after the last request (older Modal: container_idle_timeout)
    timeout=900,            # allow long files to finish a cold start + transcribe
)                           # min_containers defaults to 0 -> no always-on cost; first request pays a cold start
class SenseVoice:
    @modal.enter()
    def load(self):
        """Runs once per container start. Loads SenseVoice + VAD + speaker model onto the GPU."""
        import torch
        import opencc
        from funasr import AutoModel

        self.cc = opencc.OpenCC("s2hk")  # Simplified -> Traditional (Hong Kong standard)
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.model = AutoModel(
            model="iic/SenseVoiceSmall",
            trust_remote_code=True,
            vad_model="fsmn-vad",
            vad_kwargs={"max_single_segment_time": 30000},
            spk_model="cam++",          # speaker diarization -> per-sentence `spk`
            device=self.device,
            disable_update=True,        # don't phone home for a version check on every start
        )
        model_cache.commit()            # persist any freshly downloaded weights to the Volume

    def _probe_ms(self, path):
        """Audio duration in ms via ffprobe (used for the length limit AND billing minutes)."""
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
        """Run SenseVoice; return (segments, duration_ms) per the §5 contract."""
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        res = self.model.generate(
            input=wav_path, cache={}, language="yue", use_itn=True, batch_size_s=300,
        )
        info = res[0].get("sentence_info")
        segments = []
        if info:
            for seg in info:
                text = self.cc.convert(rich_transcription_postprocess(seg.get("text", "")).strip())
                if not text:
                    continue
                segments.append({
                    "start_ms": int(seg["start"]),
                    "end_ms": int(seg["end"]),
                    "spk": int(seg.get("spk", 0)),
                    "text": text,
                })
        else:
            # Diarization/VAD produced no sentence breakdown -> fall back to one whole-file segment.
            text = self.cc.convert(rich_transcription_postprocess(res[0].get("text", "")).strip())
            if text:
                segments.append({"start_ms": 0, "end_ms": duration_ms, "spk": 0, "text": text})
        return segments

    @modal.fastapi_endpoint(method="POST", docs=False)
    def transcribe(self, data: dict, authorization: str = Header(default=None)):
        import os
        import tempfile
        import subprocess
        import requests

        # --- auth: constant string compare against the Modal secret ---
        expected = "Bearer " + os.environ["SENSEVOICE_TOKEN"]
        if not authorization or authorization != expected:
            raise HTTPException(status_code=401, detail="unauthorized")

        audio_url = (data or {}).get("audio_url")
        if not audio_url or not isinstance(audio_url, str):
            raise HTTPException(status_code=400, detail="audio_url required")

        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src")
            wav = os.path.join(tmp, "audio.wav")

            # --- download the signed audio (stream; cap at ~500 MB to avoid a runaway file) ---
            try:
                with requests.get(audio_url, stream=True, timeout=120) as r:
                    r.raise_for_status()
                    total = 0
                    with open(src, "wb") as f:
                        for chunk in r.iter_content(chunk_size=1 << 20):
                            total += len(chunk)
                            if total > 500 * (1 << 20):
                                raise HTTPException(status_code=413, detail="audio too large")
                            f.write(chunk)
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"could not fetch audio_url: {e}")

            # --- normalise to 16 kHz mono wav (most robust input for FunASR) ---
            norm = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", wav],
                capture_output=True, text=True,
            )
            if norm.returncode != 0 or not os.path.exists(wav):
                raise HTTPException(status_code=400, detail="unsupported or corrupt audio")

            duration_ms = self._probe_ms(wav)
            if duration_ms > MAX_MINUTES * 60 * 1000:
                raise HTTPException(status_code=413, detail=f"audio exceeds {MAX_MINUTES} min limit")

            try:
                segments = self._transcribe(wav, duration_ms)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"transcription failed: {e}")

        return {"segments": segments, "duration_ms": duration_ms}


# `modal run sensevoice/modal_app.py` -> pre-download the weights into the Volume once,
# so the first live request after `modal deploy` isn't a multi-minute cold download.
@app.function(image=image, volumes={MODEL_DIR: model_cache}, gpu="T4", timeout=1800)
def prewarm():
    from funasr import AutoModel
    AutoModel(
        model="iic/SenseVoiceSmall", trust_remote_code=True,
        vad_model="fsmn-vad", spk_model="cam++", disable_update=True,
    )
    model_cache.commit()
    print("✓ SenseVoice + fsmn-vad + cam++ weights cached in the Volume")


@app.local_entrypoint()
def main():
    prewarm.remote()
