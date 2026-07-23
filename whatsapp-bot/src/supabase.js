// Supabase client（用 service_role key，會繞過 RLS，淨係喺後端行）
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 唔配置就 export null（唔喺 import 度 throw）——咁 health server 照起得到，
// Railway 睇到「running ✅」+ 清楚 log，唔會 cryptic crash-loop。runReminders /
// runCancelNotices 見到 null 會 early-return 兼 log。
export const supabaseReady = Boolean(url && key);
if (!supabaseReady) {
  console.warn('[supabase] ⚠️ 未設定 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — 掃描會跳過，請喺 Railway 補返環境變數');
}

export const supabase = supabaseReady
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
