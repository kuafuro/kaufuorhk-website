-- WhatsApp bot 帳戶連結（已套用到 Supabase project ikzoxrvnpsseyjviawti）
-- 學生喺 /login/ 帳戶頁儲存自己嘅 WhatsApp 號碼（標準化：純數字＋國家碼，例 85291234567）。
-- 之後 WhatsApp 排堂機械人收到訊息，用 wa 號碼對返 profiles 就知係邊個學生。
alter table public.profiles add column if not exists phone text;
alter table public.profiles add constraint profiles_phone_digits
  check (phone is null or phone = '' or phone ~ '^[0-9]{8,15}$');
-- 一個號碼只可連結一個帳戶（bot 對號入座要唯一）
create unique index if not exists profiles_phone_uniq
  on public.profiles(phone) where phone is not null and phone <> '';
-- 用戶可以改自己嘅 phone（profiles 嘅 UPDATE RLS 已限自己行／admin）
grant update(phone) on public.profiles to authenticated;
