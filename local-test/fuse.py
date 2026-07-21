#!/usr/bin/env python3
"""
本地字幕：VAD 切片 → 雙軌 STT（mlx-whisper + SenseVoice）→ Gemini 逐句融合 → SRT。
完全喺你部 Mac（Apple Silicon）行，唔使 Modal、唔使畀錢。淨係融合嗰步用 Gemini API。

  Whisper large-v3-turbo（準＋快，mlx GPU）
        +                                    → Gemini 逐句溝（id 對齊）→ 最終字幕
  SenseVoice-Small（口語地道，CPU 飛快）          準 + 原汁原味 + 執錯字 + 事件標註，粗口照留

流程（同 Ming 個 plan）：
  0. PyAV 解碼 → 16kHz 單聲道（唔使 ffmpeg CLI）
  1. Whisper 成檔一次過轉（內置 VAD 分句 → 時間軸＋信心；快幾十倍，唔使逐 chunk 跑）
  2. SenseVoice 逐句補刀（細 model，CPU 快）
  3. Gemini 融合：每 batch 15 句、帶 id、JSON schema；id 對唔上就縮半重試；帶上一 batch 尾 2 句做上文
  4. srt library 出 .srt；<|Laughter|> 類 tag 轉 [笑聲]

用法：
  export GEMINI_API_KEY=AQ...
  python3 fuse.py 錄音.m4a               # 完整 pipeline → .srt + .txt
  python3 fuse.py 錄音.m4a --no-fuse     # 淨雙軌 STT，唔融合（對比用）
  python3 fuse.py --demo                 # 唔使裝模型，淨試「融合＋SRT」（證明 work 唔 work）

注意：Gemini 用 stdlib urllib 直接打 REST（gemini-2.5-flash + JSON schema），
唔用 google-genai SDK——少一個 native 依賴、少一個出錯位（同你原則一致）。
"""
import argparse
import json
import math
import os
import re
import sys
import tempfile
import urllib.request

# macOS：torch 同 ctranslate2/funasr 各自帶一份 OpenMP runtime（libomp），唔設呢個會撞
# 「OMP: Error #15 … libiomp5.dylib already initialized」直接 abort。必須喺 import torch 之前設。
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "").strip() or "gemini-2.5-flash"
WHISPER_REPO = "mlx-community/whisper-large-v3-turbo"
# initial_prompt 唔係「指令」——Whisper 唔識聽指令，只會「續寫」prompt 嘅文風。所以要餵一段
# 地道繁體粵文做樣辦，佢先會跟住出口語繁體；之前嗰句「請以繁體中文輸出」本身係書面語，
# 反而 prime 咗佢出書面語（成篇「什麼／哪裡／他」嘅病源之一）。
CANTO_PROMPT = ("係咁嘅，呢段係香港人吹水嘅廣東話對話。「你哋琴日去咗邊度呀？」"
                "「唔知喎，佢話嗰間嘢好貴，我哋咪冇去囉。」「係咩？咁得閒約埋佢哋一齊食啦。」")

# SenseVoice 事件 tag → 中文標註（其餘 <|…|> 一律刪走）
EVENT_TAGS = {"Laughter": "[笑聲]", "Applause": "[掌聲]", "BGM": "[音樂]",
              "Music": "[音樂]", "Cry": "[喊]", "Cough": "[咳]"}


def clean_tags(text, keep_events=True):
    def repl(m):
        return EVENT_TAGS.get(m.group(1), "") if keep_events else ""
    return re.sub(r"\s+", " ", re.sub(r"<\|(\w+)\|>", repl, text or "")).strip()


# 繁體兜底：Whisper／SenseVoice 對粵語成日嘔簡體（訓練數據多簡體字幕），prompt 引導唔係 100%。
# 裝咗 opencc（requirements 有）就逐句 s2hk 硬性轉繁，冇裝就照舊行。
try:
    from opencc import OpenCC
    _S2HK = OpenCC("s2hk")
except Exception:  # noqa: BLE001
    _S2HK = None


def to_hk(text):
    return _S2HK.convert(text) if (_S2HK and text) else (text or "")


def squash_repeats(text, keep=3):
    # Whisper 幻覺經典款：同一組字句內連環 loop（「怎样说呢?」×6、「柔」×7）。最多保留 keep 次。
    prev = None
    while text and text != prev:
        prev = text
        text = re.sub(r"(.{1,12}?)\1{" + str(keep) + r",}", lambda m: m.group(1) * keep, text)
    return text


def drop_stutter_segments(segs, keep=2):
    # 幻覺嘅另一款：連續好多段字幕一模一樣（「我覺得是」×5 段）。保留 keep 段，時間軸併埋落尾段。
    out = []
    for s in segs:
        n = 0
        for p in reversed(out):
            if p["text"] == s["text"]:
                n += 1
            else:
                break
        if n >= keep:
            out[-1]["end"] = s["end"]
        else:
            out.append(s)
    return out


# ─────────────────────── Step 0：解碼 → 16k mono float32（PyAV，唔使 ffmpeg CLI）───────────────────────
def decode_16k(src):
    # faster-whisper 內置嘅 PyAV 解碼（av package）：任何格式（mp3/m4a/mp4…）→ 16kHz mono
    # float32 numpy。用 libav 而唔係 ffmpeg 命令行，所以毋須另裝 ffmpeg。
    from faster_whisper.audio import decode_audio
    return decode_audio(src, sampling_rate=16000)


# ─────────────────────── Step 1+2a：Whisper 成檔一次過轉（時間軸＋信心）───────────────────────
# 提速關鍵（Ming 2026-07-20「太慢」）：原本 Silero 切完逐 chunk 跑 Whisper，長錄音切千幾段
# 就跑千幾次、每次都有 overhead → 十幾個鐘。改成成個檔案一 pass（faster-whisper 內置 VAD
# 分句，直接出時間軸＋avg_logprob 信心），SenseVoice 先逐句補刀。快幾十倍，結果一樣逐句。
def load_whisper():
    # Apple Silicon → mlx-whisper（Apple GPU，快）；Intel Mac／其他 → faster-whisper（CPU）
    try:
        import mlx_whisper
        print("  Whisper：mlx-whisper large-v3-turbo（Apple GPU）")
        def run(audio_np, lang="yue"):
            for lg in (lang, "zh"):
                try:
                    # condition_on_previous_text=False：防「上一句啱、跟住成分鐘 loop 同一句」嘅幻覺鏈
                    r = mlx_whisper.transcribe(audio_np, path_or_hf_repo=WHISPER_REPO,
                                               language=lg, initial_prompt=CANTO_PROMPT,
                                               condition_on_previous_text=False)
                    out = []
                    for s in r.get("segments", []):
                        t = (s.get("text") or "").strip()
                        if not t:
                            continue
                        lp = s.get("avg_logprob")
                        conf = round(min(1.0, max(0.0, math.exp(lp))), 2) if lp is not None else None
                        out.append({"start": float(s.get("start") or 0), "end": float(s.get("end") or 0),
                                    "text": t, "conf": conf})
                    if out:
                        print(f"  Whisper 語言 token：{lg}" + ("" if lg == "yue" else "（⚠️ yue 用唔到，跌咗落 zh——出書面語嘅重災區）"))
                        return out
                except Exception as e:  # noqa: BLE001
                    print(f"  ⚠️ Whisper({lg}) 失敗：{repr(e)[:120]}", file=sys.stderr)
                    continue
            return []
        return run
    except ImportError:
        pass
    # faster-whisper：跨平台（Intel Mac / Linux 都行）。turbo 快好多；CPU 用 int8。
    from faster_whisper import WhisperModel
    model = None
    for repo in ("large-v3-turbo", "large-v3"):
        try:
            model = WhisperModel(repo, device="cpu", compute_type="int8")
            print(f"  Whisper：faster-whisper {repo}（CPU int8）")
            break
        except Exception:
            continue
    if model is None:
        raise RuntimeError("faster-whisper 載入唔到 large-v3（試下 pip install -U faster-whisper）")
    def run(audio_np, lang="yue"):
        for lg in (lang, "zh"):
            try:
                segs, _ = model.transcribe(
                    audio_np, language=lg, beam_size=5, initial_prompt=CANTO_PROMPT,
                    condition_on_previous_text=False, vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 500},
                )
                out = []
                for s in segs:
                    t = (s.text or "").strip()
                    if not t:
                        continue
                    conf = round(min(1.0, max(0.0, math.exp(s.avg_logprob))), 2) if s.avg_logprob is not None else None
                    out.append({"start": float(s.start or 0), "end": float(s.end or 0), "text": t, "conf": conf})
                if out:
                    print(f"  Whisper 語言 token：{lg}" + ("" if lg == "yue" else "（⚠️ yue 用唔到，跌咗落 zh——出書面語嘅重災區）"))
                    return out
            except Exception as e:  # noqa: BLE001
                print(f"  ⚠️ Whisper({lg}) 失敗：{repr(e)[:120]}", file=sys.stderr)
                continue
        return []
    return run


def load_sensevoice():
    from funasr import AutoModel
    # SenseVoice-Small 細，CPU 已飛快，唔使爭 GPU（留 GPU 俾 mlx Whisper）
    sv = AutoModel(model="iic/SenseVoiceSmall", trust_remote_code=False,
                   device="cpu", disable_update=True)

    def run(audio_np):
        res = sv.generate(input=audio_np, cache={}, language="yue", use_itn=True, fs=16000, disable_pbar=True)
        return clean_tags(res[0].get("text", ""))
    return run


# ─────────────────────── Step 3：Gemini 融合（加固版）───────────────────────
def _gemini_array(prompt, item_schema):
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return None
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json",
                                 "responseSchema": {"type": "ARRAY", "items": item_schema}}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
    except Exception as e:  # noqa: BLE001
        print("  ⚠️  Gemini 呼叫失敗：", repr(e)[:160], file=sys.stderr)
        return None


_ITEM = {"type": "OBJECT", "properties": {"id": {"type": "INTEGER"}, "text": {"type": "STRING"}},
         "required": ["id", "text"]}


def _fuse_batch(batch, context):
    lines = "\n".join(f"[id {c['id']}] A：{c['whisper']}｜B：{c['sensevoice']}" for c in batch)
    ctx = ("（上文最尾兩句，只作語氣參考，唔好輸出）：" + " / ".join(context) + "\n\n") if context else ""
    prompt = (
        "以下係同一段廣東話錄音、逐句嘅兩個 AI 轉錄，每句有 id。\n"
        "【A】Whisper（字義較準，偏書面）｜【B】SenseVoice（口語地道，可能有錯字、含 [笑聲] 類事件標註）\n\n"
        + ctx + lines + "\n\n"
        "任務：逐句輸出改良版。以 A 嘅字義為準，寫成地道香港廣東話口語"
        "（係囉／㗎／喇／佢哋／喺度／咁樣／唔係），一律用香港繁體字，"
        "參考 B 還原口語講法同保留 [笑聲][音樂] 類事件標註。"
        "順手修正明顯錯別字，特別係同音聽錯字：按上下文執返正確嗰個寫法"
        "（人名、俗語、粗口最常中招，前後句一致嘅叫法要統一）。"
        "句內如果有 AI 轉錄幻覺式嘅無意義連環重複，執返做正常講法。"
        "粗口、語氣詞一律照留，唔准過濾。唔准加內容、唔准刪句或合併句、唔准改變意思。\n"
        "輸出 JSON array，每項 {id, text}，同輸入 id 一一對應，唔准漏 id、唔准改 id。"
    )
    arr = _gemini_array(prompt, _ITEM)
    if not isinstance(arr, list):
        return None
    got = {int(x["id"]): str(x["text"]) for x in arr if isinstance(x, dict) and "id" in x and "text" in x}
    want = {c["id"] for c in batch}
    return got if set(got) == want else None    # id 對唔上 → None（畀 caller 縮半重試）


def _fuse_with_retry(batch, context):
    res = _fuse_batch(batch, context)
    if res is not None:
        return res
    if len(batch) <= 1:                          # 縮到單句都對唔上 → 放棄，退返 Whisper
        return {c["id"]: c["whisper"] for c in batch}
    mid = len(batch) // 2
    print(f"  ↩︎ id 對唔上，縮半重試（{len(batch)}→{mid}+{len(batch)-mid}）", file=sys.stderr)
    left = _fuse_with_retry(batch[:mid], context)
    right = _fuse_with_retry(batch[mid:], context)
    return {**left, **right}


def fuse_all(chunks, batch_size=15):
    out = {}
    context = []
    for k in range(0, len(chunks), batch_size):
        batch = chunks[k:k + batch_size]
        res = _fuse_with_retry(batch, context)
        for c in batch:
            out[c["id"]] = clean_tags(res.get(c["id"], c["whisper"]))
        context = [out[c["id"]] for c in batch][-2:]   # 帶尾 2 句做下一 batch 上文
    return out


# ─────────────────────── Step 4：SRT 輸出 ───────────────────────
def _fmt(sec, comma=True):
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = int(sec % 60); ms = int(round((sec - int(sec)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d}{',' if comma else '.'}{ms:03d}"


def build_srt_text(chunks):
    try:                                           # 用 srt library（Ming plan：少一個格式出錯位）
        import datetime
        import srt
        subs = [srt.Subtitle(index=i + 1,
                              start=datetime.timedelta(seconds=c["start"]),
                              end=datetime.timedelta(seconds=c["end"]),
                              content=c["final"]) for i, c in enumerate(chunks)]
        return srt.compose(subs)
    except Exception:                              # 冇裝 srt 就用 stdlib 砌（一樣格式）
        return "\n".join(f"{i+1}\n{_fmt(c['start'])} --> {_fmt(c['end'])}\n{c['final']}\n"
                         for i, c in enumerate(chunks))


def write_srt(chunks, path):
    with open(path, "w", encoding="utf-8") as f:
        f.write(build_srt_text(chunks))


# ─────────────────────── 可重用 pipeline（CLI ＋ --serve 共用）───────────────────────
def run_pipeline(audio_path, whisper, sv, do_fuse=True, batch=15, log=print):
    log("• 解碼音訊 → 16kHz mono（PyAV，唔使 ffmpeg）…")
    audio = decode_16k(audio_path)
    dur = len(audio) / 16000
    log(f"• Whisper 成檔一次過轉（{dur/60:.1f} 分鐘音訊，內置 VAD 分句＋時間軸＋信心）…")
    segs = whisper(audio)
    if not segs:
        return []
    # 出廠前清一清：句內幻覺 loop 壓縮 → 簡轉繁（s2hk）→ 連續重複段合併
    n0 = len(segs)
    segs = drop_stutter_segments([dict(s, text=to_hk(squash_repeats(s["text"]))) for s in segs])
    if len(segs) != n0:
        log(f"  清走 {n0 - len(segs)} 段幻覺重複（{n0}→{len(segs)}）")
    chunks = [{"id": i, "start": s["start"], "end": s["end"],
               "a": max(0, int(s["start"] * 16000)), "b": min(len(audio), int(s["end"] * 16000)),
               "whisper": s["text"], "conf": s.get("conf")} for i, s in enumerate(segs)]
    log(f"  {len(chunks)} 句")
    if do_fuse and sv:
        log("• SenseVoice 逐句補刀（細 model，快）…")
        for c in chunks:
            clip = audio[c["a"]:c["b"]]
            try:
                c["sensevoice"] = to_hk(sv(clip))
            except Exception as e:  # noqa: BLE001
                c["sensevoice"] = ""
                log(f"  [{c['id']+1}] SenseVoice 跳過：{repr(e)[:80]}")
            if (c["id"] + 1) % 10 == 0 or c["id"] + 1 == len(chunks):
                log(f"  [{c['id']+1}/{len(chunks)}]")
        log("• Gemini 逐句融合…")
        fused = fuse_all(chunks, batch)
        for c in chunks:
            c["final"] = to_hk(fused[c["id"]])
    else:
        for c in chunks:
            c["sensevoice"] = ""
            c["final"] = clean_tags(c["whisper"])
    return chunks


# ─────────────────────── DEMO（唔使模型，淨試融合＋SRT）───────────────────────
DEMO = [
    {"id": 0, "start": 0.0, "end": 2.0, "whisper": "他們昨天去了哪裡", "sensevoice": "佢哋琴日去咗邊度呀"},
    {"id": 1, "start": 2.0, "end": 5.0, "whisper": "我不知道啊 可能去了那边食饭", "sensevoice": "我唔知喎 可能去咗嗰邊食飯"},
    {"id": 2, "start": 5.0, "end": 7.5, "whisper": "是的没错 就是那间很贵的餐厅", "sensevoice": "係囉冇錯 就係嗰間好貴嘅餐廳 [笑聲]"},
    {"id": 3, "start": 7.5, "end": 11.0, "whisper": "妈的 那间真的很贵 我上次去付了一千多", "sensevoice": "屌 嗰間真係好貴 我上次去俾咗一千幾"},
    {"id": 4, "start": 11.0, "end": 14.0, "whisper": "你这样说 我下次都不敢去了", "sensevoice": "你咁講我下次都唔敢去喇"},
]


def show(chunks):
    print("\n時間        Whisper（準）                    →  最終（融合後）")
    print("-" * 92)
    for c in chunks:
        print(f"{_fmt(c['start'])[:8]}  {c['whisper'][:26]:<26}  →  {c['final']}")


PAGE = """<!doctype html><html lang=zh-Hant-HK><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>本地字幕（完整 PLAN）</title>
<style>
:root{--bg:#f3f2f2;--card:#f8f4f4;--ink:#201f1d;--muted:#605d5d;--line:#d7d3d3;--accent:#a83228}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang HK",serif;background:var(--bg);color:var(--ink);line-height:1.6;padding:24px 16px 80px}
.wrap{max-width:760px;margin:0 auto}h1{font-size:1.4rem;margin-bottom:4px}.sub{color:var(--muted);font-size:.85rem;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
#drop{border:2px dashed var(--line);border-radius:12px;padding:34px 16px;text-align:center;cursor:pointer;transition:.2s}
#drop.drag,#drop:hover{border-color:var(--accent);background:#fdeeec}#drop .big{font-size:2rem}
label.chk{display:flex;gap:8px;align-items:center;font-size:.9rem;margin-top:14px;color:var(--muted)}
button{font-family:inherit;font-weight:600;cursor:pointer}
.btn{background:var(--accent);color:#fff;border:none;border-radius:10px;padding:13px 20px;font-size:.95rem;width:100%;margin-top:14px}
.btn:disabled{opacity:.45;cursor:not-allowed}.btn2{background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:9px 14px;font-size:.85rem;margin-right:8px}
#status{margin-top:14px;font-size:.85rem;color:var(--muted);white-space:pre-line}
.seg{display:flex;gap:12px;padding:8px 10px;border-bottom:1px solid var(--line);font-size:.92rem}
.seg .ts{color:var(--muted);font-size:.72rem;white-space:nowrap;padding-top:3px;font-variant-numeric:tabular-nums}
.spin{display:inline-block;width:13px;height:13px;border:2px solid var(--muted);border-top-color:transparent;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}#result{display:none}
</style></head><body><div class=wrap>
<h1>🎙️ 本地字幕（完整 PLAN）</h1>
<div class=sub>喺你部機行 · VAD → Whisper large-v3-turbo ＋ SenseVoice → Gemini 逐句融合 · 音檔唔離開部機 · 粗口照留</div>
<div class=card>
  <div id=drop><div class=big>📂</div><div>撳一下揀檔案，或者拖入嚟</div><div class=sub style="margin-top:6px">mp3 / m4a / wav / 影片都得</div></div>
  <input type=file id=file accept="audio/*,video/*" hidden>
  <div id=fileinfo class=sub style="margin-top:10px"></div>
  <label class=chk><input type=checkbox id=fuse checked> Gemini 口語收正（要 GEMINI_API_KEY）</label>
  <button class=btn id=go disabled>▶️ 開始轉字幕</button>
  <div id=status></div>
</div>
<div class=card id=result>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <b id=meta></b><span><button class=btn2 id=dlsrt>⬇️ SRT</button><button class=btn2 id=dltxt>⬇️ TXT</button></span>
  </div>
  <div id=segs></div>
</div></div>
<script>
let f=null,srt="",txt="",name="";
const $=i=>document.getElementById(i),drop=$("drop"),file=$("file");
drop.onclick=()=>file.click();
["dragenter","dragover"].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.add("drag")}));
["dragleave","drop"].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.remove("drag")}));
drop.addEventListener("drop",e=>{const g=e.dataTransfer.files[0];if(g)set(g)});
file.onchange=e=>{const g=e.target.files[0];if(g)set(g)};
function set(g){f=g;name=g.name;$("fileinfo").textContent="已揀："+g.name;$("go").disabled=false}
$("go").onclick=async()=>{
  if(!f)return;$("go").disabled=true;$("result").style.display="none";
  $("status").innerHTML='<span class=spin></span>處理緊…（第一次載模型要幾分鐘，之後快。VAD→雙軌STT→Gemini融合）';
  try{
    const r=await fetch("/api/transcribe",{method:"POST",headers:{"X-Filename":encodeURIComponent(name),"X-Fuse":$("fuse").checked?"1":"0"},body:f});
    const j=await r.json();
    if(j.error){$("status").textContent="出咗問題："+j.error;$("go").disabled=false;return}
    srt=j.srt;txt=j.txt;$("status").textContent="";
    $("meta").textContent=j.segments.length+" 段"+(j.fused?" · 已 Gemini 收正":" · Whisper-only");
    $("segs").innerHTML="";
    j.segments.forEach(s=>{const d=document.createElement("div");d.className="seg";
      d.innerHTML='<div class=ts>'+fmt(s.start)+'</div><div>'+esc(s.text)+'</div>';$("segs").appendChild(d)});
    $("result").style.display="block";
  }catch(e){$("status").textContent="出咗問題："+e}
  $("go").disabled=false;
};
function fmt(x){const h=x/3600|0,m=x%3600/60|0,s=x%60|0;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function dl(n,t){const b=new Blob([t],{type:"text/plain"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(u),900)}
$("dlsrt").onclick=()=>dl((name.replace(/\\.[^.]+$/,"")||"字幕")+".srt",srt);
$("dltxt").onclick=()=>dl((name.replace(/\\.[^.]+$/,"")||"字幕")+".txt",txt);
</script></body></html>"""


def serve(port=8765, do_fuse_default=True):
    import http.server
    import json as J
    import socketserver
    import tempfile
    import urllib.parse
    import webbrowser

    print("載入模型中（第一次要幾分鐘，之後快）…")
    whisper = load_whisper()
    sv = load_sensevoice()
    print("模型 OK。")

    class H(http.server.BaseHTTPRequestHandler):
        def _send(self, code, ctype, body):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/":
                self._send(200, "text/html; charset=utf-8", PAGE.encode())
            else:
                self._send(404, "text/plain", b"not found")

        def do_POST(self):
            if self.path != "/api/transcribe":
                self._send(404, "text/plain", b"no")
                return
            n = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(n)
            name = urllib.parse.unquote(self.headers.get("X-Filename", "audio"))
            do_fuse = self.headers.get("X-Fuse", "1") != "0"
            ext = os.path.splitext(name)[1] or ".bin"
            tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False).name
            with open(tmp, "wb") as fh:
                fh.write(data)
            try:
                chunks = run_pipeline(tmp, whisper, sv, do_fuse=do_fuse)
                segs = [{"start": c["start"], "end": c["end"], "text": c["final"]} for c in chunks]
                payload = {"segments": segs, "srt": build_srt_text(chunks),
                           "txt": "\n".join(c["final"] for c in chunks),
                           "fused": bool(do_fuse)}
                self._send(200, "application/json; charset=utf-8", J.dumps(payload, ensure_ascii=False).encode())
            except Exception as e:  # noqa: BLE001
                self._send(500, "application/json; charset=utf-8", J.dumps({"error": str(e)}).encode())
            finally:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

        def log_message(self, *a):
            pass

    with socketserver.TCPServer(("127.0.0.1", port), H) as httpd:
        url = f"http://127.0.0.1:{port}/"
        print(f"\n本地字幕網頁開咗：{url}\n（喺瀏覽器拖檔案入去就得 · Ctrl+C 收工）")
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n收工。")


def main():
    ap = argparse.ArgumentParser(description="本地 VAD→雙軌STT→Gemini融合→SRT")
    ap.add_argument("audio", nargs="?")
    ap.add_argument("--demo", action="store_true", help="唔使模型，淨試融合＋SRT")
    ap.add_argument("--serve", action="store_true", help="開個本地網頁（拖檔案就轉字幕）")
    ap.add_argument("--port", type=int, default=8765, help="--serve 用嘅 port（預設 8765）")
    ap.add_argument("--no-fuse", action="store_true", help="唔融合，淨雙軌 STT")
    ap.add_argument("--batch", type=int, default=15, help="每 batch 幾多句（預設 15）")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    if args.serve:
        serve(args.port)
        return

    if args.demo:
        print("＝＝ DEMO：淨試 Gemini 融合＋SRT（唔行模型）＝＝")
        fused = fuse_all(DEMO, args.batch)
        for c in DEMO:
            c["final"] = fused[c["id"]]
        show(DEMO)
        out = args.out or "demo.srt"
        write_srt(DEMO, out)
        print(f"\n✅ 融合＋SRT OK → {out}（粗口照留、[笑聲] 保留、id 逐句對齊）")
        return

    if not args.audio or not os.path.exists(args.audio):
        ap.error("要俾個存在嘅錄音檔，或者用 --demo／--serve")

    print("• 載模型中（第一次要幾分鐘）…")
    whisper = load_whisper()
    sv = None if args.no_fuse else load_sensevoice()
    chunks = run_pipeline(args.audio, whisper, sv, do_fuse=not args.no_fuse, batch=args.batch)
    if not chunks:
        print("❌ VAD 搵唔到人聲。"); sys.exit(1)

    show(chunks)
    base = os.path.splitext(args.out or args.audio)[0]
    write_srt(chunks, base + ".srt")
    with open(base + ".txt", "w", encoding="utf-8") as f:
        f.write("\n".join(c["final"] for c in chunks))
    print(f"\n✅ 完成：{base}.srt ／ {base}.txt（融合：{'冇' if args.no_fuse else '有'}）")


if __name__ == "__main__":
    main()
