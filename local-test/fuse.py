#!/usr/bin/env python3
"""
本地測試：Whisper large-v3（準＋時間軸＋信心）＋ SenseVoice（口語地道）→ Gemini 逐句融合。
完全喺你部機行，唔使 Modal、唔使畀錢。淨係融合嗰步用 Gemini API（你已經有 key）。

  Whisper（準字＋時間軸＋講者＋信心度）
        +                                → Gemini 逐句溝 → 最終字幕
  SenseVoice（口語地道）                    準 + 原汁原味 + 執錯字，粗口照留

用法：
  export GEMINI_API_KEY=AQ...            # 你個 Gemini key（Modal 用緊嗰個）
  python fuse.py 錄音.m4a                 # 完整 pipeline，出 .srt + .txt
  python fuse.py 錄音.m4a --diarize       # 加講者分離（cam++，慢啲）
  python fuse.py --demo                   # 唔使裝 torch，淨係試 Gemini 融合（證明 work 唔 work）
  python fuse.py 錄音.m4a --no-fuse       # 淨要 Whisper 結果，唔做融合（對比用）

第一次行會自動載模型（Whisper large-v3 ~3GB、SenseVoice ~1GB），之後有 cache 就快。
邏輯同 whisper/modal_app.py（Modal 上面跑嗰個）一致，只係 device 改成本機（mps/cuda/cpu）。
"""
import argparse
import json
import math
import os
import sys
import urllib.request


# ─────────────────────────── Gemini 融合（同 modal_app._gemini_fuse 一致）───────────────────────────
def gemini_fuse(segments, sv_text):
    """逐句融合 Whisper（準）＋ SenseVoice（口語）。返回同 segments 等長 list[str]；
    冇 key／HTTP 錯／句數對唔上／任何 exception → None（即係退返 Whisper-only）。"""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key or not segments or not sv_text:
        if not key:
            print("⚠️  冇 GEMINI_API_KEY，跳過融合（淨出 Whisper）。", file=sys.stderr)
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
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        txt = data["candidates"][0]["content"]["parts"][0]["text"]
        arr = json.loads(txt)
        if isinstance(arr, list) and len(arr) == len(segments):
            return [str(x) for x in arr]
        print(f"⚠️  Gemini 句數對唔上（{len(arr) if isinstance(arr, list) else 'n/a'} vs {len(segments)}），退返 Whisper。", file=sys.stderr)
        return None
    except Exception as e:  # noqa: BLE001
        print("⚠️  Gemini 融合失敗，退返 Whisper：", repr(e), file=sys.stderr)
        return None


# ─────────────────────────── OpenCC：簡→港繁（有裝先用）───────────────────────────
def _make_cc():
    try:
        from opencc import OpenCC
        return OpenCC("s2hk")
    except Exception:  # noqa: BLE001
        return None


def _conv(cc, s):
    return cc.convert(s) if cc else s


# ─────────────────────────── Whisper large-v3（準＋時間軸＋信心）───────────────────────────
def run_whisper(audio, lang):
    from faster_whisper import WhisperModel
    try:
        import torch
        cuda = torch.cuda.is_available()
    except Exception:  # noqa: BLE001
        cuda = False
    # faster-whisper（CTranslate2）：CUDA 用 float16，其餘（Mac 都係）行 CPU int8——Mac 短片夠快。
    device, compute = ("cuda", "float16") if cuda else ("cpu", "int8")
    print(f"• Whisper large-v3 載入中（device={device}）…")
    model = WhisperModel("large-v3", device=device, compute_type=compute)
    print(f"• 轉錄中（language={lang}）…")
    try:
        gen, _ = model.transcribe(audio, language=lang, vad_filter=True, beam_size=5)
        segs = list(gen)
    except Exception as e:  # noqa: BLE001
        if lang == "yue":
            print("  yue 出事，自動退 zh 再試…", repr(e))
            gen, _ = model.transcribe(audio, language="zh", vad_filter=True, beam_size=5)
            segs = list(gen)
        else:
            raise
    out = []
    for s in segs:
        t = (s.text or "").strip()
        if not t:
            continue
        conf = round(min(1.0, max(0.0, math.exp(s.avg_logprob))), 2)  # avg_logprob → 0..1 信心
        out.append({"start": s.start or 0.0, "end": s.end or 0.0, "text": t, "conf": conf, "spk": None})
    return out


# ─────────────────────────── SenseVoice（口語地道，做融合嘅 B 參照）───────────────────────────
def run_sensevoice(audio, cc):
    try:
        import torch
        dev = "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() \
            else ("cuda" if torch.cuda.is_available() else "cpu")
    except Exception:  # noqa: BLE001
        dev = "cpu"
    from funasr import AutoModel
    from funasr.utils.postprocess_utils import rich_transcription_postprocess
    print(f"• SenseVoice 載入中（device={dev}）…")
    sv = AutoModel(model="iic/SenseVoiceSmall", trust_remote_code=False, device=dev, disable_update=True)
    res = sv.generate(input=audio, cache={}, language="yue", use_itn=True, batch_size_s=300)
    info = res[0].get("sentence_info")
    if info:
        parts = [rich_transcription_postprocess(x.get("text", "")).strip() for x in info]
        text = " ".join(p for p in parts if p)
    else:
        text = rich_transcription_postprocess(res[0].get("text", "")).strip()
    return _conv(cc, text)


# ─────────────────────────── 講者分離（cam++，可選；寧缺毋濫）───────────────────────────
def diarize(audio, segments):
    if len(segments) < 4:
        return
    try:
        import numpy as np
        import torchaudio
        from funasr import AutoModel
        from sklearn.cluster import AgglomerativeClustering
        spk = AutoModel(model="iic/speech_campplus_sv_zh-cn_16k-common", disable_update=True)
        wav, sr = torchaudio.load(audio)
        if wav.shape[0] > 1:
            wav = wav.mean(0, keepdim=True)
        embs = []
        for s in segments:
            a, b = int((s["start"]) * sr), int((s["end"]) * sr)
            clip = wav[:, max(0, a):max(a + 1, b)]
            r = spk.generate(input=clip.squeeze(0).numpy(), disable_pbar=True)
            embs.append(np.asarray(r[0]["spk_embedding"]).ravel())
        if len(embs) < 4:
            return
        X = np.vstack(embs)
        cl = AgglomerativeClustering(n_clusters=None, distance_threshold=0.75,
                                     metric="cosine", linkage="average").fit(X)
        labels = cl.labels_
        n = len(set(labels))
        if n < 2 or n > 6:  # 聚唔出 2–6 個清晰講者就唔標
            return
        for s, lab in zip(segments, labels):
            s["spk"] = int(lab)
    except Exception as e:  # noqa: BLE001
        print("  講者分離跳過：", repr(e))


# ─────────────────────────── SRT / 顯示 ───────────────────────────
def fmt_ts(sec):
    h = int(sec // 3600); m = int((sec % 3600) // 60); s = int(sec % 60); ms = int((sec - int(sec)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(segments):
    multi = len({s["spk"] for s in segments if s["spk"] is not None}) > 1
    lines = []
    for i, s in enumerate(segments, 1):
        pre = f"講者{s['spk']+1}：" if (multi and s["spk"] is not None) else ""
        lines.append(f"{i}\n{fmt_ts(s['start'])} --> {fmt_ts(s['end'])}\n{pre}{s['text']}\n")
    return "\n".join(lines)


DEMO_SEGMENTS = [
    {"start": 0.0, "end": 2.0, "spk": 0, "conf": 0.88, "text": "他們昨天去了哪裡"},
    {"start": 2.0, "end": 5.0, "spk": 1, "conf": 0.61, "text": "我不知道啊 可能去了那边食饭"},
    {"start": 5.0, "end": 8.0, "spk": 0, "conf": 0.83, "text": "是的没错 就是那间很贵的餐厅"},
    {"start": 8.0, "end": 12.0, "spk": 1, "conf": 0.55, "text": "妈的 那间真的很贵 我上次去付了一千多"},
    {"start": 12.0, "end": 15.0, "spk": 0, "conf": 0.79, "text": "你这样说 我下次都不敢去了"},
]
DEMO_SV = ("佢哋琴日去咗邊度呀 我唔知喎 可能去咗嗰邊食飯 係囉冇錯 就係嗰間好貴嘅餐廳 "
           "屌 嗰間真係好貴 我上次去俾咗一千幾 你咁講我下次都唔敢去喇")


def show(segments, fused):
    print("\n時間        講者  信心   Whisper（準）                    →  最終（融合後）")
    print("-" * 100)
    for i, s in enumerate(segments):
        spk = f"講者{s['spk']+1}" if s["spk"] is not None else "  —  "
        final = fused[i] if fused else s["text"]
        print(f"{fmt_ts(s['start'])[:8]}  {spk}  {s['conf']:.2f}   {s['text'][:26]:<26}  →  {final}")


def main():
    ap = argparse.ArgumentParser(description="本地 Whisper+SenseVoice→Gemini 融合測試")
    ap.add_argument("audio", nargs="?", help="錄音／片段檔（mp3/m4a/wav/mp4…）")
    ap.add_argument("--demo", action="store_true", help="唔使裝 torch，淨試 Gemini 融合")
    ap.add_argument("--no-fuse", action="store_true", help="唔做融合，淨出 Whisper")
    ap.add_argument("--diarize", action="store_true", help="加講者分離（cam++）")
    ap.add_argument("--lang", default="yue", help="Whisper 語言（預設 yue）")
    ap.add_argument("--out", default=None, help="輸出檔名（唔寫就用輸入檔名）")
    args = ap.parse_args()

    cc = _make_cc()

    if args.demo:
        print("＝＝ DEMO：唔行模型，淨試 Gemini 融合（證明融合階段 work 唔 work）＝＝")
        fused = gemini_fuse(DEMO_SEGMENTS, DEMO_SV)
        show(DEMO_SEGMENTS, fused)
        print("\n" + ("✅ 融合成功——粗口照留、書面→地道、句數對齊。" if fused else "❌ 融合冇行到（睇上面警告）。"))
        return

    if not args.audio:
        ap.error("要俾個錄音檔，或者用 --demo 淨試融合")
    if not os.path.exists(args.audio):
        ap.error(f"搵唔到檔案：{args.audio}")

    segments = run_whisper(args.audio, args.lang)
    if not segments:
        print("❌ Whisper 轉唔到嘢（可能靜音或格式問題）。"); sys.exit(1)
    for s in segments:
        s["text"] = _conv(cc, s["text"])

    if args.diarize:
        print("• 講者分離中…")
        diarize(args.audio, segments)

    fused = None
    if not args.no_fuse:
        print("• 行 SenseVoice 攞口語參照…")
        try:
            sv_text = run_sensevoice(args.audio, cc)
        except Exception as e:  # noqa: BLE001
            print("  SenseVoice 出事，跳過融合：", repr(e)); sv_text = ""
        if sv_text:
            print("• Gemini 逐句融合…")
            fused = gemini_fuse(segments, sv_text)

    if fused:
        for i, s in enumerate(segments):
            s["text"] = fused[i]  # 融合只換文字，時間軸／講者／信心不變

    show(segments, None)

    base = os.path.splitext(args.out or args.audio)[0]
    srt = build_srt(segments)
    with open(base + ".srt", "w", encoding="utf-8") as f:
        f.write(srt)
    with open(base + ".txt", "w", encoding="utf-8") as f:
        f.write("\n".join(s["text"] for s in segments))
    print(f"\n✅ 完成：{base}.srt ／ {base}.txt"
          f"（融合：{'有' if fused else '冇（Whisper-only）'}）")


if __name__ == "__main__":
    main()
