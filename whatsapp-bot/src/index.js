// 入口:Express server(webhook 驗證 + 手動觸發) + 每 15 分鐘自動掃描發提醒
import express from 'express';
import cron from 'node-cron';
import { runReminders } from './reminders.js';
import { handleInbound } from './booking.js';
import { realDeps } from './deps.js';
import { markRead } from './whatsapp.js';

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const TZ = process.env.TIMEZONE || 'Asia/Hong_Kong';

// 健康檢查（Railway / 瀏覽器打開會見到）
app.get('/', (_req, res) => res.send('Kuafuor WhatsApp bot is running ✅'));

// Meta webhook 驗證:喺 Meta 設定 webhook 嗰陣,佢會 GET 呢個 endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] verified ✅');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 收 WhatsApp 傳入訊息 → 對話式報堂
app.post('/webhook', (req, res) => {
  res.sendStatus(200);   // 即刻 ack(WhatsApp 要求快回),之後先慢慢處理
  (async () => {
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      if (!msg) return;                       // 送遞狀態 callback 等,唔使理
      if (msg.id) markRead(msg.id);           // 藍剔(best-effort)
      await handleInbound(msg, realDeps);
    } catch (e) {
      console.error('[webhook] 處理傳入訊息失敗:', e);
    }
  })();
});

// 手動觸發一次(方便測試):GET /run-reminders?key=<你嘅 VERIFY_TOKEN>
app.get('/run-reminders', async (req, res) => {
  if (req.query.key !== VERIFY_TOKEN) return res.sendStatus(403);
  try {
    const r = await runReminders();
    res.json(r);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] listening on ${PORT}`));

// 每 15 分鐘自動掃描一次
cron.schedule(
  '*/15 * * * *',
  () => {
    console.log('[cron] running reminders…');
    runReminders().catch((e) => console.error('[cron] failed', e));
  },
  { timezone: TZ }
);
console.log(`[cron] scheduled every 15 min (${TZ})`);
