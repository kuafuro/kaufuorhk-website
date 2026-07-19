// 真實依賴:將 Supabase + WhatsApp 接落 booking.js 個 deps 介面。
import { supabase } from './supabase.js';
import { sendMessage, normalizeHkPhone } from './whatsapp.js';

function hkToday() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function hkPlusDays(n) { return new Date(Date.now() + 8 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10); }

export const realDeps = {
  async resolveStudent(waPhone) {
    const phone = normalizeHkPhone(waPhone);
    if (!phone) return null;
    const { data } = await supabase.from('profiles').select('id,name').eq('phone', phone).maybeSingle();
    return data || null;
  },
  async openSlots() {
    const { data, error } = await supabase.rpc('slot_list', { p_from: hkToday(), p_to: hkPlusDays(14) });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async myBookings(studentId) {
    const { data, error } = await supabase.rpc('bot_my_bookings', { p_student: studentId });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async book(slotId, studentId) {
    const { data, error } = await supabase.rpc('bot_book_slot', { p_slot_id: slotId, p_student: studentId });
    if (error) throw new Error(error.message);
    return data;
  },
  async cancel(slotId, studentId) {
    const { data, error } = await supabase.rpc('bot_cancel_booking', { p_slot_id: slotId, p_student: studentId });
    if (error) throw new Error(error.message);
    return data;
  },
  send: (toPhone, message) => sendMessage(toPhone, message),
};
