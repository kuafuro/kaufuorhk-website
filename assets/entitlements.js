// Reusable freemium/entitlement client. Any tool: import { Entitlements } from '/assets/entitlements.js'
// Free path never touches the network (Supabase is lazy-loaded only on login/upgrade).
import { BILLING } from './billing-config.js';

const T = {
  zh: { title:'升級解鎖', sub:(l)=>`解鎖 ${l} 嘅完整功能`, activating:'正在啟用你嘅訂閱…',
        wait:'可能要等一兩秒,遲啲 refresh 下', buyAll:'Kuafuor Pro（解鎖全部）', mo:'月', close:'閂' },
  en: { title:'Upgrade to unlock', sub:(l)=>`Unlock the full ${l}`, activating:'Activating your subscription…',
        wait:'This can take a moment — refresh shortly', buyAll:'Kuafuor Pro (unlock everything)', mo:'mo', close:'Close' },
};
const lang = () => { try { return (localStorage.getItem('kf-lang')||'zh').startsWith('en') ? 'en' : 'zh'; } catch { return 'zh'; } };
const t = (k, ...a) => { const v = (T[lang()]||T.zh)[k]; return typeof v === 'function' ? v(...a) : v; };

const PROJECT_REF = (() => { try { return new URL(BILLING.SB_URL).hostname.split('.')[0]; } catch { return ''; } })();
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`;   // where supabase-js persists the session
function hasStoredSession() { try { return !!localStorage.getItem(AUTH_KEY); } catch { return false; } }

let _sb = null;                       // lazily created supabase client
async function sb() {                 // load Supabase ONLY when needed (keeps the free path offline)
  if (_sb) return _sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _sb = createClient(BILLING.SB_URL, BILLING.SB_KEY);
  return _sb;
}

class Ent {
  constructor() { this._ent = {}; this._session = null; this._cbs = []; }
  get isLoggedIn() { return !!this._session; }
  on(_e, cb) { this._cbs.push(cb); }
  _emit() { this._cbs.forEach((c) => { try { c(this); } catch (e) { console.warn(e); } }); }

  async _load() {
    // Cheap offline check: no persisted session → not logged in, so never load the Supabase SDK.
    if (!hasStoredSession()) { this._session = null; this._ent = {}; return; }
    try {
      const client = await sb();
      this._session = (await client.auth.getSession()).data.session;
      if (!this._session) { this._ent = {}; return; }
      const { data } = await client.from('entitlements')
        .select('product,status,current_period_end').eq('user_id', this._session.user.id);
      const now = Date.now();
      this._ent = {};
      for (const r of data || []) {
        const ok = r.status === 'active' && (!r.current_period_end || new Date(r.current_period_end).getTime() > now);
        if (ok) this._ent[r.product] = true;
      }
    } catch (e) { console.warn('entitlements load failed', e); }
  }

  hasAccess(tool) { return !!(this._ent.all || this._ent[tool]); }

  requirePro(tool, feature) { if (this.hasAccess(tool)) return true; this._paywall(tool, feature); return false; }

  async upgrade(product) {
    const client = await sb();
    this._session = (await client.auth.getSession()).data.session;
    if (!this._session) {                                  // free tier is anonymous → login, then come back here
      location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    const base = location.origin;
    const res = await fetch(`${BILLING.EDGE_BASE}/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._session.access_token}` },
      body: JSON.stringify({ product, success_url: `${base}${location.pathname}?upgraded=1`, cancel_url: `${base}${location.pathname}` }),
    }).then((r) => r.json());
    if (res.url) location.href = res.url;
    else if (res.portalUrl) location.href = res.portalUrl;
    else if (res.alreadyActive) { await this._load(); this._emit(); }
  }

  async manage() {
    const client = await sb();
    const s = (await client.auth.getSession()).data.session;
    if (!s) return;
    const res = await fetch(`${BILLING.EDGE_BASE}/create-portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ return_url: location.href }),
    }).then((r) => r.json());
    if (res.url) location.href = res.url;
  }

  // After Checkout redirects back with ?upgraded=1, poll until the webhook has written the row.
  async _handleReturn() {
    const p = new URLSearchParams(location.search);
    if (p.get('upgraded') !== '1') return;
    history.replaceState({}, '', location.pathname);       // clean the URL
    const banner = this._banner(t('activating'));
    const backoff = [800, 1200, 1600, 2000, 2400, 3000];
    for (let i = 0; i < backoff.length; i++) {
      await this._load();
      if (Object.keys(this._ent).length) { banner.remove(); this._emit(); return; }
      await new Promise((r) => setTimeout(r, backoff[i]));
    }
    banner.textContent = t('wait'); setTimeout(() => banner.remove(), 6000); this._emit();
  }

  _banner(msg) {
    const b = document.createElement('div');
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:3000;background:#a83228;color:#fff;font:14px/1.5 "Lora",serif;text-align:center;padding:10px';
    b.textContent = msg; document.body.appendChild(b); return b;
  }

  _paywall(tool, feature) {
    const cfg = BILLING.PRODUCTS[tool] || { label: tool, monthly: '' };
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(32,31,29,.5);font-family:"Lora","Noto Serif TC",serif';
    wrap.innerHTML = `
      <div style="background:#f8f4f4;border:1px solid #d7d3d3;border-radius:6px;max-width:420px;width:calc(100% - 32px);padding:28px 24px;color:#201f1d">
        <div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;margin-bottom:6px">${t('title')}</div>
        <p style="font-size:14px;color:#605d5d;margin:0 0 18px">${t('sub', cfg.label)}${feature ? ` · ${feature}` : ''}</p>
        <button data-buy="${tool}" style="width:100%;min-height:46px;margin-bottom:8px;border:1px solid #a83228;background:#a83228;color:#fff;border-radius:4px;font:600 14px 'Cormorant Garamond',serif;cursor:pointer">${cfg.label} — HK$${cfg.monthly}/${t('mo')}</button>
        <button data-buy="all" style="width:100%;min-height:46px;margin-bottom:14px;border:1px solid #a83228;background:transparent;color:#a83228;border-radius:4px;font:600 14px 'Cormorant Garamond',serif;cursor:pointer">${t('buyAll')} — HK$${BILLING.PRODUCTS.all.monthly}/${t('mo')}</button>
        <button data-close style="width:100%;background:none;border:none;color:#605d5d;font-size:13px;cursor:pointer">${t('close')}</button>
      </div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.hasAttribute('data-close')) return close();
      const buy = e.target.getAttribute?.('data-buy'); if (buy) { close(); this.upgrade(buy); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-buy]').focus();
  }
}

export const Entitlements = {
  async init() { const e = new Ent(); await e._load(); await e._handleReturn(); return e; },
};
