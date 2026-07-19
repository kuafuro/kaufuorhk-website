// transcribe-fast — START an async cloud transcription (spec §6, async redesign).
//   auth (user JWT) -> is_tech_staff (內部測試：holder＋技術人員) -> tier quota pre-flight -> create a pending job ->
//   ask the Modal endpoint to transcribe in the BACKGROUND (returns fast) -> return { job_id }.
// The client polls public.transcribe_jobs until status = done/error. Modal posts the result to
// transcribe-callback when finished, so a long cold start never times out this request.
//   body.engine: 'accurate'（預設・Whisper large-v3・有逐段 confidence）|
//                'fast'（SenseVoice・講者分離＋背景音標註）
//   —— 產品原則（Ming 2026-07-18）：一定要準行先，預設用最準嗰個。
//   200: { job_id, tier, quota }
//   402: { error:'quota', tier, used_min, quota }   403 not_pro / forbidden path
//   503 endpoint_unconfigured · 502 spawn/endpoint error
// Config: SENSEVOICE_URL / WHISPER_URL + SENSEVOICE_TOKEN from Vault via transcribe_config()
// (service-role RPC), env-var fallback. (SUPABASE_* auto-injected.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const QUOTA_MIN: Record<string, number> = { pro: 300, max: 1200 };

const cors = {
  'Access-Control-Allow-Origin': '*',
  // apikey/x-client-info 都准埋：有啲 client 會自動帶，唔准嘅話 preflight 直接被拒，
  // 前端只會見到「Failed to fetch」（2026-07-18 雲端字幕壞咗嗰單就係咁）
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
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

    const { storage_path, duration_ms, engine } = await req.json();
    if (!storage_path || typeof storage_path !== 'string') return json({ error: 'storage_path required' }, 400);
    if (!storage_path.startsWith(user.id + '/')) return json({ error: 'forbidden path' }, 403);
    const useAccurate = engine !== 'fast';   // 預設準確模式

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 內部測試期間：雲端轉字幕只限 holder（admin）＋ 技術人員（developer）。
    // 其他登入用戶（就算 Pro）一律擋——避免 Modal/Gemini 未穩定就燒錢（Ming 2026-07-19）。
    // 呢個係權威閘（server-side）；前端只係唔顯示雲端路，唔可以靠佢做保護。
    const { data: techStaff } = await admin.rpc('is_tech_staff', { p_user: user.id });
    if (!techStaff) {
      return json({
        error: 'internal_only',
        detail: '雲端轉字幕測試中，暫時只限內部（Holder／技術人員）。可以用返免費本地引擎。',
      }, 403);
    }

    // 內部人員唔使 Pro entitlement；tier 攞唔到就當 pro（配額做安全上限，防走數）。
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
    const WHISPER_URL = (cfg?.WHISPER_URL as string) || Deno.env.get('WHISPER_URL') || '';
    const SENSEVOICE_TOKEN = (cfg?.SENSEVOICE_TOKEN as string) || Deno.env.get('SENSEVOICE_TOKEN') || '';
    // 準確模式未 register（CI 未行過）就自動用返 SenseVoice——寧可快唔好死
    const ENDPOINT = useAccurate && WHISPER_URL ? WHISPER_URL : SENSEVOICE_URL;
    if (!ENDPOINT || !SENSEVOICE_TOKEN) return json({ error: 'endpoint_unconfigured' }, 503);

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
      const r = await fetch(ENDPOINT, {
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
