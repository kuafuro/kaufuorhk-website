#!/usr/bin/env python3
"""
Model 擂台：同一條音，幾個 Whisper model 逐個轉，出 side-by-side 逐字檔 ＋ SRT，肉眼比邊個準。

點解要有呢個：fuse.py 而家用 large-v3-turbo，但粵語仲有社群 fine-tune（alvanlii／simonl0909／
khleeloo）同 large-v3 full。邊個喺「你嗰種音」（搭嘴／吹水／粗口／多人）上最準，冇得靠估——
攞你一條真實 clip 跑一次就知。乾淨朗讀 clip 對 fine-tune 有利，唔代表真實嘈音一樣贏，所以一定要
用你真實會出事嗰種音落擂台。

統一用 transformers pipeline 載 model：呢個係唯一一個 openai 官方（mlx／CT2 以外）同社群 PyTorch
fine-tune 都食得嘅 loader，所以乜格式嘅 whisper repo 都擺得上同一個擂台，公平對比。

用法：
  python3 compare_models.py 你嘅錄音.m4a                      # 跑預設全部 model
  python3 compare_models.py 錄音.m4a --models canto-small,large-v3
  python3 compare_models.py 錄音.m4a --models all --language yue
  python3 compare_models.py 錄音.m4a --list                   # 淨列 model，唔跑

輸出：<錄音>.compare/ 入面每個 model 一份 .txt（全文）＋ .srt（帶時間軸），
     加 _compare.md side-by-side 對照 ＋ 字數／耗時／速度摘要。

依賴：pip install torch transformers av
     （CPU 都行，但大 model 慢；有 CUDA／Apple MPS 會自動用，快好多。）
"""
import argparse
import gc
import os
import sys
import time

# 同 fuse.py 一致：torch 同其他 native lib 各帶一份 OpenMP，macOS 唔設呢個會撞 OMP Error #15。
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

# 邏輯名 → HF repo。統一 transformers 格式（openai 官方 ＋ 社群 PyTorch fine-tune 都食得）。
MODELS = {
    "turbo":       "openai/whisper-large-v3-turbo",     # 你而家用緊（full 版，非 mlx）
    "large-v3":    "openai/whisper-large-v3",            # full，粵語準啲、慢兩三倍
    "canto-small": "alvanlii/whisper-small-cantonese",  # 香港社群 fine-tune（細、快）
    "canto-v2":    "simonl0909/whisper-large-v2-cantonese",
    "canto-v3":    "khleeloo/whisper-large-v3-cantonese",
}
DEFAULT_ORDER = ["turbo", "large-v3", "canto-small", "canto-v2", "canto-v3"]


# ─────────────────────── 解碼 → 16k mono float32（PyAV，唔使 ffmpeg CLI；同 fuse.py 一致）───────────────────────
def decode_16k(path):
    import av
    import numpy as np
    container = av.open(path)
    try:
        stream = next(s for s in container.streams if s.type == "audio")
    except StopIteration:
        container.close()
        raise RuntimeError("檔案冇音軌")
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    parts = []
    for frame in container.decode(stream):
        for rf in resampler.resample(frame):
            parts.append(rf.to_ndarray().reshape(-1))
    for rf in resampler.resample(None):        # flush 尾段
        parts.append(rf.to_ndarray().reshape(-1))
    container.close()
    if not parts:
        raise RuntimeError("解碼唔到音訊")
    return np.concatenate(parts).astype("float32") / 32768.0


# ─────────────────────── 裝置揀選 ───────────────────────
def pick_device():
    import torch
    if torch.cuda.is_available():
        return torch.device("cuda"), torch.float16
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return torch.device("mps"), torch.float16
    return torch.device("cpu"), torch.float32


# ─────────────────────── SRT 砌（stdlib，唔使 srt library）───────────────────────
def _ts(sec):
    sec = max(0.0, float(sec or 0.0))
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = int(sec % 60); ms = int(round((sec - int(sec)) * 1000))
    if ms == 1000:
        s += 1; ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(chunks):
    out, idx = [], 1
    for c in chunks:
        text = (c.get("text") or "").strip()
        if not text:
            continue
        ts = c.get("timestamp") or (None, None)
        st = ts[0] if ts[0] is not None else 0.0
        en = ts[1] if ts[1] is not None else st + 2.0
        out.append(f"{idx}\n{_ts(st)} --> {_ts(en)}\n{text}\n")
        idx += 1
    return "\n".join(out)


# ─────────────────────── 跑一個 model ───────────────────────
def run_model(key, repo, audio, device, dtype, language, chunk_s=28):
    from transformers import pipeline

    print(f"\n▶ [{key}] 載入 {repo} …", flush=True)
    t0 = time.time()
    try:
        try:      # transformers ≥5 用 dtype；舊版用 torch_dtype
            pipe = pipeline("automatic-speech-recognition", model=repo, dtype=dtype, device=device)
        except TypeError:
            pipe = pipeline("automatic-speech-recognition", model=repo, torch_dtype=dtype, device=device)
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ 載入失敗：{repr(e)[:160]}", flush=True)
        return {"key": key, "repo": repo, "ok": False, "err": repr(e)[:200], "load_t": time.time() - t0}
    load_t = time.time() - t0
    print(f"  載入 OK（{load_t:.0f}s），轉錄中…", flush=True)

    batch = 8 if device.type != "cpu" else 4
    # 有啲 fine-tune（whisper-small／large-v2 底）冇 yue token → 逐個語言試落去。
    tries, seen = [], set()
    for lg in ([language, "zh", None] if language else ["zh", None]):
        if lg not in seen:
            seen.add(lg); tries.append(lg)

    last_err = None
    for lg in tries:
        gen = {"task": "transcribe"}
        if lg:
            gen["language"] = lg
        try:
            t1 = time.time()
            res = pipe({"raw": audio, "sampling_rate": 16000},
                       chunk_length_s=chunk_s, stride_length_s=(6, 3),
                       batch_size=batch, return_timestamps=True, generate_kwargs=gen)
            infer_t = time.time() - t1
            chunks = res.get("chunks") or [{"text": res.get("text", ""), "timestamp": (0.0, None)}]
            text = (res.get("text") or "").strip()
            print(f"  ✓ 完成（語言={lg or 'auto'}，{infer_t:.0f}s，{len(text)} 字）", flush=True)
            del pipe; gc.collect()
            return {"key": key, "repo": repo, "ok": True, "lang": lg or "auto",
                    "text": text, "chunks": chunks, "load_t": load_t, "infer_t": infer_t}
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"  ↩︎ 語言={lg or 'auto'} 唔得（{repr(e)[:80]}），試下一個…", flush=True)

    del pipe; gc.collect()
    return {"key": key, "repo": repo, "ok": False, "err": repr(last_err)[:200], "load_t": load_t}


# ─────────────────────── 輸出 ───────────────────────
def write_outputs(results, out_dir, audio_name, dur, device, language):
    os.makedirs(out_dir, exist_ok=True)
    for r in results:
        if not r.get("ok"):
            continue
        with open(os.path.join(out_dir, f"{r['key']}.txt"), "w", encoding="utf-8") as f:
            f.write(r["text"] + "\n")
        with open(os.path.join(out_dir, f"{r['key']}.srt"), "w", encoding="utf-8") as f:
            f.write(build_srt(r["chunks"]))

    md = [f"# Model 擂台：{audio_name}", "",
          f"- 音長 **{dur:.1f}s**　裝置 **{device.type}**　強制語言 **{language or 'auto'}**",
          f"- 生成日期由執行環境決定；同一條音、同一組參數，逐個 model 公平對比。", "",
          "## 摘要", "",
          "| model | repo | 語言 | 字數 | 載入(s) | 轉錄(s) | 速度(×實時) | 狀態 |",
          "|---|---|---|---:|---:|---:|---:|---|"]
    for r in results:
        if r.get("ok"):
            rtf = (dur / r["infer_t"]) if r.get("infer_t") else 0
            md.append(f"| **{r['key']}** | `{r['repo']}` | {r['lang']} | {len(r['text'])} | "
                      f"{r['load_t']:.0f} | {r['infer_t']:.0f} | {rtf:.2f}× | ✓ |")
        else:
            md.append(f"| **{r['key']}** | `{r['repo']}` | – | – | {r.get('load_t',0):.0f} | – | – | ✗ {r.get('err','')} |")
    md += ["", "## 全文對照（肉眼比邊個最貼你把口）", ""]
    for r in results:
        md.append(f"### {r['key']}　`{r['repo']}`")
        md.append("")
        md.append("```")
        md.append(r["text"] if r.get("ok") else f"（失敗：{r.get('err')}）")
        md.append("```")
        md.append("")
    with open(os.path.join(out_dir, "_compare.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md))


def main():
    ap = argparse.ArgumentParser(description="幾個 Whisper model 同一條音對比")
    ap.add_argument("audio", nargs="?", help="錄音／影片檔（任何格式）")
    ap.add_argument("--models", default="all",
                    help="逗號分隔 key（turbo,large-v3,canto-small,canto-v2,canto-v3）或 'all'，"
                         "亦可直接俾 HF repo 名")
    ap.add_argument("--language", default="yue", help="強制語言（預設 yue；model 唔識就自動退 zh→auto）")
    ap.add_argument("--out", default=None, help="輸出資料夾（預設 <音檔>.compare）")
    ap.add_argument("--list", action="store_true", help="淨列 model，唔跑")
    args = ap.parse_args()

    if args.list:
        print("可用 model key：")
        for k in DEFAULT_ORDER:
            print(f"  {k:12s} {MODELS[k]}")
        print("\n（亦可用 --models 直接俾任何 HF whisper repo 名）")
        return

    if not args.audio or not os.path.exists(args.audio):
        ap.error("要俾一個存在嘅錄音／影片檔（或用 --list 睇有咩 model）")

    # 揀 model
    if args.models.strip().lower() == "all":
        chosen = [(k, MODELS[k]) for k in DEFAULT_ORDER]
    else:
        chosen = []
        for tok in args.models.split(","):
            tok = tok.strip()
            if not tok:
                continue
            chosen.append((tok, MODELS[tok]) if tok in MODELS else (tok.replace("/", "_"), tok))
    if not chosen:
        ap.error("--models 揀唔到任何 model")

    print(f"• 解碼 {args.audio} → 16kHz mono（PyAV）…", flush=True)
    audio = decode_16k(args.audio)
    dur = len(audio) / 16000
    device, dtype = pick_device()
    print(f"  {dur:.1f}s 音訊　裝置：{device.type}（dtype={dtype}）")
    print(f"  擂台名單：{', '.join(k for k, _ in chosen)}")
    if device.type == "cpu":
        print("  ⚠️  CPU 冇 GPU：大 model（large-v3／v2）會慢，一條長音可能十幾分鐘一個。"
              "想快啲：喺有 GPU 嘅機、或先剪一條 30–60 秒代表性 clip。")

    results = []
    for key, repo in chosen:
        results.append(run_model(key, repo, audio, device, dtype, args.language))

    out_dir = args.out or (os.path.splitext(args.audio)[0] + ".compare")
    write_outputs(results, out_dir, os.path.basename(args.audio), dur, device, args.language)

    ok = [r for r in results if r.get("ok")]
    print(f"\n✅ 完成 {len(ok)}/{len(results)} 個 model → {out_dir}/")
    print(f"   睇 {out_dir}/_compare.md 做 side-by-side 對照，各 model 亦有 .txt／.srt。")
    if len(ok) < len(results):
        print("   （有 model 失敗，詳情喺 _compare.md 摘要表。）")


if __name__ == "__main__":
    main()
