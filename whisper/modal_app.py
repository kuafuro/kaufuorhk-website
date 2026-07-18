# Whisper large-v3 cloud transcription — Kuafuor HK「🎯 準確模式」(Subtitle Pro) · ASYNC
# 同 SenseVoice 一樣嘅 async 樣式：web endpoint 只係 spawn background GPU job 即刻返，
# 完成後 POST 去 Supabase transcribe-callback；網站 poll job row。
#
#   POST {url}   Authorization: Bearer {SENSEVOICE_TOKEN}
#   body:  { "audio_url": "<signed url>", "job_id": "<uuid>" }
#   202:   { "spawned": true, "job_id": "<uuid>" }
#
# 準確模式（產品決定：一定要準行先）：
#   + faster-whisper large-v3：廣東話準確度明顯高過 SenseVoiceSmall
#   + 逐段 confidence（avg_logprob → 0-1）：前端 highlight 低信心句俾人校
#   + 講者分離：cam++ 聲紋 embedding 逐句抽 + 自動聚類（寧缺毋濫）
#   + 雙 ASR + Gemini 融合（Ming 2026-07-19，Option B）：同一段音同時行 Whisper（準）
#     ＋ SenseVoice（口語地道），再用 Gemini 逐句融合——用 Whisper 嘅字義同時間軸/講者/
#     信心度，參考 SenseVoice 還原「係囉/㗎/喇/佢哋」口語、修正錯字。粗口照留。
#     GEMINI_API_KEY 冇 set（或者任何一步失敗）就 graceful fallback 出 Whisper-only。
#   - 背景音標註係 SenseVoice「快速模式」嘅嘢
# Modal secret "sensevoice"：SENSEVOICE_TOKEN, CALLBACK_URL, CALLBACK_SECRET,
#   GEMINI_API_KEY（optional）, GEMINI_MODEL（optional，預設 gemini-3.1-flash-lite）。
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
        # 講者分離：cam++ 聲紋 embedding（pins 照抄 sensevoice image 嘅 known-good set）
        "funasr==1.2.6",
        "torch==2.4.1",
        "torchaudio==2.4.1",
        "modelscope==1.20.1",
        "scikit-learn==1.5.1",
        "more-itertools",
    )
    .env({"HF_HOME": MODEL_DIR, "MODELSCOPE_CACHE": MODEL_DIR})
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
        # 講者分離用嘅聲紋模型（同 SenseVoice pipeline 同一個 cam++）；起唔到就冇講者標籤，唔阻轉錄
        try:
            from funasr import AutoModel
            self.spk_model = AutoModel(model="cam++", device="cuda:0", disable_update=True)
        except Exception as e:  # noqa: BLE001
            print("cam++ load failed — diarization disabled:", e)
            self.spk_model = None
        # SenseVoice：口語地道參照（俾 Gemini 融合用）；起唔到就冇融合，Whisper-only
        try:
            from funasr import AutoModel
            self.sv_model = AutoModel(
                model="iic/SenseVoiceSmall", trust_remote_code=True,
                vad_model="fsmn-vad", vad_kwargs={"max_single_segment_time": 30000},
                device="cuda:0", disable_update=True,
            )
        except Exception as e:  # noqa: BLE001
            print("SenseVoice load failed — Gemini fusion disabled:", e)
            self.sv_model = None
        model_cache.commit()

    def _sensevoice_text(self, wav_path):
        """SenseVoice 整段口語轉錄（做 Gemini 融合嘅口語參照）。失敗返空字串。"""
        if not self.sv_model:
            return ""
        try:
            from funasr.utils.postprocess_utils import rich_transcription_postprocess
            res = self.sv_model.generate(input=wav_path, cache={}, language="yue", use_itn=True, batch_size_s=300)
            info = res[0].get("sentence_info")
            if info:
                parts = [rich_transcription_postprocess(x.get("text", "")).strip() for x in info]
                text = " ".join(p for p in parts if p)
            else:
                text = rich_transcription_postprocess(res[0].get("text", "")).strip()
            return self.cc.convert(text)
        except Exception as e:  # noqa: BLE001
            print("sensevoice reference pass failed:", e)
            return ""

    def _gemini_fuse(self, segments, sv_text):
        """用 Gemini 逐句融合 Whisper（準）＋ SenseVoice（口語）。返回同 segments 等長嘅
        list of str；GEMINI_API_KEY 未 set、HTTP 錯、句數對唔上、任何 exception → None（Whisper-only）。"""
        import json
        import os

        import requests
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not key or not segments or not sv_text:
            return None
        model = os.environ.get("GEMINI_MODEL", "").strip() or "gemini-3.1-flash-lite"
        a_lines = "\n".join(f"{i}. {s['text']}" for i, s in enumerate(segments))
        prompt = (
            "以下係同一段廣東話錄音嘅兩個 AI 轉錄。\n"
            "【A】逐句轉錄（字義較準，但可能書面語化）：\n" + a_lines + "\n\n"
            "【B】另一引擎嘅整段口語轉錄（口語地道，但可能有錯字）：\n" + sv_text + "\n\n"
            "任務：逐句改良 A。每句以 A 嘅字義為準，但要寫成地道廣東話口語"
            "（係囉／㗎／喇／佢哋／喺度／咁樣／唔係／喇喎），參考 B 還原口語講法，"
            "順手修正明顯錯別字。粗口、語氣詞一律照留。唔准加內容、唔准刪句、"
            "唔准書面語化、唔准改變意思。\n"
            "只輸出一個 JSON array of strings，同 A 一樣句數、一樣次序，逐句對應。"
        )
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
                "responseSchema": {"type": "ARRAY", "items": {"type": "STRING"}},
            },
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            r = requests.post(
                url, headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                json=body, timeout=180,
            )
            if r.status_code >= 300:
                print("gemini http", r.status_code, r.text[:300])
                return None
            txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            arr = json.loads(txt)
            if isinstance(arr, list) and len(arr) == len(segments):
                return [str(x) for x in arr]
            print("gemini length mismatch:", (len(arr) if isinstance(arr, list) else "n/a"), "vs", len(segments))
            return None
        except Exception as e:  # noqa: BLE001
            print("gemini fuse failed:", e)
            return None

    def _diarize(self, wav_path, segments):
        """逐句抽 cam++ 聲紋 embedding → cosine 聚類。原則：寧缺毋濫——
        聚唔出兩個以上清晰講者、或者任何一步出事，就全部唔標（spk=None）。"""
        if not self.spk_model or len(segments) < 4:
            return [None] * len(segments)
        try:
            import numpy as np
            import torchaudio
            from sklearn.cluster import AgglomerativeClustering

            wav, sr = torchaudio.load(wav_path)          # 已係 16k mono
            audio = wav[0].numpy()
            embs, idx = [], []
            for i, s in enumerate(segments):
                a = int(s["start_ms"] * sr / 1000)
                b = int(s["end_ms"] * sr / 1000)
                if b - a < int(0.8 * sr):                # 太短嘅句抽唔到穩定聲紋
                    continue
                chunk = audio[a:b]
                try:
                    r = self.spk_model.generate(input=chunk, fs=sr, disable_pbar=True)
                    emb = r[0].get("spk_embedding")
                    if emb is None:
                        continue
                    v = np.asarray(getattr(emb, "cpu", lambda: emb)()).astype("float32").reshape(-1)
                    n = np.linalg.norm(v)
                    if n == 0:
                        continue
                    embs.append(v / n)
                    idx.append(i)
                except Exception:  # noqa: BLE001
                    continue
            if len(embs) < 4:
                return [None] * len(segments)
            X = np.stack(embs)
            labels = AgglomerativeClustering(
                n_clusters=None, distance_threshold=0.75, metric="cosine", linkage="average",
            ).fit_predict(X)
            uniq = sorted(set(labels))
            if len(uniq) < 2 or len(uniq) > 6:            # 一個講者唔使標；多過 6 個多數係聚炒咗
                return [None] * len(segments)
            # 最少嗰邊都要有返啲句先可信（防一兩粒 outlier 假裝第二個講者）
            counts = {u: int((labels == u).sum()) for u in uniq}
            if min(counts.values()) < max(2, len(embs) // 12):
                return [None] * len(segments)
            order = {}                                    # 按出場次序重新編號 0,1,2…
            out = [None] * len(segments)
            for lab, i in zip(labels, idx):
                if lab not in order:
                    order[lab] = len(order)
                out[i] = order[lab]
            for i in range(len(out)):                    # 太短冇聲紋嗰啲句跟上一句
                if out[i] is None and i > 0:
                    out[i] = out[i - 1]
            return out
        except Exception as e:  # noqa: BLE001
            print("diarization failed — no speaker labels:", e)
            return [None] * len(segments)

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
                # 講者分離（cam++ 聲紋聚類）；一有唔對路就全部 None，唔阻轉錄
                spk_ids = self._diarize(wav, segments)
                for seg, spk in zip(segments, spk_ids):
                    seg["spk"] = spk

                # Option B：SenseVoice 口語參照 → Gemini 逐句融合（還原口語 + 修錯字）。
                # 未 set GEMINI_API_KEY 就連 SenseVoice 都唔行（慳 GPU）；任何一步唔成功
                # 都 fallback 出 Whisper-only，時間軸/講者/信心度不變。
                fused = None
                if os.environ.get("GEMINI_API_KEY", "").strip():
                    sv_text = self._sensevoice_text(wav)
                    if sv_text:
                        fused = self._gemini_fuse(segments, sv_text)
                if fused:
                    for seg, t in zip(segments, fused):
                        t = self.cc.convert((t or "").strip())
                        if t:
                            seg["text"] = t
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
