// Supabase client（用 service_role key，會繞過 RLS，淨係喺後端行）
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] 未設定 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
