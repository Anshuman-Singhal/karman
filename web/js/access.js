/* ==========================================================================
   KÁRMÁN · access.js
   Who can fly Unlimited and the archive.

     free      the daily, every day; ONE free Unlimited run ever
     unlimited a one-time purchase ($6.99) or a valid unlock code

   Two ways in:
     1. Buy: sign in with Google → Stripe Checkout → back to the game. The
        Worker records the purchase against the Google account, so "Restore"
        works on any device. (PAYMENTS: true + Worker secrets; SHIPPING.md 5.)
     2. Unlock code: a link like karman.day/?unlock=PILOT-1234 that you hand
        out. Codes live in the database; set one inactive and it stops
        working the next time that player opens the game.

   Progress itself never needs an account: it lives in this browser.
   ========================================================================== */

K.access = (() => {
  const C = K.CONFIG;
  const DEV_CODE = 'PILOT-TEST';
  const RECHECK_MS = 6 * 3600e3;               // re-validate codes / purchases every 6 h

  const st = () => K.storage.data.access;
  const save = () => K.storage.save();
  const api = (path, opts) => fetch(`${C.API_BASE}${path}`, opts).then((r) => (r.ok ? r.json() : Promise.reject(r)));
  const backend = () => Boolean(C.PAYMENTS || C.STATS);

  const unlimited = () => Boolean(st().unlimited);
  const canArchive = () => unlimited();
  const canKeepFlying = () => unlimited() || !K.storage.data.freeRunUsed;
  const freeRunLeft = () => !unlimited() && !K.storage.data.freeRunUsed;

  function grant(via, extra = {}) {
    Object.assign(st(), { unlimited: true, via, checkedAt: Date.now(), ...extra });
    save();
  }
  function revoke() {
    Object.assign(st(), { unlimited: false, via: null, code: null, checkedAt: Date.now() });
    save();
  }

  /** Redeem an unlock code. Resolves true/false. */
  async function redeem(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return false;
    if (!backend()) {
      if (C.DEV && code === DEV_CODE) { grant('code', { code }); return true; }
      return false;
    }
    try {
      const res = await api(`/api/unlock/${encodeURIComponent(code)}`);
      if (res.valid) { grant('code', { code }); return true; }
    } catch (e) { /* offline or invalid */ }
    return false;
  }

  /** On boot: pick up ?unlock= / ?paid= from the URL, and re-check access now and then. */
  async function refresh() {
    const url = new URL(location.href);
    const code = url.searchParams.get('unlock');
    const paid = url.searchParams.get('paid');
    if (code || paid) {
      url.searchParams.delete('unlock');
      url.searchParams.delete('paid');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    if (code) {
      const ok = await redeem(code);
      K.fx.toast(ok ? 'Unlimited unlocked. Keep flying.' : 'That unlock link isn’t valid any more.');
      if (ok) K.ui.refreshAccess();
      return;
    }
    const a = st();
    if (!a.unlimited || !backend()) return;
    if (!paid && Date.now() - a.checkedAt < RECHECK_MS) return;
    try {
      if (a.via === 'code') {
        const res = await api(`/api/unlock/${encodeURIComponent(a.code)}`);
        if (!res.valid) { revoke(); K.fx.toast('Your unlock code has ended. The daily flight is still free.'); K.ui.refreshAccess(); }
        else { a.checkedAt = Date.now(); save(); }
      } else if (a.via === 'stripe' && a.session) {
        const me = await api('/api/me', { headers: { authorization: `Bearer ${a.session}` } });
        if (!me.unlimited) { revoke(); K.ui.refreshAccess(); }
        else { a.checkedAt = Date.now(); save(); }
      }
    } catch (e) { /* offline: keep what we have */ }
  }

  /* ---------------------------------------------------------- Google + Stripe */
  let gisLoaded = null;
  function loadGoogle() {
    if (gisLoaded) return gisLoaded;
    gisLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return gisLoaded;
  }

  /** Render Google's own sign-in button into `el`; resolves with the ID token. */
  async function googleButton(el) {
    await loadGoogle();
    return new Promise((resolve) => {
      google.accounts.id.initialize({ client_id: C.GOOGLE_CLIENT_ID, callback: (r) => resolve(r.credential) });
      google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
    });
  }

  /** After sign-in: either restore an earlier purchase or open Stripe Checkout. */
  async function buyWith(idToken) {
    const res = await api('/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, returnTo: location.origin }),
    });
    if (res.session) Object.assign(st(), { session: res.session });
    if (res.unlimited) { grant('stripe', { session: res.session }); return 'restored'; }
    save();
    location.href = res.url;                      // Stripe Checkout; returns to /?paid=1
    return 'redirect';
  }

  /** Dev only: pretend a purchase went through. */
  function simulatePurchase() { grant('stripe', { session: 'dev' }); }

  /** Tell the server a paid player started an Unlimited/archive flight (for the refund rule). */
  function notePlay(kind) {
    const a = st();
    if (!backend() || a.via !== 'stripe' || !a.session || a.session === 'dev') return;
    fetch(`${C.API_BASE}/api/play`, { method: 'POST', headers: { authorization: `Bearer ${a.session}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind }), keepalive: true }).catch(() => {});
  }

  return { unlimited, canArchive, canKeepFlying, freeRunLeft, redeem, refresh, googleButton, buyWith, simulatePurchase, notePlay, backend, revoke };
})();
