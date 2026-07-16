// ci-config — trust anchor for the CI Modal deploy (no secrets in the public repo).
// The modal-deploy GitHub Actions workflow authenticates with its GitHub-issued OIDC token
// (verified here against GitHub's public JWKS + strict repo/workflow claims), then either:
//   { oidc_token }                                  -> returns deploy credentials from Vault
//   { oidc_token, register: { SENSEVOICE_URL } }    -> stores the deployed endpoint URL in Vault
// Only a workflow run of .github/workflows/modal-deploy.yml in kuafuro/kaufuorhk-website can
// pass verification — forks present their own repository claim and are rejected.
// Deploy with verify_jwt=false (it does its own, stronger, verification).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5';

const ISSUER = 'https://token.actions.githubusercontent.com';
const AUDIENCE = 'kuafuor-ci';
const REPO = 'kuafuro/kaufuorhk-website';
const WORKFLOW_PREFIX = `${REPO}/.github/workflows/modal-deploy.yml@`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: { oidc_token?: string; register?: { SENSEVOICE_URL?: string } };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body.oidc_token) return json({ error: 'oidc_token required' }, 400);

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(body.oidc_token, JWKS, { issuer: ISSUER, audience: AUDIENCE });
    claims = payload as Record<string, unknown>;
  } catch (e) {
    return json({ error: 'oidc verification failed', detail: String(e).slice(0, 200) }, 401);
  }
  if (claims.repository !== REPO || !String(claims.workflow_ref ?? '').startsWith(WORKFLOW_PREFIX)) {
    return json({ error: 'claims mismatch' }, 403);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (body.register) {
    const url = body.register.SENSEVOICE_URL ?? '';
    if (!/^https:\/\/[a-zA-Z0-9._-]+\.modal\.run$/.test(url)) return json({ error: 'bad url' }, 400);
    const { error } = await admin.rpc('vault_set_secret', { p_name: 'SENSEVOICE_URL', p_value: url });
    if (error) return json({ error: error.message }, 500);
    return json({ registered: true });
  }

  const { data, error } = await admin.rpc('ci_config');
  if (error) return json({ error: error.message }, 500);
  return json(data ?? {});
});
