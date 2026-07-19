// 對話式報堂:學生 1 對 1 send 個 bot → 認返帳戶 → 彈可撳時段清單 → 報名/取消/睇我嘅堂。
//
// 呢個 module 係「純邏輯 + 依賴注入」:所有 IO(查 DB、發 WhatsApp)都由 deps 傳入,
// 方便完整單元測試(見 test/booking.test.js),真正接線喺 index.js。
//
// deps 介面:
//   resolveStudent(waPhone)        -> { id, name } | null
//   openSlots()                    -> [{ id, session_date, start_time, venue, coach, capacity, booked_count, status }]
//   myBookings(studentId)          -> [{ slot_id, session_date, start_time, venue, coach, my_status }]
//   book(slotId, studentId)        -> result json（會 throw error）
//   cancel(slotId, studentId)      -> result json
//   send(toPhone, messageObject)   -> 發一個 WhatsApp 訊息（{kind:'text'|'list'|'buttons', ...}）

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
const VENUE = { KT: '觀塘', MK: '旺角' };
const COACH = { ming: 'Ming', tom: 'Tom' };

function venueLabel(v) { return VENUE[v] || v || '本館'; }
function coachLabel(c) { return COACH[c] || c || ''; }
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const [, m, day] = dateStr.split('-');
  return `${+m}/${+day} ${WEEKDAY[d.getDay()]}`;   // 例 "7/20 六"
}
function fmtTime(t) { return String(t || '').slice(0, 5); }   // "19:00"
function slotTitle(s) { return `${fmtDate(s.session_date)} ${fmtTime(s.start_time)}`; }
function slotDesc(s) {
  const parts = [venueLabel(s.venue), coachLabel(s.coach)];
  if (s.capacity != null && s.booked_count != null) parts.push(`${s.booked_count}/${s.capacity}`);
  return parts.filter(Boolean).join(' · ');
}

// ── 訊息物件（send() 收到會譯做 WhatsApp payload）──
const text = (body) => ({ kind: 'text', body });
const menu = () => ({
  kind: 'buttons',
  body: '你好呀 👋 想做啲乜?',
  buttons: [
    { id: 'menu:book', title: '📅 報堂' },
    { id: 'menu:mine', title: '📋 我嘅堂' },
  ],
});

const NOT_LINKED = text(
  'Hihi 👋 我搵唔到你嘅帳戶。\n\n請先去 kuafuorhk.com/login 登入,喺帳戶頁填返你個 WhatsApp 電話,之後就可以喺呢度直接排堂喇 🙌'
);

// ── 意圖判斷（純文字時用；有可撳掣所以只作補助）──
function intentOf(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return 'menu';
  if (/(取消|cancel|退)/.test(t)) return 'mine';         // 取消都係先出「我嘅堂」再撳
  if (/(報|book|排堂|開始|時段|有咩堂|^1$)/.test(t)) return 'book';
  if (/(我嘅|我的|mine|^my\b|睇堂|查堂|報咗|^2$)/.test(t)) return 'mine';
  return 'menu';
}

// ── 產生「時段清單」訊息 ──
async function slotListMessage(deps) {
  const slots = (await deps.openSlots()) || [];
  const now = slots.filter((s) => (s.status === 'open' || s.status === 'confirmed'));
  if (!now.length) {
    return text('呢排暫時未有開放時段 🙏 遲啲再 send 我「報堂」睇下,或者問返教練。');
  }
  const rows = now.slice(0, 10).map((s) => ({
    id: 'book:' + s.id,
    title: slotTitle(s).slice(0, 24),
    description: slotDesc(s).slice(0, 72),
  }));
  return {
    kind: 'list',
    header: '揀一堂報名',
    body: '撳下面揀你想上嘅堂,夠人（一般 2 位）就自動開班 💪',
    footer: 'Kuafuor 排堂',
    button: '睇時段',
    rows,
  };
}

// ── 產生「我嘅堂」訊息（每項可撳取消）──
async function myBookingsMessage(student, deps) {
  const mine = (await deps.myBookings(student.id)) || [];
  if (!mine.length) {
    return {
      kind: 'buttons',
      body: '你而家冇報緊堂 🈳 撳下面睇下有咩時段👇',
      buttons: [{ id: 'menu:book', title: '📅 報堂' }],
    };
  }
  const rows = mine.slice(0, 10).map((s) => ({
    id: 'cancel:' + s.slot_id,
    title: slotTitle(s).slice(0, 24),
    description: (venueLabel(s.venue) + ' · ' + (s.my_status === 'waitlist' ? '後補中' : '已報名')).slice(0, 72),
  }));
  return {
    kind: 'list',
    header: '你報咗嘅堂',
    body: '撳一個就可以取消報名。',
    footer: 'Kuafuor 排堂',
    button: '我嘅堂',
    rows,
  };
}

function bookedMessage(r) {
  const when = `${fmtDate(r.session_date)} ${fmtTime(r.start_time)} ${venueLabel(r.venue)}`;
  if (r.already) return text(`你之前已經報咗呢堂喇 ✅\n${when}`);
  if (r.status === 'waitlist') return text(`呢堂而家滿咗,幫你排咗後補 📝\n${when}\n有人取消就會自動補上,我會再通知你。`);
  const need = Math.max(0, (r.min_to_open || 0) - (r.booked_count || 0));
  const tail = r.confirmed ? '夠人開班喇 🎉 堂前會提你。' : (need > 0 ? `仲爭 ${need} 個人就開班,得就通知你 👍` : '搞掂 👍');
  return text(`報咗名 ✅\n${when}\n${tail}`);
}
function cancelledMessage(r) {
  if (r && r.ok === false) return text('咦,搵唔到你喺呢堂嘅報名喎 🤔 send「我嘅堂」睇下?');
  const when = r && r.session_date ? `\n${fmtDate(r.session_date)} ${fmtTime(r.start_time)} ${venueLabel(r.venue)}` : '';
  return text(`已經幫你取消報名 ✅${when}`);
}
function errText(e) {
  const m = (e && e.message) ? e.message : String(e);
  return text('唔好意思,搞唔掂 😥 ' + m + '\nsend「報堂」再試多次,或者搵教練。');
}

// ── 主入口:收到一個 inbound WhatsApp 訊息物件 ──
// msg 形如 { from:'85298765432', type:'text'|'interactive', text:{body}, interactive:{...} }
async function handleInbound(msg, deps) {
  const phone = msg && msg.from;
  if (!phone) return;

  const student = await deps.resolveStudent(phone);
  if (!student) { await deps.send(phone, NOT_LINKED); return; }

  // 互動回覆（撳掣/揀清單）
  if (msg.type === 'interactive') {
    const ir = msg.interactive || {};
    const id = (ir.list_reply && ir.list_reply.id) || (ir.button_reply && ir.button_reply.id) || '';
    if (id.startsWith('book:')) {
      try { await deps.send(phone, bookedMessage(await deps.book(id.slice(5), student.id))); }
      catch (e) { await deps.send(phone, errText(e)); }
      return;
    }
    if (id.startsWith('cancel:')) {
      try { await deps.send(phone, cancelledMessage(await deps.cancel(id.slice(7), student.id))); }
      catch (e) { await deps.send(phone, errText(e)); }
      return;
    }
    if (id === 'menu:book') { await deps.send(phone, await slotListMessage(deps)); return; }
    if (id === 'menu:mine') { await deps.send(phone, await myBookingsMessage(student, deps)); return; }
    await deps.send(phone, menu());
    return;
  }

  // 純文字
  const intent = intentOf(msg.text && msg.text.body);
  if (intent === 'book') { await deps.send(phone, await slotListMessage(deps)); return; }
  if (intent === 'mine') { await deps.send(phone, await myBookingsMessage(student, deps)); return; }
  await deps.send(phone, menu());
}

export {
  handleInbound, intentOf, slotListMessage, myBookingsMessage,
  bookedMessage, cancelledMessage, menu, NOT_LINKED,
  fmtDate, fmtTime, venueLabel, coachLabel,
};
