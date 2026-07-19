// WhatsApp Cloud API — send template message
// 商業主動發訊（提醒）一定要用「已批核 template」,唔可以隨便發自由文字。
const API_VERSION = 'v21.0';

// 將香港電話整成 WhatsApp 要嘅格式:例如 "9876 5432" -> "85298765432"（冇 +、冇空格）
export function normalizeHkPhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d]/g, ''); // 淨低數字
  if (d.startsWith('00')) d = d.slice(2);     // 00852... -> 852...
  if (d.length === 8) d = '852' + d;          // 8 位本地號 -> 加香港區號
  return d.length >= 10 ? d : null;           // 太短當無效
}

// 發一個 template 訊息。params 係 body 入面 {{1}} {{2}} ... 嘅值（順序）
export async function sendTemplate(toPhone, params) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'class_reminder';
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'zh_HK';

  const to = normalizeHkPhone(toPhone);
  if (!to) throw new Error('電話格式無效: ' + toPhone);
  if (!phoneId || !token) throw new Error('未設定 WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN');

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
      components: [
        {
          type: 'body',
          parameters: params.map((t) => ({ type: 'text', text: String(t) })),
        },
      ],
    },
  };

  return postMessage(payload);
}

// ── 共用:POST 一個訊息 payload 上 Cloud API ──
async function postMessage(payload) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) throw new Error('未設定 WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN');
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error('WhatsApp 發送失敗: ' + JSON.stringify(json));
  return json; // { messages: [{ id }], ... }
}

// ── 純文字（只喺 24 鐘客服窗內先發到；學生 send 你先就得）──
export async function sendText(toPhone, body) {
  const to = normalizeHkPhone(toPhone);
  if (!to) throw new Error('電話格式無效: ' + toPhone);
  return postMessage({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: String(body) } });
}

// ── 互動:清單（最多 10 行；每行 {id,title,description}）──
export async function sendList(toPhone, { header, body, footer, button, rows }) {
  const to = normalizeHkPhone(toPhone);
  if (!to) throw new Error('電話格式無效: ' + toPhone);
  const interactive = {
    type: 'list',
    body: { text: String(body || ' ') },
    action: {
      button: String(button || '揀一個').slice(0, 20),
      sections: [{ title: String(header || ' ').slice(0, 24), rows: (rows || []).slice(0, 10).map((r) => ({
        id: String(r.id).slice(0, 200),
        title: String(r.title).slice(0, 24),
        ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
      })) }],
    },
  };
  if (header) interactive.header = { type: 'text', text: String(header).slice(0, 60) };
  if (footer) interactive.footer = { text: String(footer).slice(0, 60) };
  return postMessage({ messaging_product: 'whatsapp', to, type: 'interactive', interactive });
}

// ── 互動:回覆掣（最多 3 個 {id,title}）──
export async function sendButtons(toPhone, { body, buttons }) {
  const to = normalizeHkPhone(toPhone);
  if (!to) throw new Error('電話格式無效: ' + toPhone);
  const interactive = {
    type: 'button',
    body: { text: String(body || ' ') },
    action: { buttons: (buttons || []).slice(0, 3).map((b) => ({ type: 'reply', reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) } })) },
  };
  return postMessage({ messaging_product: 'whatsapp', to, type: 'interactive', interactive });
}

// ── 派送 booking.js 產生嘅訊息物件（{kind:'text'|'list'|'buttons'}）──
export async function sendMessage(toPhone, m) {
  if (!m) return;
  if (m.kind === 'text') return sendText(toPhone, m.body);
  if (m.kind === 'list') return sendList(toPhone, m);
  if (m.kind === 'buttons') return sendButtons(toPhone, m);
  throw new Error('未知訊息類型: ' + m.kind);
}

// ── 標記已讀（可選,令學生見到藍剔）──
export async function markRead(messageId) {
  if (!messageId) return;
  try { await postMessage({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }); }
  catch (e) { /* 已讀失敗唔阻正常流程 */ }
}
