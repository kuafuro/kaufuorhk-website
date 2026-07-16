// sweep-audio — deletes cloud-transcription audio older than the retention window (spec §7).
// Not user-facing: call it on a schedule (pg_cron/pg_net or Supabase Dashboard Cron) with a
// header  x-sweep-secret: {SWEEP_SECRET}. Deletes files in `subtitle-audio` older than RETENTION_HOURS
// via the Storage API (proper physical deletion, not an orphaning row delete).
// Secrets required: SWEEP_SECRET. (SUPABASE_* auto-injected.) Deploy with verify_jwt=false.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RETENTION_HOURS = 6;
const SWEEP_SECRET = Deno.env.get('SWEEP_SECRET') ?? '';

Deno.serve(async (req) => {
  if (!SWEEP_SECRET || req.headers.get('x-sweep-secret') !== SWEEP_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const cutoff = Date.now() - RETENTION_HOURS * 3600 * 1000;

  // Find expired objects from the metadata table, then delete via the Storage API by path.
  const { data: rows, error } = await admin
    .schema('storage').from('objects')
    .select('name, created_at')
    .eq('bucket_id', 'subtitle-audio')
    .lt('created_at', new Date(cutoff).toISOString())
    .limit(1000);
  if (error) return new Response(`query error: ${error.message}`, { status: 500 });

  const paths = (rows ?? []).map((r: { name: string }) => r.name).filter(Boolean);
  let removed = 0;
  if (paths.length) {
    const { error: delErr } = await admin.storage.from('subtitle-audio').remove(paths);
    if (delErr) return new Response(`delete error: ${delErr.message}`, { status: 500 });
    removed = paths.length;
  }
  return new Response(JSON.stringify({ removed }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
