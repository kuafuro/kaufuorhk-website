// 取消時段通知:掃 class_cancel_notices（由網站 cancel_slot RPC 排隊）逐個發 WhatsApp。
// 同 reminders 一樣「先 claim 後發、失敗釋放」,避免重複或漏發。
import { supabase } from './supabase.js';
import { sendTemplate } from './whatsapp.js';

const VENUE_LABEL = { KT: '觀塘', MK: '旺角' };

// 由「日期 + 時間」整香港顯示字串（同 reminders 一致）
function hkDateTime(session_date, start_time) {
  // session_date: 'YYYY-MM-DD', start_time: 'HH:MM[:SS]' — 當香港時間
  const d = new Date(`${session_date}T${String(start_time).slice(0, 5)}:00+08:00`);
  const date = new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong', month: 'long', day: 'numeric', weekday: 'short',
  }).format(d);
  const time = String(start_time).slice(0, 5);
  return { date, time };
}

export async function runCancelNotices() {
  if (!supabase) { console.warn('[notices] Supabase 未配置，跳過'); return []; }
  const template = process.env.WHATSAPP_CANCEL_TEMPLATE_NAME || 'class_cancelled';
  const results = [];

  const { data, error } = await supabase
    .from('class_cancel_notices')
    .select('id, name, phone, session_date, start_time, venue')
    .is('sent_at', null)
    .not('phone', 'is', null)
    .limit(200);
  if (error) {
    console.error('[notices] 讀取失敗:', error.message);
    return { ran_at: new Date().toISOString(), sent: 0, error: error.message };
  }

  for (const row of data || []) {
    // claim:set sent_at,claim 唔到（已被另一進程攞咗）就跳過
    const { data: claimed, error: claimErr } = await supabase
      .from('class_cancel_notices')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('sent_at', null)
      .select('id')
      .single();
    if (claimErr || !claimed) continue;

    try {
      const { date, time } = hkDateTime(row.session_date, row.start_time);
      // template body 參數順序:{{1}}姓名 {{2}}日期 {{3}}時間 {{4}}地點
      const params = [row.name || '同學', date, time, VENUE_LABEL[row.venue] || row.venue || '本館'];
      const resp = await sendTemplate(row.phone, params, template);
      const waId = resp?.messages?.[0]?.id || null;
      await supabase.from('class_cancel_notices').update({ wa_message_id: waId }).eq('id', row.id);
      results.push({ id: row.id, to: row.phone, ok: true });
      console.log(`[notices] 已發取消通知 → ${row.phone}`);
    } catch (e) {
      // 發送失敗 → 釋放,下輪重試
      await supabase.from('class_cancel_notices').update({ sent_at: null }).eq('id', row.id);
      results.push({ id: row.id, ok: false, error: String(e) });
      console.error(`[notices] 發送失敗 id=${row.id}:`, String(e));
    }
  }

  return {
    ran_at: new Date().toISOString(),
    sent: results.filter((r) => r.ok).length,
    total_candidates: results.length,
    results,
  };
}
