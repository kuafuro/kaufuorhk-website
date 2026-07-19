// gemini-fuse — 網站「本地模式」嘅 Gemini 口語收正代理（內部測試：holder＋技術人員）。
// 瀏覽器喺用戶部機跑完 Whisper（音檔唔離開部機），淨係將「字幕文字」send 上嚟收正——
// GEMINI_API_KEY 收埋喺 Vault，永遠唔落 client。
//   POST { segments: string[] } →
//   200 { fused: string[] }（同長度逐句對應）| 200 { fused: null }（收正失敗，client 靜靜哋跳過）
//   401 未登入 · 403 internal_only（非 holder/developer）· 400 bad input · 503 未設 key
// 成本護欄：最多 400 句、每句 600 字、總量 60k 字——每次收正只係幾仙。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authz = req.headers.get('Authorization') ?? '';
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authz } },
    });
    const { data: { user } } = await asUser.auth.getUser(authz.replace('Bearer ', ''));
    if (!user) return json({ error: 'not signed in' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: techStaff } = await admin.rpc('is_tech_staff', { p_user: user.id });
    if (!techStaff) return json({ error: 'internal_only' }, 403);

    let body: { segments?: unknown };
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const segs = body.segments;
    if (!Array.isArray(segs) || !segs.length || segs.length > 400) return json({ error: 'bad segments' }, 400);
    const texts = segs.map((s) => String(s ?? '').slice(0, 600));
    if (texts.reduce((a, t) => a + t.length, 0) > 60000) return json({ error: 'too long' }, 400);

    const { data: cfg } = await admin.rpc('gemini_config');
    const KEY = ((cfg?.GEMINI_API_KEY as string) || '').trim();
    const MODEL = ((cfg?.GEMINI_MODEL as string) || '').trim() || 'gemini-3.1-flash-lite';
    if (!KEY) return json({ error: 'unconfigured' }, 503);

    // 冇 SenseVoice 參照嘅收正版（瀏覽器行唔到 SenseVoice）；粗口／語氣詞照留係產品原則。
    const lines = texts.map((t, i) => `${i}. ${t}`).join('\n');
    const prompt =
      '以下係一段廣東話錄音嘅 AI 逐句轉錄（字義大致準，但可能書面語化／有錯別字）：\n' + lines +
      '\n\n任務：逐句改良。保持每句原本意思，寫成地道廣東話口語' +
      '（係囉／㗎／喇／佢哋／喺度／咁樣／唔係），順手修正明顯錯別字。' +
      '粗口、語氣詞一律照留，唔准過濾。唔准加內容、唔准刪句、唔准改變意思。\n' +
      '只輸出一個 JSON array of strings，同輸入一樣句數、一樣次序，逐句對應。';

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
            },
          }),
        },
      );
      if (!r.ok) { console.error('gemini http', r.status, (await r.text()).slice(0, 300)); return json({ fused: null }); }
      const data = await r.json();
      const arr = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'null');
      if (Array.isArray(arr) && arr.length === texts.length) return json({ fused: arr.map((x) => String(x)) });
      console.error('gemini length mismatch', Array.isArray(arr) ? arr.length : 'n/a', 'vs', texts.length);
      return json({ fused: null });
    } catch (e) {
      console.error('gemini fuse failed', e);
      return json({ fused: null });   // 收正失敗唔好搞冧個 client——靜靜哋出返原文
    }
  } catch (e) {
    console.error('gemini-fuse error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
