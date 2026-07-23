# Product Marketing Context

**Document version:** v2
**Last updated:** 2026-07-23
**Scope:** 廣東話轉字幕（Cantonese → Subtitles）工具 — Kuafuor HK 旗下嘅**獨立 SaaS 線**（順手做主站 automation proof）。呢份 context **只講字幕工具**。

> ⚠️ 定位／架構已由 Ming 拍板（2026-07-23，見 Changelog v2）。仍有 ★ 待補：定價數字、真實客戶原話、proof 數據。

## 策略核心（一句記住）
**鬥準，攻廣東話市場。** 準確度係主 wedge；口語／粗口原汁原味 ＋ 私隱（上傳後自動刪）係副打點。

## Product Overview
**One-liner:** 全港最準嘅廣東話轉字幕——雲端 AI 逐句融合，口語、粗口原汁原味，上傳即轉、轉完自動刪。
**What it does:** 上傳或直接錄 podcast／訪問／會議／片段 → 雲端 large-v3 + SenseVoice 雙軌 + Gemini 逐句融合 → 準確口語字幕，帶時間軸、講者分離、低信心 highlight，下載 .srt/.vtt/.txt。**淨雲端**（唔再做瀏覽器本地模式）。
**Product category:** 廣東話語音轉文字／字幕（粵語專門 transcription / captioning）。客搜「廣東話 轉字幕」「粵語 字幕 app」「Cantonese transcription」。
**Product type:** 雲端 web SaaS（static frontend + Supabase + Modal GPU）。
**Business model:** Freemium — 免費雲端 X 分鐘試 → Pro/Max 解鎖更多分鐘＋雲端歷史＋匯出＋優先。★ 實際 tier 價錢／額度待補。
**架構註（點解淨雲端）:** model 落到 browser 就會俾人抽走 weights；日後自家 fine-tune 嘅粵語 model 係核心資產，一定要留喺 server。淨雲端＝保護 model＝支撐「鬥準」策略。代價：放棄咗「音檔從不離開部機」呢個最硬嘅私隱 proof，改用「上傳後自動刪」承諾（較軟，但夠打副點）。

## Target Audience
**Beachhead：香港內容創作者（YouTuber／podcaster／IG／TikTok）。** 量大、佢哋啲片＝活廣告、痛點最痛又最可見（書面語字幕、粗口被 mask）。
**Expansion:** 記者／研究／KOL（訪問逐字稿）、中小企／自由業（會議記錄）、剪片師／字幕組（接 job）。
**Primary use case:** 將廣東話口語錄音／片段變成**準確、原汁原味、即用**嘅字幕／逐字稿。
**Jobs to be done:**
- 幫我出片字幕，準到似我把口，唔好變書面語／普通話
- 幫我快啲搞掂訪問／會議逐字稿，唔使人手 hea 打
- 保住我啲廣東話語氣同粗口，唔好俾 AI 洗白
**Use cases:** 出片上字幕、訪問轉逐字稿、會議記錄、社交片段 caption、講座備份。

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---|---|---|---|
| 創作者（beachhead） | 出片快、字幕似人講嘢 | 剪映／YouTube 出書面語、隔粗口、要逐句改 | **最準口語**、粗口照留、.srt 直接用 |
| 記者／研究員 | 逐字準、慳時間 | 人手打稿慢；雲端工具唔識粵語 | 逐句準＋時間軸＋講者分離 |
| 中小企／自由業 | 效率、記錄可靠 | 會議稿冇人做 | 上傳即轉、轉完自動刪 |

## Problems & Pain Points
**Core problem:** 市面 AI 轉字幕對廣東話**唔準**——出書面語／普通話、隔走粗口同語氣詞、時間軸亂。
**Why alternatives fall short:**
- 剪映／CapCut、YouTube 自動字幕、訊飛聽見、通義聽悟：為普通話／書面語優化，粵語口語（係囉/㗎/喇/佢哋）出唔到、粗口自動 mask
- 通用 Whisper app（MacWhisper 等）：large-v3 對粵語一般、出書面語、要自己 config
- 人手打稿／字幕組：準但貴又慢
**What it costs them:** 逐句手改字幕嘥幾個鐘；一個鐘訪問人手打稿要幾個鐘；出街字幕「唔似廣東話」影響觀感同專業度。
**Emotional tension:** 「點解冇一個 AI 識我把口？」——連粗口都要自己補返、書面語睇到眼冤。

## Competitive Landscape
（全部以**準確度**為軸嚟打）
**Direct（大廠）:** 剪映/CapCut、YouTube 自動 caption、訊飛聽見、通義聽悟 — 粵語口語唔準、隔粗口。
**Direct（工具型）:** MacWhisper／自架 Whisper — 出書面語、粵語一般。
**Secondary:** 人手字幕組／freelance — 準但貴又慢。
**Indirect:** 唔上字幕／Premiere 手打 — 嘥時間。
**攻擊點:** 任何競品都可以攞真實廣東話片做 side-by-side，show 佢哋錯／書面語化、我哋準又口語。

## Differentiation
**Key differentiators（按打點次序）:**
1. **最準嘅廣東話口語** — 雙 ASR（Whisper large-v3 + SenseVoice）+ Gemini 逐句融合；roadmap：自家 fine-tune 粵語 model（護城河）
2. **原汁原味** — 粗口、語氣詞照留唔過濾（產品原則，唔洗白）；出到係囉/㗎/喇/佢哋/喺度
3. **可校對可信** — 逐句時間軸＋信心度 highlight＋講者分離，出到即用 .srt/.vtt
4. **私隱（副點）** — 上傳後短時間自動刪、只留字幕文字
**Why customers choose us:** 唯一一個真係「識講廣東話、又肯留粗口、又敢同你比準」嘅字幕工具。

## Objections
| Objection | Response |
|---|---|
| 免費 Whisper／剪映咪得囉 | 佢哋粵語出書面語、隔粗口、逐句要改；我哋準＋口語＋粗口照留，敢 side-by-side 同你比 |
| 你講最準，點證明？ | 攞你條片做對比 demo：我 vs 剪映／YouTube，字錯率＋口語度即刻見 |
| 上傳錄音安唔安全？ | 上傳後短時間自動刪、只留字幕文字；唔會攞去 train |
| 收幾錢值唔值？ | ★ 定價未定 |
**Anti-persona:** 淨要普通話／書面語稿；要求法庭級 100% 準；完全唔 care 口語/粗口、又必須音檔零上傳（呢批啱本地工具，唔係我哋目標）。

## Switching Dynamics
**Push:** 剪映/YouTube 粵語出書面語＋隔粗口＋逐句改到嬲。
**Pull:** 終於有個**準**又識廣東話口語、粗口照留嘅工具。
**Habit:** 慣咗用緊剪映／手打／YouTube caption。
**Anxiety:** 真係準啲？值唔值錢？上傳咗安唔安全？（→ 用 side-by-side demo ＋ 刪除承諾拆）

## Customer Language
**How they describe the problem（★ 待真實用戶原話）:**
- 「啲字幕出咗普通話／書面語，唔似我講嘢」
- 「連粗口都幫我隔埋，好假」
- 「逐句改到癲」
**Words to use:** 準、最準、廣東話、口語、原汁原味、係囉/㗎/喇、粗口照留、上傳即轉、轉完自動刪。
**Words to avoid:** 攞「普通話／書面語」做賣點；空口講「100% 準」無 proof；主動賣「音檔從不上傳」（已改雲端，會自相矛盾）。
**Glossary:**
| Term | Meaning |
|---|---|
| 雲端最準 | large-v3 + SenseVoice + Gemini 融合（付費核心） |
| 融合 | 雙 ASR + Gemini 逐句溝返口語 |
| 講者分離 | cam++ 聲紋，逐句標邊個講 |
| 自動刪 | 上傳音檔短時間內刪、只留字幕文字 |

## Brand Voice
**Tone:** 港式、直接、貼地、有態度但唔粗俗、夠自信（敢同人比準）。
**Style:** 廣東話 zh／idiomatic English，短句、講好處唔堆術語。
**Personality:** 準、貼地、老實、識香港、有品味。
**★ 定位張力:** 主站係 classical 書卷風（paper/vermilion/serif、單一 light theme、反 gradient-hero SaaS slop）。字幕工具用同一 design token 但 utility dialect——行銷語氣要夾主站，唔好變 generic SaaS。

## Proof Points
**核心 proof = 準確度對比（最重要，要即刻起）:**
- Side-by-side「我 vs 剪映／YouTube／訊飛」逐字對照 + 字錯率／口語度 —— `local-test/compare_models.py` 就係整呢啲對比嘅引擎
- 粗口照留、口語對照 screenshot
★ 待補：用戶見證、轉錄量／準確率數字。
**Value themes:**
| Theme | Proof |
|---|---|
| 最準廣東話 | side-by-side 字錯率對比；雙 ASR+Gemini；自家 fine-tune roadmap |
| 原汁原味 | 粗口／語氣詞照留對照 |
| 上傳安全 | 轉完自動刪、只留字幕 |

## Goals
**Business goal:** 獨立 SaaS，**鬥準攞廣東話字幕市場**；順手做 Kuafuor consultancy 嘅 automation proof。
**Conversion action:** 免費雲端 X 分鐘試 → 升 Pro（更多分鐘＋雲端歷史＋匯出）。
**★ 即時樽頸:**
1. 雲端而家內部測試、對公眾未開 → **砍咗本地即係公眾暫時冇嘢用，Modal／雲端上線變最緊急**
2. 淨雲端 = 每個免費 use 都燒 GPU → 免費層一定要 metered（e.g. 每月 X 分鐘）先唔會蝕
**Current metrics:** ★ 未知（用戶數、轉換率、轉錄分鐘數）。

## Changelog
*Newest first. One line per revision: what changed and why.*
- v2 (2026-07-23) — **策略拍板（Ming）**：改為「鬥準／攻廣東話市場」主 wedge；砍本地模式、淨雲端（保護日後自家 fine-tune model 唔俾人偷）；私隱由「唔上傳」降級做「上傳後自動刪」副點。連帶改 Overview／Differentiation（準行頭）／Objections／Proof（side-by-side 對比做核心）／Goals（標記雲端上線＋免費 metered 兩個樽頸）。
- v1 (2026-07-23) — Initial context，AI 由 codebase 自動 draft。
