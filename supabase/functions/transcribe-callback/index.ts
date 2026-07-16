// transcribe-callback — Modal posts a finished (or failed) job result here when the background
// transcription completes. verify_jwt=false; authenticated by a shared x-callback-secret (Modal
// holds the same value; ours lives in Vault via transcribe_config(), env fallback). Marks the job
// done/error and records actual usage. Idempotent: only the call that transitions the job out of
// pending/processing records usage.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await admin.rpc('transcribe_config');
  const CALLBACK_SECRET = (cfg?.CALLBACK_SECRET as string) || Deno.env.get('CALLBACK_SECRET') || '';
  if (!CALLBACK_SECRET || req.headers.get('x-callback-secret') !== CALLBACK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  let body: { job_id?: string; segments?: unknown[]; duration_ms?: number; error?: string };
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const { job_id, segments, duration_ms, error } = body || {};
  if (!job_id) return new Response('job_id required', { status: 400 });

  if (error) {
    await admin.from('transcribe_jobs')
      .update({ status: 'error', error: String(error).slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', job_id).neq('status', 'done');
    return new Response('ok', { status: 200 });
  }

  const durMs = Math.max(0, Number(duration_ms ?? 0));
  const usedMin = Math.round(durMs / 60000);
  // Idempotent transition -> done; only the row that actually flips records usage (avoids double count).
  const { data: flipped } = await admin.from('transcribe_jobs')
    .update({ status: 'done', segments: segments ?? [], duration_ms: durMs, used_min: usedMin, updated_at: new Date().toISOString() })
    .eq('id', job_id).in('status', ['pending', 'processing'])
    .select('user_id, storage_path').maybeSingle();

  if (flipped?.user_id) {
    await admin.from('usage_transcribe').insert({
      user_id: flipped.user_id, minutes: Number((durMs / 60000).toFixed(3)), storage_path: flipped.storage_path,
    });
  }
  return new Response('ok', { status: 200 });
});
