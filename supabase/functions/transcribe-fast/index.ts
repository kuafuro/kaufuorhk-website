// transcribe-fast — START an async cloud transcription (spec §6, async redesign).
//   auth (user JWT) -> has_pro('subtitle') -> tier quota pre-flight -> create a pending job ->
//   ask the Modal endpoint to transcribe in the BACKGROUND (returns fast) -> return { job_id }.
// The client polls public.transcribe_jobs until status = done/error. Modal posts the result to
// transcribe-callback when finished, so a long cold start never times out this request.
//   200: { job_id, tier, quota }
//   402: { error:'quota', tier, used_min, quota }   403 not_pro / forbidden path
//   503 endpoint_unconfigured · 502 spawn/endpoint error
// Config: SENSEVOICE_URL + SENSEVOICE_TOKEN from Vault via transcribe_config() (service-role RPC),
// env-var fallback. (SUPABASE_* auto-injected.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const QUOTA_MIN: Record<string, number> = { pro: 300, max: 1200 };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authz = req.headers.get('Authorization') ?? '';
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authz } },
    });
    const { data: { user } } = await asUser.auth.getUser(authz.replace('Bearer ', ''));
    if (!user) return json({ error: 'not signed in' }, 401);

    const { storage_path, duration_ms } = await req.json();
    if (!storage_path || typeof storage_path !== 'string') return json({ error: 'storage_path required' }, 400);
    if (!storage_path.startsWith(user.id + '/')) return json({ error: 'forbidden path' }, 403);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: pro } = await admin.rpc('has_pro', { p_user: user.id, p_product: 'subtitle' });
    if (!pro) return json({ error: 'not_pro' }, 403);

    const { data: tierRaw } = await admin.rpc('entitlement_tier', { p_user: user.id, p_product: 'subtitle' });
    const tier = (tierRaw as string) || 'pro';
    const quota = QUOTA_MIN[tier] ?? QUOTA_MIN.pro;
    const { data: usedRaw } = await admin.rpc('transcribe_minutes_this_month', { p_user: user.id });
    const usedMin = Number(usedRaw ?? 0);
    const estMin = Math.max(0, Number(duration_ms ?? 0)) / 60000;
    if (usedMin >= quota || (estMin > 0 && usedMin + estMin > quota)) {
      return json({ error: 'quota', tier, used_min: Math.round(usedMin), quota }, 402);
    }

    const { data: cfg } = await admin.rpc('transcribe_config');
    const SENSEVOICE_URL = (cfg?.SENSEVOICE_URL as string) || Deno.env.get('SENSEVOICE_URL') || '';
    const SENSEVOICE_TOKEN = (cfg?.SENSEVOICE_TOKEN as string) || Deno.env.get('SENSEVOICE_TOKEN') || '';
    if (!SENSEVOICE_URL || !SENSEVOICE_TOKEN) return json({ error: 'endpoint_unconfigured' }, 503);

    // Signed URL valid long enough to cover a cold start + long transcription (30 min).
    const { data: signed, error: signErr } =
      await admin.storage.from('subtitle-audio').createSignedUrl(storage_path, 1800);
    if (signErr || !signed?.signedUrl) return json({ error: 'sign_failed', detail: signErr?.message }, 500);

    // Create the pending job first, so a poll always finds a row.
    const { data: job, error: jobErr } = await admin.from('transcribe_jobs')
      .insert({ user_id: user.id, status: 'pending', storage_path, tier, quota_min: quota })
      .select('id').single();
    if (jobErr || !job) return json({ error: 'job_create_failed', detail: jobErr?.message }, 500);

    // Ask Modal to spawn the background job. This returns fast (just an ack); the heavy work runs
    // on Modal and posts back to transcribe-callback.
    try {
      const r = await fetch(SENSEVOICE_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SENSEVOICE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: signed.signedUrl, job_id: job.id, language: 'yue', diarize: true }),
      });
      if (!r.ok) {
        const t = await r.text();
        await admin.from('transcribe_jobs').update({ status: 'error', error: ('spawn failed: ' + t).slice(0, 500) }).eq('id', job.id);
        return json({ error: 'spawn_failed', status: r.status, detail: t.slice(0, 300) }, 502);
      }
    } catch (e) {
      await admin.from('transcribe_jobs').update({ status: 'error', error: ('endpoint unreachable: ' + e).slice(0, 500) }).eq('id', job.id);
      return json({ error: 'endpoint_unreachable', detail: String(e) }, 502);
    }

    return json({ job_id: job.id, tier, quota });
  } catch (e) {
    console.error('transcribe-fast error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
