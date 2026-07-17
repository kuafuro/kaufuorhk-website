// 入口:Express server(webhook 驗證 + 手動觸發) + 每 15 分鐘自動掃描發提醒
import express from 'express';
import cron from 'node-cron';
import { runReminders } from './reminders.js';
import { runCancelNotices } from './notices.js';

// 每次掃描:先發到期提醒,再發取消通知
async function runAll() {
  const reminders = await runReminders();
  const cancels = await runCancelNotices();
  return { reminders, cancels };
}

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

// 收 WhatsApp 傳入訊息 / 送遞狀態(而家淨係 log,將來可加自動回覆)
app.post('/webhook', (req, res) => {
  console.log('[webhook] inbound:', JSON.stringify(req.body));
  res.sendStatus(200);
});

// 手動觸發一次(方便測試):GET /run-reminders?key=<你嘅 VERIFY_TOKEN>
app.get('/run-reminders', async (req, res) => {
  if (req.query.key !== VERIFY_TOKEN) return res.sendStatus(403);
  try {
    const r = await runAll();
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
    console.log('[cron] running reminders + cancel notices…');
    runAll().catch((e) => console.error('[cron] failed', e));
  },
  { timezone: TZ }
);
console.log(`[cron] scheduled every 15 min (${TZ})`);
