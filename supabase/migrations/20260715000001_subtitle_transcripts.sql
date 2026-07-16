-- Opt-in cloud storage for the subtitle tool. Audio is never uploaded; only the text
-- transcript + segments, and ONLY when a Pro user explicitly saves. Applied 2026-07-15.
create table if not exists public.subtitle_transcripts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'transcript' check (char_length(name) <= 200),
  body       text not null default ''           check (char_length(body) <= 500000),
  segments   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sub_tx_user_idx on public.subtitle_transcripts (user_id, created_at desc);

alter table public.subtitle_transcripts enable row level security;

drop policy if exists sub_tx_select on public.subtitle_transcripts;
create policy sub_tx_select on public.subtitle_transcripts
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists sub_tx_delete on public.subtitle_transcripts;
create policy sub_tx_delete on public.subtitle_transcripts
  for delete to authenticated using (auth.uid() = user_id);

-- Insert ONLY if owner AND holds an active subtitle/all entitlement (server-enforced freemium gate).
drop policy if exists sub_tx_insert on public.subtitle_transcripts;
create policy sub_tx_insert on public.subtitle_transcripts
  for insert to authenticated
  with check (auth.uid() = user_id and public.has_pro(auth.uid(), 'subtitle'));
