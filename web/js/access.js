/* ==========================================================================
   KÁRMÁN · access.js
   Who can fly Unlimited and the archive.

     free      the daily, every day; ONE free Unlimited run ever
     unlimited a one-time purchase ($5.99) or a valid unlock code

   Two ways in:
     1. Buy: sign in with Google → Stripe Checkout → back to the game. The
        Worker records the purchase against the Google account, so "Restore"
        works on any device. (PAYMENTS: true + Worker secrets; SHIPPING.md 5.)
     2. Free pass: a link like karman.day/?unlock=PASS-R8ZD-4FUE (or just the code) that you hand
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
  // A free pass (PASS-…) belongs to the first device that opens it: the server
  // matches it to this browser's random stats id.
  const unlockUrl = (code) => `/api/unlock/${encodeURIComponent(code)}?device=${encodeURIComponent(K.storage.data.device || '')}`;
  let lastRefusal = null;
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
  /** Whatever was typed or pasted → a code: a whole link, "PASS-R8ZD-4FUE",
      "pass r8zd 4fue" or just "R8ZD4FUE" all work. */
  function normalize(raw) {
    let s = String(raw || '').trim();
    const m = s.match(/[?&]unlock=([^&#\s]+)/i);
    if (m) s = decodeURIComponent(m[1]);
    s = s.toUpperCase();
    const bare = s.replace(/[^A-Z0-9]/g, '');
    const body = bare.startsWith('PASS') && bare.length === 12 ? bare.slice(4) : bare.length === 8 ? bare : null;
    if (body && /^[A-HJ-NP-Z2-9]{8}$/.test(body)) return `PASS-${body.slice(0, 4)}-${body.slice(4)}`;
    return s.replace(/\s+/g, '');
  }

  async function redeem(raw) {
    const code = normalize(raw);
    if (!code) return false;
    if (!backend()) {
      if (C.DEV && !K.LIVE && code === DEV_CODE) { grant('code', { code }); return true; }
      return false;
    }
    lastRefusal = null;
    try {
      const res = await api(unlockUrl(code));
      if (res.valid) { grant('code', { code }); try { K.stats.event('pass_redeem'); } catch (e) { /* stats only */ } return true; }
      lastRefusal = res.reason || null;
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
      if (ok) { K.ui.welcome('pass'); K.ui.refreshAccess(); }
      else K.fx.toast(lastRefusal === 'claimed' ? 'That pass is already in use on another device.' : 'That unlock link isn’t valid any more.');
      return;
    }
    const a = st();
    if (!backend()) return;
    // A purchase that hasn't shown up yet: just back from Stripe (?paid=1), or
    // still pending from an earlier visit. The server checks with Stripe
    // directly, so this resolves even if Stripe's webhook was lost.
    if (!a.unlimited && a.session && C.PAYMENTS && (paid || a.pending)) {
      if (paid) { a.pending = Date.now(); save(); K.fx.toast('Payment received. Unlocking…'); }
      const tries = paid ? 12 : 1;
      for (let i = 0; i < tries; i++) {
        try {
          const me = await api('/api/me', { headers: { authorization: `Bearer ${a.session}` } });
          if (me.unlimited) {
            grant('stripe', { session: a.session, pending: null, email: me.email || a.email || null, paidAt: me.paidAt || null });
            K.ui.welcome('paid');
            K.ui.refreshAccess();
            afterSignIn();
            return;
          }
        } catch (e) { /* not yet, or offline */ }
        if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500));
      }
      if (paid) K.fx.toast('Still confirming with Stripe. It will unlock on its own; no need to pay again.');
      return;
    }
    if (!a.unlimited) return;
    if (Date.now() - a.checkedAt < RECHECK_MS) return;
    try {
      if (a.via === 'code') {
        const res = await api(unlockUrl(a.code));
        if (!res.valid) { revoke(); K.fx.toast('Your unlock code has ended. The daily flight is still free.'); K.ui.refreshAccess(); }
        else { a.checkedAt = Date.now(); save(); }
      } else if (a.via === 'stripe' && a.session && a.session !== 'dev') {
        // A paid device only ever loses access to a confirmed refund. Anything
        // else (an outage, a server bug, a lost record) keeps the player flying.
        const me = await api('/api/me', { headers: { authorization: `Bearer ${a.session}` } });
        if (!me.unlimited && me.refunded === true) { revoke(); K.ui.refreshAccess(); }
        else { a.checkedAt = Date.now(); save(); }
      }
    } catch (e) { /* offline or server trouble: keep what we have */ }
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
      google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', width: 280 });
    });
  }

  /** After sign-in: restore an earlier purchase, or (buying) open Stripe Checkout.
      Restore never opens a payment page; it answers 'none' if nothing is found. */
  async function buyWith(idToken, restore) {
    const res = await api('/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, returnTo: location.origin, restore: Boolean(restore), device: K.storage.data.device || undefined }),
    });
    if (res.session) Object.assign(st(), { session: res.session, email: res.email || st().email || null });
    if (res.unlimited) { grant('stripe', { session: res.session, pending: null }); afterSignIn(); return 'restored'; }
    // Signed in either way: back this device's progress up before leaving for Stripe.
    await Promise.race([afterSignIn(), new Promise((r) => setTimeout(r, 3000))]);
    save();
    if (restore || !res.url) return 'none';
    location.href = res.url;                      // Stripe Checkout; returns to /?paid=1
    return 'redirect';
  }

  /** Signed in: merge this device's progress with the cloud copy, then redraw
      the home screen if anything came down (never mid-flight). */
  function afterSignIn() {
    if (!K.sync) return Promise.resolve(false);
    return K.sync.now().then((changed) => {
      if (changed && K.ui.current === 'home' && !K.storage.data.live) K.game.boot({ mode: K.game.mode === 'unlimited' ? 'unlimited' : 'daily' });
      return changed;
    });
  }

  /** Sign out on this device: forget the session (progress and any unlock stay). */
  function signOut() {
    Object.assign(st(), { session: null, email: null });
    if (st().via === 'stripe') st().checkedAt = Date.now();
    save();
  }

  /** Dev only: pretend a purchase went through. */
  function simulatePurchase() { grant('stripe', { session: 'dev' }); }

  /** Tell the server a paid player started an Unlimited/archive flight (for the refund rule). */
  function notePlay(kind) {
    const a = st();
    if (!backend() || a.via !== 'stripe' || !a.session || a.session === 'dev') return;
    fetch(`${C.API_BASE}/api/play`, { method: 'POST', headers: { authorization: `Bearer ${a.session}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind }), keepalive: true }).catch(() => {});
  }

  return { unlimited, canArchive, canKeepFlying, freeRunLeft, redeem, get lastRefusal() { return lastRefusal; }, refresh, googleButton, buyWith, simulatePurchase, notePlay, backend, revoke, afterSignIn, signOut };
})();
