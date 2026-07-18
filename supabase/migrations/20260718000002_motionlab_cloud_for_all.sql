-- 雲端精析開放俾所有登入用戶（Ming 2026-07-18：全部行雲端好啲）。
-- 唔蝕錢改由配額把關：pose-fast 收 free 10 / pro 60 / max 180 分鐘/月，先查先開 GPU。
-- bucket 加 200MB 硬上限（client 嗰個 cap RLS 唔會幫你執）。12 小時 sweep 照舊。Applied live.
drop policy if exists ml_video_insert on storage.objects;
create policy ml_video_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'motionlab-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
update storage.buckets set file_size_limit = 209715200 where id = 'motionlab-video';
