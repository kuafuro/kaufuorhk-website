// transcribe-fast — authenticated (user JWT). Runs SenseVoice cloud transcription for a Pro
// subtitle user, metered against the tier's monthly minute quota (spec §6).
//   input:  { storage_path, duration_ms }   (audio already uploaded to `subtitle-audio` by the client)
//   200:    { segments, duration_ms, tier, used_min, quota }
//   402:    { error:'quota', tier, used_min, quota }   -> client shows upgrade-to-Max, free local still works
//   403 not_pro / forbidden path · 503 endpoint_unconfigured · 502 endpoint error
// Secrets required: SENSEVOICE_URL, SENSEVOICE_TOKEN. (SUPABASE_* are auto-injected.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SENSEVOICE_URL = Deno.env.get('SENSEVOICE_URL') ?? '';
const SENSEVOICE_TOKEN = Deno.env.get('SENSEVOICE_TOKEN') ?? '';
// Monthly cloud-fast minute quota per tier (spec §2.5). Priced to never lose money at full quota.
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
    // Ownership: the path must live under this user's folder ("{uid}/…").
    if (!storage_path.startsWith(user.id + '/')) return json({ error: 'forbidden path' }, 403);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Pro gate (server-side; Storage RLS also enforces on upload).
    const { data: pro } = await admin.rpc('has_pro', { p_user: user.id, p_product: 'subtitle' });
    if (!pro) return json({ error: 'not_pro' }, 403);

    // Tier + monthly quota.
    const { data: tierRaw } = await admin.rpc('entitlement_tier', { p_user: user.id, p_product: 'subtitle' });
    const tier = (tierRaw as string) || 'pro';
    const quota = QUOTA_MIN[tier] ?? QUOTA_MIN.pro;
    const { data: usedRaw } = await admin.rpc('transcribe_minutes_this_month', { p_user: user.id });
    const usedMin = Number(usedRaw ?? 0);
    const estMin = Math.max(0, Number(duration_ms ?? 0)) / 60000;

    // Pre-flight: block a request that would clearly exceed the remaining quota — so we don't pay
    // the GPU for a transcription we then refuse. Over quota -> 402 -> client offers upgrade-to-Max.
    if (usedMin >= quota || (estMin > 0 && usedMin + estMin > quota)) {
      return json({ error: 'quota', tier, used_min: Math.round(usedMin), quota }, 402);
    }

    if (!SENSEVOICE_URL || !SENSEVOICE_TOKEN) return json({ error: 'endpoint_unconfigured' }, 503);

    // Short-lived signed URL for the endpoint to fetch the audio (service role bypasses RLS).
    const { data: signed, error: signErr } =
      await admin.storage.from('subtitle-audio').createSignedUrl(storage_path, 300);
    if (signErr || !signed?.signedUrl) return json({ error: 'sign_failed', detail: signErr?.message }, 500);

    // Call the SenseVoice endpoint (POST directly to SENSEVOICE_URL — it IS the /transcribe endpoint).
    let payload: { segments?: unknown[]; duration_ms?: number };
    try {
      const r = await fetch(SENSEVOICE_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SENSEVOICE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: signed.signedUrl, language: 'yue', diarize: true }),
      });
      if (!r.ok) {
        const t = await r.text();
        return json({ error: 'transcribe_failed', status: r.status, detail: t.slice(0, 300) }, 502);
      }
      payload = await r.json();
    } catch (e) {
      return json({ error: 'endpoint_unreachable', detail: String(e) }, 502);
    }

    // Meter the ACTUAL duration reported by the endpoint (authoritative), not the client's estimate.
    const actualMin = Math.max(0, Number(payload.duration_ms ?? duration_ms ?? 0)) / 60000;
    await admin.from('usage_transcribe').insert({
      user_id: user.id, minutes: Number(actualMin.toFixed(3)), storage_path,
    });

    return json({
      segments: payload.segments ?? [],
      duration_ms: payload.duration_ms ?? 0,
      tier, quota,
      used_min: Math.round(usedMin + actualMin),
    });
  } catch (e) {
    console.error('transcribe-fast error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
