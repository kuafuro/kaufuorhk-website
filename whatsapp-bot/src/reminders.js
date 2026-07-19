// 核心邏輯:搵「差唔多要提醒」嘅 booking,逐個發 WhatsApp,記錄避免重複。
import { supabase } from './supabase.js';
import { sendTemplate } from './whatsapp.js';

// 由 UTC instant 整返香港日期 / 時間顯示字串
function hkParts(iso) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d); // 例如「7月18日 週六」
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d); // 例如「19:00」
  return { date, time };
}

function reminderHours() {
  return (process.env.REMINDER_HOURS_BEFORE || '24,2')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

// 行一次:掃描所有到期提醒窗,發訊並記錄
export async function runReminders() {
  const hoursList = reminderHours();
  const windowMin = parseInt(process.env.SCAN_WINDOW_MINUTES || '20', 10);
  const results = [];

  for (const hoursBefore of hoursList) {
    // due_reminders 係 Supabase 入面嘅 function（見 sql/001_whatsapp_reminders.sql）
    const { data, error } = await supabase.rpc('due_reminders', {
      p_hours_before: hoursBefore,
      p_window_min: windowMin,
    });
    if (error) {
      console.error('[reminders] due_reminders 出錯:', error.message);
      continue;
    }

    for (const row of data || []) {
      try {
        const { date, time } = hkParts(row.starts_at);
        // template body 參數順序:{{1}}姓名 {{2}}日期 {{3}}時間 {{4}}地點
        const params = [row.name || '同學', date, time, row.venue || '本館'];
        const resp = await sendTemplate(row.phone, params);
        const waId = resp?.messages?.[0]?.id || null;

        // 記低已發,避免下次重複（unique 約束會擋重複）
        await supabase.from('whatsapp_reminders').insert({
          booking_id: row.booking_id,
          hours_before: hoursBefore,
          wa_message_id: waId,
        });

        results.push({ booking_id: row.booking_id, hoursBefore, to: row.phone, ok: true });
        console.log(`[reminders] 已發 ${hoursBefore}h 提醒 → ${row.phone}`);
      } catch (e) {
        results.push({ booking_id: row.booking_id, hoursBefore, ok: false, error: String(e) });
        console.error(`[reminders] 發送失敗 booking=${row.booking_id}:`, String(e));
      }
    }
  }

  return {
    ran_at: new Date().toISOString(),
    sent: results.filter((r) => r.ok).length,
    total_candidates: results.length,
    results,
  };
}
