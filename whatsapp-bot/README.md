# Kuafuor WhatsApp 提醒 Bot

自動喺**堂前 24 個鐘同 2 個鐘**,用 WhatsApp 提醒有報名嘅學生上堂。
接 Supabase 嘅 booking 資料,用 WhatsApp Cloud API 發訊,部署喺 Railway。

> ⚠️ 呢個係**骨架(skeleton)**,已經跟你真實嘅 Supabase schema 寫好。
> 未接你嘅 WhatsApp ID 之前唔會真正發訊。ID 一到,填好環境變數就上到線。

---

## 1. 運作原理(一句講晒)

Railway 每 15 分鐘行一次 → 問 Supabase「邊個學生嘅堂差唔多開(24h / 2h 前)而又未提過?」→ 逐個發 WhatsApp template → 記低避免重複。

## 2. 你要準備嘅嘢

| 項目 | 喺邊度攞 |
|---|---|
| Phone Number ID | Meta → 你個 App → WhatsApp → API Setup |
| WhatsApp 永久 Access Token | Meta → System User 產生（下面 Step 4） |
| Verify Token | 你自己作一串密碼字（例如 `kuafuor-webhook-8f3k`） |
| Supabase service_role key | Supabase → Project Settings → API → `service_role` |

## 3. 環境變數(Railway → Variables 逐個填)

睇 `.env.example`。最緊要:

```
WHATSAPP_TOKEN=…                (機密,唔好落 git / chat)
WHATSAPP_PHONE_NUMBER_ID=…
WHATSAPP_VERIFY_TOKEN=…         (自己作)
WHATSAPP_TEMPLATE_NAME=class_reminder
WHATSAPP_TEMPLATE_LANG=zh_HK
SUPABASE_URL=https://ikzoxrvnpsseyjviawti.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…     (機密)
REMINDER_HOURS_BEFORE=24,2
```

---

## 4. 逐步設定

### Step A — 喺 Supabase 行 SQL
Supabase → **SQL Editor** → 貼上 `sql/001_whatsapp_reminders.sql` 全部 → Run。
（會建立記錄表 `whatsapp_reminders` 同查詢 function `due_reminders`。）

### Step B — 建立 WhatsApp 訊息 Template
主動發提醒**一定要用已批核 template**（唔可以自由發文字）。
去 **WhatsApp Manager → Message templates → Create template**:

- Name: `class_reminder`
- Category: **Utility**
- Language: **Chinese (Hong Kong) / zh_HK**
- Body（照抄,`{{1}}`…`{{4}}` 係變數):

```
{{1}} 你好!提提你 {{2}} {{3}} 有堂 🥋
地點:{{4}}
記得準時到,期待見到你 💪
— Kuafuor Motion Lab
```

- Sample values(俾 Meta 審批睇):`{{1}}=陳大文` `{{2}}=7月18日 週六` `{{3}}=19:00` `{{4}}=觀塘館`

送審後通常幾分鐘到幾個鐘批。批咗先發到。
（順序好緊要:程式會順住 `姓名 / 日期 / 時間 / 地點` 填入 `{{1}}`–`{{4}}`。）

### Step C — 部署上 Railway
1. 將呢個 folder push 上一個 GitHub repo。
2. Railway → New Project → **Deploy from GitHub repo** → 揀呢個 repo。
3. Railway → **Variables** → 逐個填上面第 3 節嘅變數（**Token 只喺呢度填**）。
4. Railway 會自動 `npm install` + `npm start`。開好會有個網址,例如 `https://xxx.up.railway.app`。

### Step D — 喺 Meta 設定 Webhook
Meta → 你個 App → WhatsApp → **Configuration → Webhook**:
- Callback URL: `https://<你嘅 Railway 網址>/webhook`
- Verify token: 同 `WHATSAPP_VERIFY_TOKEN` 一模一樣
- 撳 Verify and Save（成功即代表 server 通）。

### Step E — 測試
- 瀏覽器打開 `https://<railway>/run-reminders?key=<你嘅 VERIFY_TOKEN>` 會即刻掃一次並回傳結果。
- 想真係收到:喺 `class_slots` 開一堂(香港時間 24h 或 2h 後),用一個有 `phone` 嘅 `profiles` 帳戶 `book_slot` 落去,再觸發。

---

## 5. 學生電話點嚟?
提醒係讀 `profiles.phone`。所以**學生註冊/落單時要填香港電話**。
格式:程式會自動處理 `9876 5432` → `85298765432`(8 位自動加 852)。
👉 建議喺網站報名表加一格「WhatsApp 電話」寫入 `profiles.phone`(呢個之後可以幫你接)。

## 6. 想改提醒時間?
改 Railway 變數 `REMINDER_HOURS_BEFORE`,例如:
- `24,2` = 堂前一日 + 兩個鐘
- `48,24,3` = 堂前兩日 + 一日 + 三個鐘

## 7. 🔒 安全
- `WHATSAPP_TOKEN`、`SUPABASE_SERVICE_ROLE_KEY` **只可以放 Railway Variables**,唔好寫入程式碼或 commit 落 git(`.gitignore` 已擋 `.env`)。
- `due_reminders` function 已 revoke 咗 anon/authenticated,淨係後端用到。

---

## 8. 我做咗嘅假設(唔啱話我知,好易改)
1. 提醒:堂前 **24h + 2h**。
2. 語言:**繁體中文**單語 template。
3. 只提 **正取(booked)** 學生,唔提後補(waitlist)。
4. 只提 status 為 **open / confirmed** 嘅堂(取消嗰啲唔提)。
5. 學生 WhatsApp 電話存喺 **`profiles.phone`**(香港號)。
6. 掃描頻率:**每 15 分鐘**,容忍 ±20 分鐘。

> 未接 WhatsApp ID 之前係唔會發訊嘅,可以放心先 review 結構。
