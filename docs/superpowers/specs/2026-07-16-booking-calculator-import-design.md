# 排堂報名 → 分成計數機點名表匯入(設計 spec)

日期:2026-07-16 · 狀態:設計已獲 Ming 口頭批准(方案 1)

## 目的

學生喺 `/schedule/` 報咗名之後,教練喺 `/split-calculator/` 點名嗰陣唔使重複入資料:
一鍵將本月**已開班(confirmed)**時段連報名名單匯入計數機,變成課堂記錄+點名表。

**扣堂時機不變**:報名只係排位;實際扣堂/出席/請假照舊由教練喺點名決定(協議 1.7)。
匯入只係「幫你填好張點名表」,唔郁計算核心。

## 唔做啲乜(YAGNI)

- 唔做「報名即自動扣堂」——同請假/缺席/流堂規則衝突。
- 唔做計數機全面搬上 Supabase——localStorage 版規則啱啱調教好,唔重寫。
- 唔做雙向同步(計數機改嘢寫返上 Supabase)——點名以計數機為準,單向匯入已夠。

## 資料流

```
Supabase                                    localStorage (split-calc-v1)
slot_list(本月) ──┐
                  ├─→ [匯入器] ─→ months[YYYY-MM].sessions[] (+attendees)
slot_roster(逐個) ┘              └→ students[](配對/新增,記住 sbId)
```

- 來源:`slot_list(p_from=月頭, p_to=月尾)`,篩 `status='confirmed'`(開咗班先入賬;
  純 open 未夠人 = 未開班,唔匯入)。
- 名單:逐個 slot 嗌 `slot_roster`,只攞 `status='booked'`(後補/取消唔入點名表)。
- 需要教練/管理員登入(頁面本身已 guard;slot_roster 對非職員回傳空)。

## 對應規則

| 排堂 (Supabase) | 計數機 (localStorage) |
|---|---|
| slot.session_date | sess.date |
| end_time−start_time(冇 end 就 1) | sess.dur(小時,0.5 精度) |
| slot.venue KT/MK | sess.venue |
| slot.coach ming/tom | sess.coach 'A'/'B'(明確指定,唔行 auto) |
| slot.id | sess.slotId(防重複匯入嘅 key) |
| roster.student_id | stu.sbId(學員連結 key) |
| roster.name / email 前綴 | stu.name(新增學員時) |

- 點名項:`{studentId, kind: pickKind(stu), classes: 1, status: 'present'}`。
- `pickKind`:免費學員→`free`;否則攞學員最近一張套票嘅票種;冇套票→`p4`
  (冇票學生會自然觸發「要交錢」提示——正確行為)。

## 學員配對(次序)

1. `stu.sbId === roster.student_id`(之前匯入過,最穩)
2. 名 trim+lowercase 完全一樣 → 配對並補寫 `sbId`(下次行 1)
3. 都唔中 → 新增本機學員 `{name, free:false, sbId}`

`sbId` 會跟 JSON 匯出/匯入一齊保留(export dump 成個 DB,import 保留欄位)。

## 冪等(撳幾多次都唔壞)

- 以 `sess.slotId` 搵現有 session:搵到就**只補新學生**(以 studentId 判斷),
  唔郁教練已改嘅狀態/扣堂數,唔刪人。
- 同一學生唔會喺同一堂出現兩次。

## 錯誤處理

- 未登入/token 過期 → toast「要用教練帳戶登入先匯入到」。
- 網絡/CDN 失敗 → toast 錯誤,計數機其他功能照用(匯入係增值,唔係依賴)。
- 本月冇 confirmed 時段 → toast「本月未有已開班嘅報名」。

## UI

「課堂記錄」卡(本月記錄分頁)加一個掣:
`🗓️ 由排堂報名匯入本月(教練)`,擺喺「＋加一節課堂」隔籬。
完成 toast:`匯入 X 節堂、Y 個點名(新增 Z 個學員)`。

## 測試計劃(sched-calc.js,localhost+真 JWT)

1. SQL 開臨時 coach+2 學生;coach 開本月時段(min 2),代兩個學生報名 → confirmed。
2. Coach 登入 → 計數機 → 匯入 → 驗證:1 節堂(日期/KT/教練啱)、2 個點名、
   學員名冊多咗 2 人、quickbar 收入 = 2×$200(冇套票行預設價)。
3. 再撳匯入 → 冇重複(仍然 1 節、2 個點名)。
4. 改咗其中一個點名狀態後再匯入 → 狀態唔被還原。
5. 清走測試時段+用戶;現有 file:// 計數機測試(calc-new/calc-v3/ui/june)不受影響。

## 風險

- 同名唔同人:名配對會撞——但配對後以 sbId 為準,第一次匯入後就穩;教練可自行改名。
- 時段開咗班但最後流堂:教練刪嗰節或者改狀態——匯入唔會自動判斷「實際有冇上」。
