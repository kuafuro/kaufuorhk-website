# 本地字幕融合測試（holder／技術人員用）

喺自己部機行完整條 pipeline，睇下 **work 唔 work**——**唔使 Modal、唔使畀錢**。

```
Whisper large-v3（準字＋時間軸＋講者＋信心度）
      +                                          → Gemini 逐句溝 → 最終字幕
SenseVoice（口語地道）                              準 + 原汁原味 + 執錯字，粗口照留
```

邏輯同網站雲端跑嗰個（`whisper/modal_app.py`）**一模一樣**，只係 device 由 Modal GPU 改成你部機（Mac 用 MPS／有 NVIDIA 用 CUDA／其餘 CPU）。融合嗰步用 Gemini API（就係 Modal 用緊嗰個 key）。

---

## 快速試（30 秒，唔使裝任何嘢）

淨係想證明「融合」嗰步 work 唔 work，唔使載模型：

```bash
export GEMINI_API_KEY=AQ...          # Modal 用緊嗰個 key（Supabase Vault 有）
python3 fuse.py --demo
```

會即刻用一段示範對話（含錯別字＋粗口）行真 Gemini，print 出「Whisper 書面版 → 融合後地道版」，證明粗口照留、書面→地道、句數對齊。

---

## 完整跑（真錄音）

### 1. 環境（做一次）
- Python 3.10+、`ffmpeg`（Mac：`brew install ffmpeg`）
- 裝依賴：
  ```bash
  cd local-test
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  ```

### 2. 設 Gemini key
```bash
export GEMINI_API_KEY=AQ...
```

### 3. 行
```bash
python3 fuse.py 你嘅錄音.m4a            # 完整：Whisper + SenseVoice + Gemini 融合
python3 fuse.py 你嘅錄音.m4a --diarize  # 加講者分離（cam++，慢啲）
python3 fuse.py 你嘅錄音.m4a --no-fuse  # 淨 Whisper（用嚟對比融合前後）
```

出 `你嘅錄音.srt`（字幕）＋ `你嘅錄音.txt`（純文字），terminal 亦會 print 逐句對照表。

---

## 要知嘅嘢

- **第一次**會自動載模型：Whisper large-v3 約 3GB、SenseVoice 約 1GB。之後有 cache 就快。
- **Mac**：`faster-whisper`（CTranslate2）行 CPU，短片（幾分鐘）OK；SenseVoice 行 MPS。想 Whisper 快啲可以之後轉 `mlx-whisper`（Apple GPU），暫時 CPU 都夠測。
- **粗口／語氣詞照留**係產品原則——融合 prompt 明確叫佢**唔好過濾**。
- 融合**只換文字**，時間軸／講者／信心度原封不動。任何一步（Gemini／SenseVoice）出事都會自動退返 Whisper-only，唔會成個死。
- 呢個 folder 純粹係本地工具，同 GitHub Pages 網站無關（Pages 唔會 serve／執行佢）。

---

## 同網站雲端有咩分別？

| | 本地（呢個工具） | 網站雲端（Modal） |
|---|---|---|
| 邊個行 | 你部機 | Modal GPU |
| 使唔使錢 | 唔使 | Modal 收費（停緊） |
| 快唔快 | Mac CPU 慢啲 | GPU 快 |
| 邏輯 | **一樣**（同源 prompt／流程） | 一樣 |

想真係喺網站行，就要開返 Modal（加卡）或者將 Whisper 改行 Groq 免費 API——嗰個係另一件事。
