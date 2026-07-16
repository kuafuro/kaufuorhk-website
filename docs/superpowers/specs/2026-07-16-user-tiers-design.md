# 用戶等級整理（User Tiers）— Design（Rev.2）

**Date:** 2026-07-16 · **Status:** shipped（functions/table 已套用到 Supabase；Stripe Pro/Max 已上線 test mode）
**Rev.2 修正：** 新星／挑戰者／苦行僧唔係出席數、亦唔係訂閱 plan — 係**學員買嘅堂數產品**，依據《踢拳小班教學合辦協議書 Rev.3（2026-07-13，Google Drive）》條款 1.1。

## 三軸模型

| 軸 | 值 | 邊個決定 | 存喺邊 |
|---|---|---|---|
| **身份 role**(權限) | member（Holder 基本會員）/ student / coach / admin | admin 手動（`set_user_role`） | `profiles.role` |
| **訂閱 plan**(網站課金・Stripe) | **Holder**（免費）/ **Pro** HK$70/月 / **Max** HK$120/月 | 用戶自己喺帳戶頁升級 | 由 `entitlements`（status+tier）衍生 |
| **堂數 level**(踢拳班・搵教練買) | **新星** 4堂 HK$800 / **挑戰者** 8堂 HK$1,400 / **苦行僧** 1對1 議價 | 職員記錄購買（`record_class_package`） | `class_packages` |

- **任何人都可以注册** → role `member` + plan `holder` + 未買堂數（無 level badge）。
- **Plan 衍生**：任一 active entitlement `tier='max'` → Max；任一 active → Pro；否則 Holder。
- **Level 衍生**：未過期堂數優先（高級數行先：苦行僧＞挑戰者＞新星）；全部過期就以最近一次購買為準；從未買過 → null。
- 堂數規則跟協議：每堂一小時、購買日起兩個月有效、可個別議價（1.1.5）、可同時持有小班＋單對單（1.1.4）。

## Stripe 課金（今次上線）

- **Checkout**：帳戶頁「訂閱方案」區 → `create-checkout`（product `all`, tier `pro`|`max`）→ Stripe Checkout → `stripe-webhook` 寫 `entitlements`（唯一寫入者）。
- **Kuafuor Max** 已由 setup-billing provision（test mode，`PRICE_ALL_MAX` 喺 Vault；portal 支援 Pro↔Max 轉 plan、月尾取消、發票）。
- 已持 Pro 撳 Max → 去 portal 轉 plan（唔會開第二條訂閱）；已持 Max → 只顯示「管理訂閱」。
- 轉正式收款：換 `sk_live` key 後重跑 setup-billing（會自動 re-provision live prices + webhook）。

## 記堂數（admin）

Login 頁 admin 用戶管理，每行有「＋堂數…」下拉：新星／挑戰者標準價自動帶入；苦行僧會問堂數＋議定總價。寫入經 `record_class_package`（`is_staff` 把關，SECURITY DEFINER）；學員只可以讀自己嘅堂數紀錄（RLS）。

## 權限 audit 結論（2026-07-16，不變）

Server-side 全綠：全部 public tables RLS-enabled；`profiles.role` 冇 UPDATE column grant；`contact_requests` admin 先讀到；demo 頁 guard admin-only；login FEATURES 同實際 gating 一致。
