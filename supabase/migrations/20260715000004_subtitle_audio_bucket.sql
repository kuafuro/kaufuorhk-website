-- Private Storage bucket for cloud transcription audio (spec §7).
-- A Pro subtitle user may write/read/delete ONLY under "{their uid}/…"; audio is kept a short
-- window for re-run then swept (see 20260715000005). Applied to ikzoxrvnpsseyjviawti on 2026-07-15.

insert into storage.buckets (id, name, public)
values ('subtitle-audio', 'subtitle-audio', false)
on conflict (id) do nothing;

-- Insert: owner-scoped path AND an active subtitle/all entitlement (server-enforced freemium gate).
drop policy if exists sub_audio_insert on storage.objects;
create policy sub_audio_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'subtitle-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_pro(auth.uid(), 'subtitle')
  );

-- Read own files (also used by the Edge Function's signed-URL creation via service role, which bypasses RLS).
drop policy if exists sub_audio_select on storage.objects;
create policy sub_audio_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'subtitle-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete own files (immediate opt-out; the sweep also deletes on the service role).
drop policy if exists sub_audio_delete on storage.objects;
create policy sub_audio_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'subtitle-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
