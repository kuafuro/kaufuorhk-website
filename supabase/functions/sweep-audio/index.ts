// sweep-audio — deletes cloud-pipeline media older than the retention windows: transcription
// audio (6h) and Motion Lab cloud video in+out (12h).
// Called hourly by pg_cron with header x-sweep-secret. Config (SWEEP_SECRET) comes from Vault via
// the service-role-only transcribe_config() RPC (env fallback). Expired object names come from the
// expired_subtitle_audio() RPC because PostgREST does not expose the storage schema to .schema().
// Deploy with verify_jwt=false.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RETENTION_HOURS = 6;        // subtitle audio
const VIDEO_RETENTION_HOURS = 12; // motion lab 雲端片（入片＋已標註出片）

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await admin.rpc('transcribe_config');
  const secret = (cfg?.SWEEP_SECRET as string) || Deno.env.get('SWEEP_SECRET') || '';
  if (!secret || req.headers.get('x-sweep-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const out: Record<string, number> = { audio: 0, video: 0 };
  {
    const { data: names, error } = await admin.rpc('expired_subtitle_audio', { p_hours: RETENTION_HOURS });
    if (error) return new Response(`query error: ${error.message}`, { status: 500 });
    const paths = (names ?? []).filter(Boolean);
    if (paths.length) {
      const { error: delErr } = await admin.storage.from('subtitle-audio').remove(paths);
      if (delErr) return new Response(`delete error: ${delErr.message}`, { status: 500 });
      out.audio = paths.length;
    }
  }
  {
    const { data: names, error } = await admin.rpc('expired_motionlab_video', { p_hours: VIDEO_RETENTION_HOURS });
    if (error) return new Response(`video query error: ${error.message}`, { status: 500 });
    const paths = (names ?? []).filter(Boolean);
    if (paths.length) {
      const { error: delErr } = await admin.storage.from('motionlab-video').remove(paths);
      if (delErr) return new Response(`video delete error: ${delErr.message}`, { status: 500 });
      out.video = paths.length;
    }
  }
  return new Response(JSON.stringify({ removed: out.audio + out.video, ...out }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
