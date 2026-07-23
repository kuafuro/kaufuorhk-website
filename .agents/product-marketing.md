# Product Marketing Context

**Document version:** v1
**Last updated:** 2026-07-23
**Scope:** 廣東話轉字幕（Cantonese → Subtitles）工具 — Kuafuor HK 旗下嘅 SaaS 線。呢份 context **只講字幕工具**，唔係成個 Kuafuor 諮詢／踢拳站。

> ⚠️ V1 由 AI 睇 codebase 自動 draft（`cantonese-subtitle/`、`whisper/modal_app.py`、`PRODUCT.md`、`DESIGN.md`），**未經確認**。有 ★ 嗰啲係推測、要 Ming 補實：定價數字、真實目標客、客戶原話、proof points、business goal。

## Product Overview
**One-liner:** 廣東話錄音／影片 → 準確口語字幕，係囉／㗎／喇／粗口照留，唔變書面語普通話。
**What it does:** 上傳或直接錄 podcast／訪問／會議／片段，出可校對嘅逐句字幕，下載 .srt/.vtt/.txt。免費本地模式喺瀏覽器內跑 Whisper，音檔唔離開部機；雲端「最準」模式用 large-v3 + SenseVoice 雙軌 + Gemini 逐句融合，加講者分離同低信心 highlight。
**Product category:** 廣東話語音轉文字／字幕（粵語專門 transcription / captioning）。客會搜「廣東話 轉字幕」「粵語 字幕 app」「Cantonese transcription」。
**Product type:** Freemium web SaaS（static frontend + Supabase + Modal GPU）。
**Business model:** 免費本地層引流 → Pro/Max 解鎖雲端最準＋雲端歷史＋匯出。★ 實際 tier 價錢／額度待補。

## Target Audience
★ 待確認。按產品形態推測：
**Target customers:**
- 香港內容創作者（YouTuber／podcaster／IG／TikTok）——出片字幕，講廣東話口語
- 記者／研究員／KOL——訪問錄音要逐字稿
- 中小企／自由業——會議、客戶通話要記錄
- 剪片師／字幕組——接 job 幫客上字幕
**Primary use case:** 將廣東話口語錄音變成準確、原汁原味、可直接用嘅字幕／逐字稿。
**Jobs to be done:**
- 幫我出片字幕，但唔好變書面語／普通話，要似我把口
- 幫我快啲搞掂訪問／會議逐字稿，唔使人手 hea 打
- 保住我啲廣東話語氣同粗口，唔好俾 AI「洗白」
- 唔好上傳我啲敏感錄音去人哋 server
**Use cases:** 出片上字幕、訪問轉逐字稿、會議記錄、社交片段 caption、講座／課堂備份。

## Personas
（偏 B2C／自助，personas 較輕）
| Persona | Cares about | Challenge | Value we promise |
|---|---|---|---|
| 創作者 | 出片快、字幕似人講嘢 | 剪映／YouTube 出書面語、隔粗口、要逐句改 | 口語準、粗口照留、.srt 直接用 |
| 記者／研究員 | 逐字準、慳時間 | 人手打稿慢；雲端工具唔識粵語 | 逐句＋時間軸＋講者分離 |
| 私隱敏感用戶 | 錄音唔外洩 | 大廠工具要上傳音檔 | 本地跑／雲端 6 鐘自動刪 |

## Problems & Pain Points
**Core problem:** 市面 AI 轉字幕對廣東話口語好差——出書面語／普通話、隔走粗口同語氣詞、逼你上傳音檔。
**Why alternatives fall short:**
- 剪映／CapCut、YouTube 自動字幕、訊飛聽見、通義聽悟：優化普通話／書面語，粵語口語（係囉/㗎/喇/佢哋）出唔到，粗口自動 mask
- 通用 Whisper app（MacWhisper 等）：large-v3 對粵語一般、出書面語、要自己 config
- 人手打稿／字幕組：貴、慢
**What it costs them:** 逐句手改字幕嘥幾個鐘；一個鐘訪問音人手打稿要幾個鐘；出街字幕「唔似廣東話」影響觀感。
**Emotional tension:** 「點解冇一個 AI 識我把口？」——連粗口都要自己補返、書面語睇到眼冤。

## Competitive Landscape
**Direct（大廠）:** 剪映/CapCut 自動字幕、YouTube 自動 caption、訊飛聽見、通義聽悟 — 粵語口語差、隔粗口、要上傳。
**Direct（工具型）:** MacWhisper／自架 Whisper — 出書面語、粵語一般、要技術。
**Secondary:** 人手字幕組／freelance transcriber — 準但貴又慢。
**Indirect:** 唔上字幕／自己喺 Premiere 手打 — 嘥時間。

## Differentiation
**Key differentiators:**
- 廣東話**口語**準（係囉/㗎/喇/佢哋/喺度），唔書面語化（雙 ASR + Gemini 逐句融合）
- **粗口、語氣詞照留唔過濾**——產品原則，唔洗白
- **私密**：本地模式音檔唔離開部機；雲端 6 鐘自動刪、只留字幕文字
- 逐句時間軸＋信心度 highlight＋講者分離，出到可直接用嘅 .srt/.vtt
**How we do it differently:** 免費層瀏覽器內跑 Whisper（Transformers.js）零上傳；付費層雲端 large-v3 + SenseVoice 雙軌 + Gemini 逐句溝口語。
**Why that's better:** 出嚟即係地道廣東話、唔使逐句執、唔怕外洩。
**Why customers choose us:** 唯一一個真係「識講廣東話、又肯留粗口、又唔偷你音檔」嘅字幕工具。

## Objections
| Objection | Response |
|---|---|
| 免費 Whisper／剪映咪得囉 | 佢哋出書面語、隔粗口、要上傳；我哋口語準＋私密＋粗口照留 |
| 準唔準？ | 雙 ASR + Gemini 融合，低信心句 highlight 俾你校；本地都有 Gemini 口語收正 |
| 上傳錄音安唔安全？ | 本地模式根本唔上傳；雲端 6 鐘自動刪、只留字幕 |
| 收幾錢值唔值？ | ★ 定價未定 |
**Anti-persona:** 淨要普通話／書面語逐字稿；要求法庭級 100% 準；完全唔 care 粗口/口語/私隱、慣用免費大廠工具嘅人。

## Switching Dynamics
**Push:** 剪映/YouTube 出書面語＋隔粗口＋逐句要改到嬲。
**Pull:** 終於有個工具識廣東話口語、肯留粗口、又唔上傳音檔。
**Habit:** 慣咗用緊剪映／手打／YouTube caption。
**Anxiety:** 準唔準？學唔學到？免費夠唔夠？雲端而家又未公開，收費會唔會落空。

## Customer Language
**How they describe the problem（★ 待真實用戶原話）:**
- 「啲字幕出咗普通話／書面語，唔似我講嘢」
- 「連粗口都幫我隔埋，好假」
- 「逐句改到癲」
**How they describe us（★ 待）:**
- 「終於有個識廣東話嘅」
**Words to use:** 廣東話、口語、原汁原味、係囉/㗎/喇、粗口照留、音檔唔上傳、私密、即錄即轉、.srt。
**Words to avoid:** 攞「普通話／書面語」做賣點；over-promise「100% 準」；生硬 machine-translation 英文。
**Glossary:**
| Term | Meaning |
|---|---|
| 本地模式 | 瀏覽器內跑 Whisper，音檔唔離開部機（免費） |
| 雲端最準 | large-v3+SenseVoice+Gemini 融合（Pro，內部測試中） |
| 融合 | 雙 ASR + Gemini 逐句溝返口語 |
| 講者分離 | cam++ 聲紋，逐句標邊個講 |

## Brand Voice
**Tone:** 港式、直接、貼地、有態度但唔粗俗。對比主站「書卷編輯風」，字幕工具可以再落地啲、講人話。
**Style:** 廣東話 zh／idiomatic English，短句、講好處唔堆術語。
**Personality:** 貼地、老實、私隱至上、識香港、有品味。
**★ 定位張力:** 主站係 classical 書卷風（paper/vermilion/serif、單一 light theme、反 generic SaaS slop）。字幕工具用同一 design token 但 utility dialect——行銷語氣要夾主站，唔好變 gradient-hero SaaS slop。

## Proof Points
★ 全部待補：
- 用量／準確度數字（e.g. large-v3+融合 vs 剪映 的字錯率對比）
- 用戶見證
- 「粗口照留／音檔唔上傳」可做硬 proof（對比 screenshot）
**Value themes:**
| Theme | Proof |
|---|---|
| 識廣東話口語 | 係囉/㗎/喇 對比 screenshot；雙 ASR+Gemini |
| 私密 | 本地唔上傳／雲端 6 鐘刪 |
| 原汁原味 | 粗口／語氣詞照留 |

## Goals
**Business goal:** ★ 待定——字幕工具係想 (a) 做 consultancy 引流 proof，定 (b) 谷成獨立收入線？（見下面策略岔口）
**Conversion action:** 免費試 → 升 Pro（雲端最準＋雲端歷史）。★ 但雲端而家未公開，呢條轉換路暫時斷。
**Current metrics:** ★ 未知（用戶數、轉換率、轉錄分鐘數）。

## Changelog
*Newest first. One line per revision: what changed and why.*
- v1 (2026-07-23) — Initial context，AI 由 codebase 自動 draft（cantonese-subtitle 前端、whisper modal app、PRODUCT/DESIGN.md）。★ 標記處待 Ming 確認：定價、目標客、客戶原話、proof、business goal。
