-- Motion Lab ☁️ 雲端精析（Pro）：private video bucket + async jobs + usage metering + sweep helper.
-- 唔蝕錢設計：upload 由 RLS 用 has_pro('motionlab') 把關；pose-fast 先查配額先開 GPU job；
-- Modal scale-to-zero；影片（入＋出）12 小時內由 sweep 剷走。Applied to ikzoxrvnpsseyjviawti.

-- 1. Private bucket；Pro 先寫得、只可以寫自己 {uid}/… 路徑
insert into storage.buckets (id, name, public)
values ('motionlab-video', 'motionlab-video', false)
on conflict (id) do nothing;

drop policy if exists ml_video_insert on storage.objects;
create policy ml_video_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'motionlab-video'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_pro(auth.uid(), 'motionlab')
  );
drop policy if exists ml_video_select on storage.objects;
create policy ml_video_select on storage.objects
  for select to authenticated
  using (bucket_id = 'motionlab-video' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists ml_video_delete on storage.objects;
create policy ml_video_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'motionlab-video' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Async jobs（client 只可以 poll 自己嘅；寫入全部經 service role）
create table if not exists public.motion_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','processing','done','error')),
  storage_path text not null,
  out_path     text,
  tier         text not null default 'pro',
  quota_min    int,
  stats        jsonb not null default '{}'::jsonb,
  duration_ms  int,
  used_min     int,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists motion_jobs_user_idx on public.motion_jobs (user_id, created_at desc);
alter table public.motion_jobs enable row level security;
drop policy if exists motion_jobs_select on public.motion_jobs;
create policy motion_jobs_select on public.motion_jobs
  for select to authenticated using (auth.uid() = user_id);

-- 3. 用量（分鐘）：只有 edge functions（service role）寫
create table if not exists public.usage_motionlab (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  minutes      numeric not null default 0 check (minutes >= 0),
  storage_path text,
  created_at   timestamptz not null default now()
);
create index if not exists usage_ml_user_month_idx on public.usage_motionlab (user_id, created_at desc);
alter table public.usage_motionlab enable row level security;
drop policy if exists usage_ml_select on public.usage_motionlab;
create policy usage_ml_select on public.usage_motionlab
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.motionlab_minutes_this_month(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutes), 0)
  from public.usage_motionlab
  where user_id = p_user
    and created_at >= date_trunc('month', now());
$$;
revoke all on function public.motionlab_minutes_this_month(uuid) from public, anon;
grant execute on function public.motionlab_minutes_this_month(uuid) to authenticated, service_role;

-- 4. sweep helper（12 小時 retention，入片＋出片一齊剷）
create or replace function public.expired_motionlab_video(p_hours int default 12)
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'motionlab-video'
    and o.created_at < now() - make_interval(hours => p_hours)
  limit 1000;
$$;
revoke all on function public.expired_motionlab_video(int) from public, anon, authenticated;
grant execute on function public.expired_motionlab_video(int) to service_role;

-- 5. pose pipeline config（Vault，service-role only）
create or replace function public.pose_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('POSE_URL','SENSEVOICE_TOKEN','CALLBACK_SECRET','SWEEP_SECRET');
$$;
revoke all on function public.pose_config() from public, anon, authenticated;
grant execute on function public.pose_config() to service_role;
