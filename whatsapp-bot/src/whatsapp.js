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

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error('WhatsApp 發送失敗: ' + JSON.stringify(json));
  }
  return json; // { messages: [{ id }] , ... }
}
