-- Async cloud transcription jobs (spec §6, async redesign). transcribe-fast creates a pending job
-- and returns immediately; Modal transcribes in the background and posts the result to
-- transcribe-callback, which marks the job done + records usage. The client polls this table.
-- Applied to ikzoxrvnpsseyjviawti on 2026-07-16.
create table if not exists public.transcribe_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','processing','done','error')),
  storage_path text not null,
  tier         text not null default 'pro',
  quota_min    int,
  segments     jsonb not null default '[]'::jsonb,
  duration_ms  int,
  used_min     int,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists transcribe_jobs_user_idx on public.transcribe_jobs (user_id, created_at desc);

alter table public.transcribe_jobs enable row level security;
-- Owner may read own jobs (for polling). No client write path — transcribe-fast/transcribe-callback
-- write via the service role.
drop policy if exists transcribe_jobs_select on public.transcribe_jobs;
create policy transcribe_jobs_select on public.transcribe_jobs
  for select to authenticated using (auth.uid() = user_id);
