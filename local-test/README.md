# 本地字幕測試（holder／技術人員用）

喺自己部 **Mac（Apple Silicon）** 行完整條 pipeline，睇 **work 唔 work**——**唔使 Modal、唔使畀錢**。

```
Whisper large-v3-turbo（準＋快，mlx GPU）
      +                                      → Gemini 逐句溝（id 對齊）→ 最終字幕
SenseVoice-Small（口語地道，CPU 飛快）             準 + 原汁原味 + 執錯字 + [笑聲] 標註，粗口照留
```

**流程**：PyAV 解碼 16k → **Whisper 成檔一次過轉**（內置 VAD 分句，直接出時間軸＋信心；唔逐 chunk 跑，快幾十倍）→ 清幻覺＋簡轉繁＋**併短段**（碎片併返做完整句先落下一步）→ SenseVoice 逐句補刀（細 model，快）→ Gemini 逐句融合（每 batch 15 句、帶 id、id 對唔上就縮半重試、帶上文 2 句）→ `srt` 出字幕。

---

## 本地網頁（＝你部機當個網站，最似「website 咁用」）

裝好之後（見下面 Step 0），一句就開個本地網頁，拖檔案入去就轉，背後行**完整 PLAN**：

```bash
export GEMINI_API_KEY=AQ...
python3 fuse.py --serve            # 自動開瀏覽器 http://127.0.0.1:8765/
```

拖錄音入去 → 睇逐句字幕 → 下載 SRT／TXT。全程喺你部機（音檔唔離開部機），
用你部機資源跑 mlx Whisper ＋ SenseVoice ＋ Gemini 融合。Ctrl+C 收工。
（`--port 9000` 可以改 port。）

---

## 快速試（唔使裝模型）

淨想證明「融合＋SRT」嗰步 work 唔 work：

```bash
export GEMINI_API_KEY=AQ...          # Modal 用緊嗰個 key（Supabase Vault 有）
python3 fuse.py --demo               # 用示範對話行真 Gemini → 出 demo.srt
```

會 print「Whisper 書面版 → 融合後地道版」，證明粗口照留、`[笑聲]` 保留、id 逐句對齊。

---

## 完整跑（真錄音）

### 0. 環境（做一次）

> **唔使裝 ffmpeg**——解碼用 PyAV（`av`，隨 faster-whisper 一齊裝），本身就係 ffmpeg 嘅 library 版。

**Apple Silicon（M1/M2/M3）：**
```bash
cd local-test
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

**Intel Mac（`uname -m` 出 x86_64）：** Python 3.9+ 就得，唔使 brew。
```bash
cd local-test
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt      # Intel 會自動裝 faster-whisper（唔係 mlx）＋ 相容版本
```
Intel 冇 GPU，Whisper 行 CPU（faster-whisper large-v3-turbo int8），會慢啲但行到；SenseVoice＋Gemini 照補口語。

### 1. 行
```bash
export GEMINI_API_KEY=AQ...
python3 fuse.py 你嘅錄音.m4a          # 完整：VAD → 雙軌 STT → Gemini 融合 → .srt/.txt
python3 fuse.py 你嘅錄音.m4a --no-fuse   # 淨雙軌 STT，唔融合（對比融合前後）
python3 fuse.py 你嘅錄音.m4a --batch 10  # 調 Gemini 每 batch 句數（預設 15）
```

**單引擎 benchmark**（raw 逐字檔，唔清理唔融合，攞嚟並排對比引擎質量）：
```bash
python3 fuse.py 錄音.m4a --engine whisper      # 淨 Whisper → 錄音.whisper.raw.srt/.txt
python3 fuse.py 錄音.m4a --engine sensevoice   # 淨 SenseVoice（silero VAD 切段）→ 錄音.sensevoice.raw.srt/.txt
```

出 `你嘅錄音.srt`（字幕）＋ `你嘅錄音.txt`，terminal 亦會 print 逐句對照。

---

## 已有 .srt？直接執靚（唔使行 STT、唔使載模型）

攞住一份 raw 字幕（例如 Whisper 出咗嗰份），唔使重跑成個轉錄：

```bash
export GEMINI_API_KEY=AQ...
python3 fuse.py 舊字幕.srt              # 清幻覺 → 簡轉繁 → 併短段 → Gemini 口語化 → 舊字幕.polished.srt
python3 fuse.py 舊字幕.srt --no-fuse    # 淨清理＋併段，唔過 Gemini（唔使 key，幾秒完）
```

實測（7 分鐘 WhatsApp 錄音嘅 raw Whisper SRT）：**164 段 → 82 段**，段長中位數 **1.7s → 4.2s**，短過 2 秒嘅段由 **53% → 20%**。

**天花板要知**：Gemini 冇聽過原聲——文風、錯別字、幻覺重複、上下文推到嘅同音錯執得返；
「音都聽錯咗」嘅句執唔返。要頂級質量始終行返完整雙軌 pipeline（餵音檔嗰條路）。

---

## 要知嘅嘢

- **跨平台**：Apple Silicon 自動用 `mlx-whisper`（Apple GPU，快）；Intel Mac／Linux 自動用 `faster-whisper`（CPU，慢啲但一樣行到）。唔使自己揀。
- **第一次**自動載模型：Whisper turbo ~1.6GB、SenseVoice ~1GB，之後 cache 就快。
- **點解用 turbo 唔用 large-v3 full**：turbo 快好幾倍、廣東話準確度接近，反正有 SenseVoice ＋ Gemini 補刀執成地道口語。要極致準可以改 `WHISPER_REPO` 做 `mlx-community/whisper-large-v3`。
- **Gemini**：用 `gemini-2.5-flash` + JSON schema，stdlib `urllib` 直接打 REST（唔使 `google-genai` SDK——少一個 native 依賴、少一個出錯位）。
- **加固**：融合逐句帶 id，Gemini 一漏／一改 id 就自動縮半 batch 重試，防跳行合併行；每 batch 帶上一 batch 尾 2 句做上文，語氣連貫。任何一步（Gemini／SenseVoice）出事都自動退返 Whisper-only，唔會成個死。
- **粗口／語氣詞照留**、`[笑聲][音樂]` 事件標註保留——係產品原則，prompt 明確叫唔好過濾。
- **點解試過成篇「普通話腔」書面語**：Whisper 對粵語嘅通病——訓練數據係「粵語聲＋書面語字幕」，佢學咗「聽粵語、寫書面」。三重醫法：① `initial_prompt` 改做地道粵文樣辦（Whisper 唔識聽指令，只識續寫文風，之前嗰句書面語 prompt 反而教壞佢）；② opencc `s2hk` 兜底簡轉繁；③ **Gemini 融合先係口語化主力**——`--no-fuse` 出嗰版係 raw 對照組，唔好攞嚟判斷質量。terminal 會 print 用咗邊個語言 token（`yue` 定跌咗落 `zh`）。
- **幻覺 loop 自動清**：句內連環重複（「柔柔柔柔…」）壓返做正常長度；連續幾段一模一樣（「我覺得是」×5 段）會合併埋，時間軸保留。
- 純本地工具，同 GitHub Pages 網站無關（Pages 唔 serve／執行）。
