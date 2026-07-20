// 對話式報堂 — 單元測試(純邏輯,stub 晒 DB / WhatsApp)。行:  node test/booking.test.js
import assert from 'node:assert';
import { handleInbound, intentOf } from '../src/booking.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS - ' + name); } else { fail++; console.log('FAIL - ' + name); } }

// 造一個 deps stub:記低所有 send、book、cancel;可設定 student / slots / bookings。
function makeDeps(over = {}) {
  const sent = [];
  const booked = [];
  const cancelled = [];
  const deps = {
    sent, booked, cancelled,
    resolveStudent: async (phone) => over.student === null ? null : (over.student || { id: 'stu-1', name: '阿明' }),
    openSlots: async () => over.slots || [],
    myBookings: async () => over.bookings || [],
    book: async (slotId, studentId) => {
      booked.push({ slotId, studentId });
      if (over.bookThrows) throw new Error(over.bookThrows);
      return over.bookResult || { ok: true, status: 'booked', booked_count: 1, confirmed: false, min_to_open: 2, session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT', coach: 'ming' };
    },
    cancel: async (slotId, studentId) => {
      cancelled.push({ slotId, studentId });
      return over.cancelResult || { ok: true, session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT' };
    },
    send: async (to, m) => { sent.push({ to, m }); },
  };
  return deps;
}
const lastMsg = (d) => d.sent[d.sent.length - 1].m;
const slot = (id, over = {}) => ({ id, session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT', coach: 'ming', capacity: 6, booked_count: 2, status: 'open', ...over });

(async () => {
  // 1. 未連結電話 → 叫去 login 填電話
  {
    const d = makeDeps({ student: null });
    await handleInbound({ from: '85290000000', type: 'text', text: { body: 'hi' } }, d);
    ok('未連結帳戶 → 提示去 login 填電話', d.sent.length === 1 && /login/.test(lastMsg(d).body) && lastMsg(d).kind === 'text');
  }

  // 2. text「hi」→ 出 menu 兩個掣
  {
    const d = makeDeps();
    await handleInbound({ from: '85291110001', type: 'text', text: { body: 'hi' } }, d);
    const m = lastMsg(d);
    ok('陌生訊息 → 出 menu（報堂 / 我嘅堂 兩掣）', m.kind === 'buttons' && m.buttons.length === 2
      && m.buttons.some(b => b.id === 'menu:book') && m.buttons.some(b => b.id === 'menu:mine'));
  }

  // 3. text「報堂」→ 出時段清單（可撳）
  {
    const d = makeDeps({ slots: [slot('s1'), slot('s2', { venue: 'MK', coach: 'tom' }), slot('sX', { status: 'cancelled' })] });
    await handleInbound({ from: '85291110001', type: 'text', text: { body: '報堂' } }, d);
    const m = lastMsg(d);
    ok('報堂 → interactive list', m.kind === 'list');
    ok('取消咗嘅時段唔會出（淨低 2 個 open/confirmed）', m.rows.length === 2);
    ok('每行 id = book:<slotId>', m.rows[0].id === 'book:s1' && m.rows[1].id === 'book:s2');
    ok('行標題有日期時間、描述有場地教練人數', /7\/20 [日一二三四五六] 19:00/.test(m.rows[0].title) && /觀塘 · Ming · 2\/6/.test(m.rows[0].description));
    ok('旺角/Tom 場正確', /旺角 · Tom/.test(m.rows[1].description));
  }

  // 4. 冇時段 → 友善文字
  {
    const d = makeDeps({ slots: [] });
    await handleInbound({ from: '85291110001', type: 'text', text: { body: 'book' } }, d);
    ok('冇開放時段 → 文字提示', lastMsg(d).kind === 'text' && /未有開放時段/.test(lastMsg(d).body));
  }

  // 5. 撳時段（interactive list_reply book:s1）→ 叫 book()，回確認
  {
    const d = makeDeps();
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'book:s1', title: '...' } } }, d);
    ok('撳時段 → 叫 book(s1, stu-1)', d.booked.length === 1 && d.booked[0].slotId === 's1' && d.booked[0].studentId === 'stu-1');
    ok('報名成功 → 文字確認（含日期地點）', lastMsg(d).kind === 'text' && /報咗名/.test(lastMsg(d).body) && /觀塘/.test(lastMsg(d).body));
  }

  // 6. 報名夠人 confirmed → 講「開班喇」
  {
    const d = makeDeps({ bookResult: { ok: true, status: 'booked', booked_count: 2, confirmed: true, min_to_open: 2, session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT', coach: 'ming' } });
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'book:s1' } } }, d);
    ok('夠人 → 講開班喇', /開班喇/.test(lastMsg(d).body));
  }

  // 7. 滿咗 → 後補
  {
    const d = makeDeps({ bookResult: { ok: true, status: 'waitlist', session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT' } });
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'book:s1' } } }, d);
    ok('滿咗 → 講後補', /後補/.test(lastMsg(d).body));
  }

  // 8. 已報過 → already
  {
    const d = makeDeps({ bookResult: { ok: true, status: 'booked', already: true, session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT' } });
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'book:s1' } } }, d);
    ok('已報過 → 講之前已報', /已經報咗/.test(lastMsg(d).body));
  }

  // 9. book 出錯（過咗截止）→ 友善錯誤，唔會 crash
  {
    const d = makeDeps({ bookThrows: '已過報名截止時間' });
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'book:s1' } } }, d);
    ok('報名出錯 → 友善錯誤訊息', lastMsg(d).kind === 'text' && /已過報名截止時間/.test(lastMsg(d).body));
  }

  // 10. text「我嘅堂」有報名 → 出可撳取消清單
  {
    const d = makeDeps({ bookings: [{ slot_id: 's1', session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT', coach: 'ming', my_status: 'booked' }] });
    await handleInbound({ from: '85291110001', type: 'text', text: { body: '我嘅堂' } }, d);
    const m = lastMsg(d);
    ok('我嘅堂 → list，行 id = cancel:<slotId>', m.kind === 'list' && m.rows[0].id === 'cancel:s1');
    ok('描述顯示狀態', /已報名/.test(m.rows[0].description));
  }

  // 11. 冇報名 → 提示去報堂
  {
    const d = makeDeps({ bookings: [] });
    await handleInbound({ from: '85291110001', type: 'text', text: { body: 'mine' } }, d);
    ok('冇報名 → 出「報堂」掣', lastMsg(d).kind === 'buttons' && lastMsg(d).buttons[0].id === 'menu:book');
  }

  // 12. 撳取消（cancel:s1）→ 叫 cancel()，回確認
  {
    const d = makeDeps();
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'cancel:s1' } } }, d);
    ok('撳取消 → 叫 cancel(s1, stu-1)', d.cancelled.length === 1 && d.cancelled[0].slotId === 's1');
    ok('取消成功 → 確認訊息', /取消報名/.test(lastMsg(d).body));
  }

  // 13. 菜單掣 menu:book / menu:mine
  {
    const d = makeDeps({ slots: [slot('s1')] });
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'menu:book' } } }, d);
    ok('撳「報堂」掣 → 出時段 list', lastMsg(d).kind === 'list');
    const d2 = makeDeps({ bookings: [] });
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'menu:mine' } } }, d2);
    ok('撳「我嘅堂」掣 → 處理到（冇堂出提示）', d2.sent.length === 1);
  }

  // 13b. template 快速回覆掣（type:'button' + payload）→ 當菜單掣處理
  {
    const d = makeDeps({ slots: [slot('s1')] });
    await handleInbound({ from: '85291110001', type: 'button', button: { payload: 'menu:book', text: '📅 報堂' } }, d);
    ok('template button payload menu:book → 出時段 list', lastMsg(d).kind === 'list');
  }

  // 13c. WhatsApp Web 撳掣變咗普通文字（引用返掣 title）→ 靠 title 認返意圖，唔會淨彈招呼
  {
    const d = makeDeps({ slots: [slot('s1')] });
    await handleInbound({ from: '85291110001', type: 'text', text: { body: '📅 報堂' } }, d);
    ok('掣 title「📅 報堂」當文字入 → 出時段 list', lastMsg(d).kind === 'list');
    const d2 = makeDeps({ bookings: [{ slot_id: 's1', session_date: '2026-07-20', start_time: '19:00:00', venue: 'KT', my_status: 'booked' }] });
    await handleInbound({ from: '85291110001', type: 'text', text: { body: '📋 我嘅堂' } }, d2);
    ok('掣 title「📋 我嘅堂」當文字入 → 出我嘅堂 list', lastMsg(d2).kind === 'list' && lastMsg(d2).rows[0].id === 'cancel:s1');
  }

  // 13d. 互動 button_reply 冇 id 但有 title → 靠 title 認返（防守）
  {
    const d = makeDeps({ slots: [slot('s1')] });
    await handleInbound({ from: '85291110001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { title: '📅 報堂' } } }, d);
    ok('button_reply 只有 title → 靠 title 認返 book', lastMsg(d).kind === 'list');
  }

  // 14. intentOf 各關鍵字
  {
    ok('intent: 報堂/book/1', intentOf('報') === 'book' && intentOf('book') === 'book' && intentOf('1') === 'book');
    ok('intent: 我嘅/mine/2', intentOf('我嘅堂') === 'mine' && intentOf('mine') === 'mine' && intentOf('2') === 'mine');
    ok('intent: 取消 → mine', intentOf('取消') === 'mine');
    ok('intent: 亂打 → menu', intentOf('asdf') === 'menu' && intentOf('') === 'menu');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
