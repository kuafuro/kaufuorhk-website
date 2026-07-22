# 本地字幕測試（holder／技術人員用）

喺自己部 **Mac（Apple Silicon）** 行完整條 pipeline，睇 **work 唔 work**——**唔使 Modal、唔使畀錢**。

```
Whisper large-v3-turbo（準＋快，mlx GPU）
      +                                      → Gemini 逐句溝（id 對齊）→ 最終字幕
SenseVoice-Small（口語地道，CPU 飛快）             準 + 原汁原味 + 執錯字 + [笑聲] 標註，粗口照留
```

**流程**：PyAV 解碼 16k → **Whisper 成檔一次過轉**（內置 VAD 分句，直接出時間軸＋信心；唔逐 chunk 跑，快幾十倍）→ SenseVoice 逐句補刀（細 model，快）→ Gemini 逐句融合（每 batch 15 句、帶 id、id 對唔上就縮半重試、帶上文 2 句）→ `srt` 出字幕。

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

出 `你嘅錄音.srt`（字幕）＋ `你嘅錄音.txt`，terminal 亦會 print 逐句對照。

---

## 揀 Whisper model（`WHISPER_MODEL`）

唔使改 code，用環境變量揀邊個 Whisper：

```bash
python3 fuse.py 錄音.m4a                        # 預設 turbo（快）
WHISPER_MODEL=large-v3 python3 fuse.py 錄音.m4a  # large-v3 full（粵語準啲、慢兩三倍）
WHISPER_MODEL=large-v2 python3 fuse.py 錄音.m4a
WHISPER_MODEL=mlx-community/whisper-large-v3 python3 fuse.py 錄音.m4a   # 直接俾 repo 名都得
```

`turbo`／`large-v3`／`large-v2` 係邏輯名，會自動對應 mlx（Apple）或 faster-whisper（CPU）嗰邊嘅 repo。
想試埋**粵語 fine-tune**（`alvanlii`／`simonl0909`…）就用下面個擂台——嗰啲係 PyTorch 格式，
mlx／faster-whisper 唔直接食，要 transformers loader。

---

## Model 擂台（`compare_models.py`）— 揀邊個 Whisper 最準

同一條音，幾個 Whisper 逐個轉，出 side-by-side 逐字檔＋SRT，**肉眼比邊個最貼你把口**。
統一用 `transformers` 載 model，所以 openai 官方同社群粵語 fine-tune 擺得埋同一個擂台公平對比。

```bash
pip install torch transformers av          # CPU 都行；有 GPU／Apple MPS 會自動用，快好多
python3 compare_models.py 你嘅真實錄音.m4a               # 跑預設全部 5 個 model
python3 compare_models.py 錄音.m4a --models canto-small,large-v3,turbo
python3 compare_models.py 錄音.m4a --list                # 淨列有咩 model
```

擂台名單（`--models` 揀 subset，或直接俾任何 HF whisper repo 名）：

| key | repo | 係乜 |
|---|---|---|
| `turbo` | `openai/whisper-large-v3-turbo` | 你而家用緊（快） |
| `large-v3` | `openai/whisper-large-v3` | full，粵語準啲、慢 |
| `canto-small` | `alvanlii/whisper-small-cantonese` | 香港社群 fine-tune（細、快） |
| `canto-v2` | `simonl0909/whisper-large-v2-cantonese` | 粵語 fine-tune |
| `canto-v3` | `khleeloo/whisper-large-v3-cantonese` | 粵語 fine-tune |

輸出去 `<錄音>.compare/`：每個 model 一份 `.txt`（全文）＋ `.srt`（帶時間軸），加 `_compare.md`
side-by-side 對照＋字數／耗時／速度摘要。

> **緊要**：一定要用**你真實會出事嗰種音**（搭嘴／吹水／粗口／多人／嘈）落擂台。粵語 fine-tune 多數
> 用乾淨朗讀數據煉，喺乾淨音上一定靚仔，但唔代表喺你嘅嘈音一樣贏——喺真實音上先見真章。
> 冇 GPU 嘅機跑大 model 好慢（一條長音可能十幾分鐘一個），可以先剪一條 30–60 秒代表性 clip。

---

## 要知嘅嘢

- **跨平台**：Apple Silicon 自動用 `mlx-whisper`（Apple GPU，快）；Intel Mac／Linux 自動用 `faster-whisper`（CPU，慢啲但一樣行到）。唔使自己揀。
- **第一次**自動載模型：Whisper turbo ~1.6GB、SenseVoice ~1GB，之後 cache 就快。
- **點解用 turbo 唔用 large-v3 full**：turbo 快好幾倍、廣東話準確度接近，反正有 SenseVoice ＋ Gemini 補刀執成地道口語。要極致準可以揀 large-v3：`WHISPER_MODEL=large-v3 python3 fuse.py 錄音.m4a`（見下面「揀 Whisper model」）。
- **Gemini**：用 `gemini-2.5-flash` + JSON schema，stdlib `urllib` 直接打 REST（唔使 `google-genai` SDK——少一個 native 依賴、少一個出錯位）。
- **加固**：融合逐句帶 id，Gemini 一漏／一改 id 就自動縮半 batch 重試，防跳行合併行；每 batch 帶上一 batch 尾 2 句做上文，語氣連貫。任何一步（Gemini／SenseVoice）出事都自動退返 Whisper-only，唔會成個死。
- **粗口／語氣詞照留**、`[笑聲][音樂]` 事件標註保留——係產品原則，prompt 明確叫唔好過濾。
- 純本地工具，同 GitHub Pages 網站無關（Pages 唔 serve／執行）。
