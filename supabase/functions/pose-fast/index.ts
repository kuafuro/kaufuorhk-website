// pose-fast — START an async Motion Lab cloud analysis (mirrors transcribe-fast).
//   auth (user JWT) -> tier quota pre-flight -> pending job ->
//   pre-sign the input download URL + the annotated-output UPLOAD URL -> spawn Modal -> { job_id }.
// The client polls public.motion_jobs until done/error. Modal posts back to pose-callback.
//   200: { job_id, tier, quota }
//   402: { error:'quota', tier, used_min, quota }   403 forbidden path
//   503 endpoint_unconfigured · 502 spawn error
// 雲端開放俾所有登入用戶（2026-07-18）。唔蝕錢改由配額把關：free 10 / pro 60 / max 180
// 分鐘/月，先查先開 GPU；3 分鐘/條上限（Modal 內再硬檢查）；影片 12 小時 sweep 剷走。
// Config: POSE_URL + SENSEVOICE_TOKEN from Vault via pose_config() (service-role RPC).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const QUOTA_MIN: Record<string, number> = { free: 10, pro: 60, max: 180 };
const MAX_MS = 183_000;

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
    const estMs = Math.max(0, Number(duration_ms ?? 0));
    if (estMs > MAX_MS) return json({ error: 'too_long', max_ms: MAX_MS }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: tierRaw } = await admin.rpc('entitlement_tier', { p_user: user.id, p_product: 'motionlab' });
    const tier = (tierRaw as string) || 'free';
    const quota = QUOTA_MIN[tier] ?? QUOTA_MIN.free;
    const { data: usedRaw } = await admin.rpc('motionlab_minutes_this_month', { p_user: user.id });
    const usedMin = Number(usedRaw ?? 0);
    const estMin = estMs / 60000;
    if (usedMin >= quota || (estMin > 0 && usedMin + estMin > quota)) {
      return json({ error: 'quota', tier, used_min: Math.round(usedMin), quota }, 402);
    }

    const { data: cfg } = await admin.rpc('pose_config');
    const POSE_URL = (cfg?.POSE_URL as string) || Deno.env.get('POSE_URL') || '';
    const POSE_TOKEN = (cfg?.SENSEVOICE_TOKEN as string) || Deno.env.get('SENSEVOICE_TOKEN') || '';
    if (!POSE_URL || !POSE_TOKEN) return json({ error: 'endpoint_unconfigured' }, 503);

    // Pending job first（poll 一定搵到row）；out_path 預先定好
    const { data: job, error: jobErr } = await admin.from('motion_jobs')
      .insert({ user_id: user.id, status: 'pending', storage_path, tier, quota_min: quota })
      .select('id').single();
    if (jobErr || !job) return json({ error: 'job_create_failed', detail: jobErr?.message }, 500);
    const outPath = `${user.id}/out/${job.id}.mp4`;
    await admin.from('motion_jobs').update({ out_path: outPath }).eq('id', job.id);

    // 入片簽 30 分鐘下載；出片簽 upload URL（Modal 用 PUT，零額外憑證）
    const { data: signedIn, error: sErr } =
      await admin.storage.from('motionlab-video').createSignedUrl(storage_path, 1800);
    if (sErr || !signedIn?.signedUrl) return json({ error: 'sign_failed', detail: sErr?.message }, 500);
    const { data: signedOut, error: uErr } =
      await admin.storage.from('motionlab-video').createSignedUploadUrl(outPath);
    if (uErr || !signedOut?.signedUrl) return json({ error: 'sign_up_failed', detail: uErr?.message }, 500);

    const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/pose-callback`;
    try {
      const r = await fetch(POSE_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${POSE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: signedIn.signedUrl,
          out_put_url: signedOut.signedUrl,
          callback_url: callbackUrl,
          job_id: job.id,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        await admin.from('motion_jobs').update({ status: 'error', error: ('spawn failed: ' + t).slice(0, 500) }).eq('id', job.id);
        return json({ error: 'spawn_failed', status: r.status, detail: t.slice(0, 300) }, 502);
      }
    } catch (e) {
      await admin.from('motion_jobs').update({ status: 'error', error: ('endpoint unreachable: ' + e).slice(0, 500) }).eq('id', job.id);
      return json({ error: 'endpoint_unreachable', detail: String(e) }, 502);
    }

    return json({ job_id: job.id, tier, quota });
  } catch (e) {
    console.error('pose-fast error', e);
    return json({ error: (e as Error).message }, 500);
  }
});
