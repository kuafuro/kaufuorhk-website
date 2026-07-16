# 用戶等級整理（User Tiers）— Design

**Date:** 2026-07-16 · **Status:** shipped（唯讀 functions 已套用到 Supabase；詳見 `db/migrations/20260716_user_tiers.sql`）

## 三軸模型

用戶嘅「等級」其實係三樣獨立嘅嘢，混埋一齊就亂。分開三條軸，各有各嚟源、各有各用途：

| 軸 | 值 | 邊個決定 | 用嚟做乜 | 存喺邊 |
|---|---|---|---|---|
| **身份 role**（權限） | member / student / coach / admin | admin 手動（`set_user_role`） | 控制睇到／用到嘅功能 | `profiles.role` |
| **訂閱 plan**（課金） | **Holder**（免費）/ **Pro** / **Max** | 用戶自己課金（billing loop） | 解鎖收費功能（如字幕雲端引擎） | 由 `entitlements` 衍生，唔另外儲 |
| **修行 level**（榮譽） | **新星** Rising Star / **挑戰者** Challenger / **苦行僧** Ascetic | 練返嚟（出席自動計） | 展示／激勵，**唔影響權限** | 由 `slot_bookings` 出席衍生 |

- **任何人都可以注册**：signup 開放，新帳戶 = role `member` + plan `holder` + level `新星`。呢個組合就係「Holder」基本會員。
- **Plan 衍生規則**：有 active entitlement `product='all'` → **Max**；有任何 active entitlement → **Pro**；否則 **Holder**。單一真相喺 `entitlements`，唔會 drift。
- **Level 門檻**：過去已上（booked + 過咗堂 + 堂冇取消）：0–9 堂 = 新星，10–49 = 挑戰者，≥50 = 苦行僧。

## 功能矩陣（邊個睇到乜）

| 功能 | 訪客 | Holder (member) | Student | Coach / Admin | 需要 Pro/Max |
|---|---|---|---|---|---|
| 主頁／筆記／文章／筆記圖譜 | ✓ | ✓ | ✓ | ✓ | — |
| Motion Lab（頁面＋本地分析） | ✓ | ✓ | ✓ | ✓ | — |
| Motion Lab 雲端檔案（athletes / training_sessions） | ✗ | ✓（自己嘅） | ✓ | ✓ | — |
| 轉字幕（瀏覽器本地） | ✓ | ✓ | ✓ | ✓ | — |
| 轉字幕雲端引擎（transcripts） | ✗ | ✗ | ✗ | ✗ | **Pro/Max**（`has_pro`） |
| 排堂報名（睇＋報） | ✗（要登入） | ✓ | ✓ | ✓ | — |
| 開班／睇名單／代人報名 | ✗ | ✗ | ✗ | ✓（RLS `is_staff`） | — |
| 分成計算器 | ✗ | ✗ | ✗ | ✓（guard + nav 隱藏） | — |
| 用戶管理／網站查詢（admin 卡） | ✗ | ✗ | ✗ | admin only（RLS `is_admin`） | — |
| agent-dashboard / billing-demo（內部） | ✗ | ✗ | ✗ | admin only（guard） | — |

## 今次實作

1. `user_plan(uuid)` / `user_level(uuid)` / `my_tiers()` — 唯讀 SECURITY DEFINER functions（已套用；`my_tiers` 只回傳自己嘅）。
2. Login 頁 profile 卡：role badge 旁邊加 **plan badge**（Holder 虛線灰／Pro/Max 朱紅）同 **level badge**（新星／挑戰者／苦行僧＋堂數），中英雙語；RPC 攞唔到就靜靜哋唔顯示。
3. 冇改任何權限行為 — plan/level 純展示；權限一律照舊由 role + RLS 話事。

## 權限 audit 結論（2026-07-16）

Server-side 全綠：10 個 public tables 全部開咗 RLS；`profiles.role` 冇 UPDATE column grant（想自己升 admin 嘅路封死咗，只可以經 admin-only `set_user_role`）；`contact_requests` admin 先讀到；roster／代人報名 RLS `is_staff` 把關。修咗嘅 client-side 問題：login 頁 FEATURES 話 Motion Lab 要 student+ 但個頁公開（改返做全員 + 補返排堂報名入口）；`agent-dashboard`／`billing-demo` 兩個內部 demo 冇鎖（加咗 guard admin-only）。
