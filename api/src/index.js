/* ==========================================================================
   KÁRMÁN · api/src/index.js  (Cloudflare Worker)
   Serves the static game from ./web and two small JSON routes for the
   "higher than 72% of pilots" comparison:

     POST /api/result      { n, device, pts, legs, chips }   → 204
     GET  /api/stats/:n    → { n, players, step, buckets: [[from, count]…], legs: [pct×7] }
     POST /api/report      { qid, n, device }                → 204   "report this answer"
     GET  /api/unlock/:code                                  → { valid }   unlock links
     POST /api/checkout    { idToken, returnTo }             → { url, session } or { unlimited, session }
     POST /api/stripe      (Stripe webhook)                  → 200   marks the purchase
     GET  /api/save        Authorization: Bearer <session>   → { data, ver }   cloud copy of progress
     PUT  /api/save        { data, base }                    → { ver } or 409 + current copy
     GET  /api/me          Authorization: Bearer <session>   → { unlimited, refunded } (asks Stripe if our record says unpaid)
     POST /api/play        Authorization: Bearer <session>   → 204   for the refund rule
     POST /api/hit         { device, src }                   → 204   first open of the day (dashboard)
     POST /api/admin/login { idToken }                       → { token }   owner only (karman.day/dev)
     GET  /api/admin/stats Authorization: Bearer <token>     → everything the dashboard shows

   Secrets (wrangler secret put …): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
   SESSION_SECRET. Plain vars (wrangler.jsonc): GOOGLE_CLIENT_ID, PRICE_CENTS.

   Scores are computed in the browser and never depend on these numbers;
   this only tells people how they did compared with everyone else.
   Validation keeps junk out of the stats: impossible scores, malformed
   patterns, future flights and duplicate submissions are rejected.
   ========================================================================== */

import { SCHEMA } from './schema.js';

const LAUNCH_UTC = Date.UTC(2026, 9, 7);   // keep in sync with web/js/config.js LAUNCH
const LEGS = 7;                            // keep in sync with web/js/config.js LEGS
const MAX_PTS = LEGS * 100;                // five Pinpoints = the Kármán line
const STEP = 25;
const RUN_BASE = 1000000;                 // Unlimited Run k is stored as flight RUN_BASE + k                           // histogram bucket width in points

/** Today's flight: flights change at midnight Eastern (America/New_York). */
function latestFlight(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(now)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day) - LAUNCH_UTC) / 864e5) + 1;
}

const json = (data, init = {}) => new Response(JSON.stringify(data), {
  ...init,
  headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
});

async function postResult(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  const { device, pts, legs, chips, run } = body || {};
  const isRun = Number.isInteger(run) && run >= 1 && run <= 99999;   // a numbered Unlimited run
  const n = isRun ? RUN_BASE + run : body && body.n;
  const ok = (isRun || (Number.isInteger(n) && n >= 1 && n <= latestFlight()))
    && typeof device === 'string' && /^[\w-]{8,64}$/.test(device)
    && Number.isInteger(pts) && pts >= 0 && pts <= MAX_PTS
    && typeof legs === 'string' && legs.length === LEGS && /^[01]+$/.test(legs)
    && typeof chips === 'string' && chips.length === LEGS && /^[0-4]+$/.test(chips);
  if (!ok) return json({ error: 'invalid result' }, { status: 422 });

  // INSERT OR IGNORE: a second submission from the same device is dropped.
  await env.DB.prepare('INSERT OR IGNORE INTO results (n, device, pts, legs, chips) VALUES (?, ?, ?, ?, ?)')
    .bind(n, device, pts, legs, chips).run();
  return new Response(null, { status: 204 });
}

async function getStats(num, env, ctx, request, isRun = false) {
  if (!Number.isInteger(num) || num < 1 || (isRun ? num > 99999 : num > latestFlight())) return json({ error: 'no such flight' }, { status: 404 });
  const n = isRun ? RUN_BASE + num : num;

  // Cache each flight's stats at the edge for 60 s, so a viral day costs one query a minute.
  const cache = caches.default;
  const key = new Request(new URL(`/api/stats/${isRun ? 'r' : ''}${num}`, request.url).toString());
  // ?fresh=1 right after your own submit: skip the cached copy so you see yourself.
  const hit = new URL(request.url).searchParams.has('fresh') ? null : await cache.match(key);
  if (hit) return hit;

  // Only count rows recorded from the day before this flight's date onward, so
  // test plays from before a launch-date change never leak into real stats.
  const since = isRun ? '1970-01-01 00:00:00' : new Date(LAUNCH_UTC + (n - 2) * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const [hist, legRow] = await Promise.all([
    env.DB.prepare(`SELECT (pts / ${STEP}) * ${STEP} AS bucket, COUNT(*) AS c FROM results WHERE n = ? AND created >= ? GROUP BY bucket ORDER BY bucket`)
      .bind(n, since).all(),
    env.DB.prepare(`SELECT COUNT(*) AS players,
        SUM(substr(legs,1,1) = '1') AS l1, SUM(substr(legs,2,1) = '1') AS l2, SUM(substr(legs,3,1) = '1') AS l3,
        SUM(substr(legs,4,1) = '1') AS l4, SUM(substr(legs,5,1) = '1') AS l5, SUM(substr(legs,6,1) = '1') AS l6,
        SUM(substr(legs,7,1) = '1') AS l7
      FROM results WHERE n = ? AND created >= ?`).bind(n, since).first(),
  ]);
  const players = legRow ? legRow.players : 0;
  const pct = (x) => (players ? Math.round((x / players) * 100) : 0);
  const body = {
    n: num, run: isRun || undefined, players, step: STEP,
    buckets: (hist.results || []).map((r) => [r.bucket, r.c]),
    legs: players ? [legRow.l1, legRow.l2, legRow.l3, legRow.l4, legRow.l5, legRow.l6, legRow.l7].slice(0, LEGS).map(pct) : [],
  };
  const res = json(body, { headers: { 'cache-control': 'public, max-age=60' } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ------------------------------------------------------------ reports */
async function postReport(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  const ok = b && typeof b.qid === 'string' && /^[\w-]{2,40}$/.test(b.qid) && typeof b.device === 'string' && /^[\w-]{8,64}$/.test(b.device);
  if (!ok) return json({ error: 'invalid' }, { status: 422 });
  await env.DB.prepare('INSERT OR IGNORE INTO reports (qid, device, n) VALUES (?, ?, ?)').bind(b.qid, b.device, Number(b.n) || 0).run();
  return new Response(null, { status: 204 });
}

/* ------------------------------------------------------------ unlock links
   A code is valid while its row says active = 1. Revoke = set active = 0. */
async function getUnlock(code, env) {
  const row = await env.DB.prepare('SELECT active FROM unlock_codes WHERE code = ?').bind(code.toUpperCase()).first();
  return json({ valid: Boolean(row && row.active) }, { headers: { 'cache-control': 'no-store' } });
}

/* ------------------------------------------------------------ sessions
   After Google sign-in we hand the browser a small signed token: "sub.sig".
   It proves which Google account this is without storing passwords. */
const enc = new TextEncoder();
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function makeSession(env, sub) { return `${sub}.${await hmac(env.SESSION_SECRET, sub)}`; }
async function readSession(request, env) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  const [sub, sig] = tok.split('.');
  if (!sub || !sig || sig !== await hmac(env.SESSION_SECRET, sub)) return null;
  return sub;
}

/** Verify a Google ID token with Google's tokeninfo endpoint (simple and reliable). */
async function verifyGoogle(idToken, env) {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!r.ok) return null;
  const t = await r.json();
  if (t.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) return null;
  return { sub: t.sub, email: t.email, verified: t.email_verified === true || t.email_verified === 'true' };
}

/* ------------------------------------------------------------ purchase
   Integrity rule: once someone has paid, they have Unlimited, whatever
   happens to the webhook. Three independent paths mark an account paid:
     1. the Stripe webhook (normally within a second or two),
     2. confirmPaid(): asks Stripe directly about this account's checkout
        sessions whenever our own record says "not paid" (/api/me, checkout,
        restore), so a lost or late webhook heals itself,
     3. the browser keeps asking after the player returns from Stripe.
   Only a confirmed refund ever takes access away. */
const stripeGet = async (env, path) => {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`stripe ${r.status}`);
  return r.json();
};
const markPaid = (env, sub, sessionId) => env.DB.batch([
  env.DB.prepare("UPDATE users SET unlimited = 1, paid_at = COALESCE(paid_at, datetime('now')), stripe_session = ? WHERE sub = ?").bind(sessionId, sub),
  env.DB.prepare('DELETE FROM refunds WHERE sub = ?').bind(sub),
]);

/** { unlimited, refunded } for an account. Throws if Stripe can't be reached
    (callers answer 503, and the browser keeps what it has). */
async function confirmPaid(env, sub) {
  const u = await env.DB.prepare('SELECT unlimited FROM users WHERE sub = ?').bind(sub).first();
  if (u && u.unlimited) return { unlimited: true, refunded: false };
  const rows = (await env.DB.prepare('SELECT id FROM checkouts WHERE sub = ? ORDER BY created DESC LIMIT 5').bind(sub).all()).results || [];
  let refunded = Boolean(await env.DB.prepare('SELECT 1 AS x FROM refunds WHERE sub = ?').bind(sub).first());
  for (const { id } of rows) {
    const cs = await stripeGet(env, `checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge`);
    if (cs.payment_status !== 'paid') continue;
    const ch = cs.payment_intent && cs.payment_intent.latest_charge;
    if (ch && ch.refunded) { refunded = true; continue; }
    await markPaid(env, sub, cs.id);
    return { unlimited: true, refunded: false };
  }
  return { unlimited: false, refunded };
}

async function postCheckout(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  const who = b && b.idToken ? await verifyGoogle(b.idToken, env) : null;
  if (!who) return json({ error: 'sign-in failed' }, { status: 401 });
  await env.DB.prepare('INSERT INTO users (sub, email) VALUES (?, ?) ON CONFLICT(sub) DO UPDATE SET email = excluded.email').bind(who.sub, who.email || '').run();
  const session = await makeSession(env, who.sub);
  // Already paid (even if the webhook never arrived)? Restore, never charge twice.
  let state;
  try { state = await confirmPaid(env, who.sub); } catch { return json({ error: 'stripe unavailable' }, { status: 503 }); }
  if (state.unlimited) return json({ unlimited: true, session, email: who.email || null });
  if (b.restore) return json({ unlimited: false, session, email: who.email || null });          // "Restore purchase" never opens a payment

  const origin = /^https:\/\/([\w-]+\.)*karman\.day$/.test(b.returnTo || '') ? b.returnTo : 'https://karman.day';
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(env.PRICE_CENTS || 599),
    'line_items[0][price_data][product_data][name]': 'KÁRMÁN Unlimited',
    'line_items[0][quantity]': '1',
    client_reference_id: who.sub,
    success_url: `${origin}/?paid=1`,
    cancel_url: `${origin}/`,
  });
  if (who.email) form.set('customer_email', who.email);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const cs = await r.json();
  if (!r.ok) return json({ error: 'checkout failed' }, { status: 502 });
  await env.DB.prepare('INSERT OR IGNORE INTO checkouts (id, sub) VALUES (?, ?)').bind(cs.id, who.sub).run();
  return json({ url: cs.url, session, email: who.email || null });
}

/** Stripe calls this when a payment succeeds (or is refunded). Signature first. */
async function postStripe(request, env) {
  const body = await request.text();
  const header = request.headers.get('stripe-signature') || '';
  let t = '';
  const sigs = [];
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') sigs.push(v);    // several v1s while a secret is being rolled
  }
  const expected = t ? await hmac(env.STRIPE_WEBHOOK_SECRET, `${t}.${body}`) : '';
  if (!t || !sigs.includes(expected) || Math.abs(Date.now() / 1000 - Number(t)) > 600) return new Response('bad signature', { status: 400 });
  const evt = JSON.parse(body);
  const o = evt.data && evt.data.object;
  const paidEvent = evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded';
  if (paidEvent && o.payment_status === 'paid' && o.client_reference_id) {
    await env.DB.prepare('INSERT OR IGNORE INTO checkouts (id, sub) VALUES (?, ?)').bind(o.id, o.client_reference_id).run();
    await env.DB.prepare('INSERT INTO users (sub) VALUES (?) ON CONFLICT(sub) DO NOTHING').bind(o.client_reference_id).run();
    await markPaid(env, o.client_reference_id, o.id);
  }
  if (evt.type === 'charge.refunded' && o.refunded) {
    // A full refund (issued from the Stripe dashboard) removes access again.
    const s = await stripeGet(env, `checkout/sessions?payment_intent=${encodeURIComponent(o.payment_intent)}`);
    const sub = s.data && s.data[0] && s.data[0].client_reference_id;
    if (sub) await env.DB.batch([
      env.DB.prepare('UPDATE users SET unlimited = 0 WHERE sub = ?').bind(sub),
      env.DB.prepare('INSERT OR REPLACE INTO refunds (sub) VALUES (?)').bind(sub),
    ]);
  }
  return new Response('ok');
}

async function getMe(request, env) {
  const sub = await readSession(request, env);
  if (!sub) return json({ error: 'signed out' }, { status: 401 });
  let state;
  try { state = await confirmPaid(env, sub); } catch { return json({ error: 'stripe unavailable' }, { status: 503 }); }
  const u = await env.DB.prepare('SELECT email, paid_at FROM users WHERE sub = ?').bind(sub).first();
  return json({ ...state, email: u ? u.email : null, paidAt: u ? u.paid_at : null }, { headers: { 'cache-control': 'no-store' } });
}

/* ------------------------------------------------------------ cloud save
   One row per Google account. GET returns { data, ver } (data null if none).
   PUT { data, base } stores only if base matches the current ver, else 409
   with the current copy so the browser can merge it in and try again. */
const SAVE_MAX = 400_000;
async function getSave(request, env) {
  const sub = await readSession(request, env);
  if (!sub) return json({ error: 'signed out' }, { status: 401 });
  const row = await env.DB.prepare('SELECT data, ver FROM saves WHERE sub = ?').bind(sub).first();
  return json({ data: row ? JSON.parse(row.data) : null, ver: row ? row.ver : 0 }, { headers: { 'cache-control': 'no-store' } });
}
async function putSave(request, env) {
  const sub = await readSession(request, env);
  if (!sub) return json({ error: 'signed out' }, { status: 401 });
  const text = await request.text();
  if (text.length > SAVE_MAX) return json({ error: 'too large' }, { status: 413 });
  let b;
  try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  if (!b || typeof b.data !== 'object' || b.data === null || !Number.isInteger(b.base)) return json({ error: 'bad save' }, { status: 400 });
  const data = JSON.stringify(b.data);
  const r = b.base === 0
    ? await env.DB.prepare("INSERT INTO saves (sub, data, ver) VALUES (?, ?, 1) ON CONFLICT(sub) DO NOTHING").bind(sub, data).run()
    : await env.DB.prepare("UPDATE saves SET data = ?, ver = ver + 1, updated = datetime('now') WHERE sub = ? AND ver = ?").bind(data, sub, b.base).run();
  const changes = r && r.meta ? r.meta.changes : r && r.changes;
  if (!changes) {
    const row = await env.DB.prepare('SELECT data, ver FROM saves WHERE sub = ?').bind(sub).first();
    return json({ data: row ? JSON.parse(row.data) : null, ver: row ? row.ver : 0 }, { status: 409 });
  }
  return json({ ver: b.base + 1 });
}

/* ------------------------------------------------------------ health
   GET /api/health: is payment set up right? Yes/no answers only (never a key).
   A POST with no parameters is refused as "missing param" (400) when the key
   may create Checkout sessions, and as a permission error (401/403) when not,
   so nothing is created. Cached for a minute so it can't hammer Stripe. */
async function getHealth(env, ctx) {
  const cacheKey = new Request('https://karman.day/api/health');
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const k = env.STRIPE_SECRET_KEY || '';
  const call = async (path, method = 'GET') => {
    try {
      const r = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { authorization: `Bearer ${k}` } });
      return r.status;
    } catch { return 0; }
  };
  const [csWrite, csRead, piRead, chRead] = k ? await Promise.all([
    call('checkout/sessions', 'POST'), call('checkout/sessions?limit=1'), call('payment_intents?limit=1'), call('charges?limit=1'),
  ]) : [0, 0, 0, 0];
  const body = {
    stripe_key: k ? { mode: /_live_/.test(k) ? 'live' : /_test_/.test(k) ? 'test' : 'unknown', type: k.startsWith('rk_') ? 'restricted' : k.startsWith('sk_') ? 'secret' : 'unknown' } : 'missing',
    can_create_checkout: csWrite === 400 || csWrite === 200,
    can_read_checkout: csRead === 200,
    can_read_payment_intents: piRead === 200,
    can_read_charges: chRead === 200,
    webhook_secret: env.STRIPE_WEBHOOK_SECRET ? (env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_') ? 'set' : 'set (unexpected format)') : 'missing',
    session_secret: env.SESSION_SECRET ? (env.SESSION_SECRET.length >= 20 ? 'set' : 'too short') : 'missing',
    google_client_id: env.GOOGLE_CLIENT_ID ? 'set' : 'missing',
    raw: { csWrite, csRead, piRead, chRead },
  };
  body.ok = Boolean(k && body.can_create_checkout && body.can_read_checkout && body.can_read_payment_intents && body.can_read_charges && env.STRIPE_WEBHOOK_SECRET && env.SESSION_SECRET && env.GOOGLE_CLIENT_ID);
  const res = json(body, { headers: { 'cache-control': 'public, max-age=60' } });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

/** GET /api/reports: the most-reported questions (ids and counts only), for
    the weekly restock to re-check. No devices or anything personal. */
async function getReports(env) {
  const r = await env.DB.prepare("SELECT qid, COUNT(*) AS reports FROM reports WHERE created > datetime('now', '-60 days') GROUP BY qid HAVING reports >= 2 ORDER BY reports DESC LIMIT 30").all();
  return json({ questions: r.results || [] }, { headers: { 'cache-control': 'public, max-age=300' } });
}

/* ------------------------------------------------------------ visits
   POST /api/hit { device, src }: the first open of the day per device.
   The country comes from Cloudflare; phone or not from the user agent. */
async function postHit(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  if (!b || typeof b.device !== 'string' || !/^[\w-]{8,64}$/.test(b.device)) return json({ error: 'invalid' }, { status: 422 });
  const raw = String(b.src || 'direct').toLowerCase().replace(/^www\./, '').slice(0, 40);
  const src = /^[\w.-]{1,40}$/.test(raw) ? raw : 'other';
  const country = request.cf && typeof request.cf.country === 'string' ? request.cf.country.slice(0, 2) : null;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(request.headers.get('user-agent') || '') ? 1 : 0;
  await env.DB.prepare('INSERT OR IGNORE INTO visits (day, device, src, country, mobile) VALUES (?, ?, ?, ?, ?)')
    .bind(latestFlight(), b.device, src, country, mobile).run();
  return new Response(null, { status: 204 });
}

/* ------------------------------------------------------------ owner dashboard
   karman.day/dev signs in with Google; only the owner's account gets a token.
   The owner is matched by the SHA-256 of their email, so the address itself
   isn't written in this (public) repo. ADMIN_SHA256 in the dashboard vars
   overrides it (comma-separated for more than one person). */
const OWNER_SHA256 = '9cfa24bece8be678de7ae30766619cedef1c6c2bf0dfedd8f0a5237c03bcb0c7';
const ADMIN_DAYS = 30;
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function postAdminLogin(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  const who = b && b.idToken ? await verifyGoogle(b.idToken, env) : null;
  if (!who || !who.email) return json({ error: 'sign-in failed' }, { status: 401 });
  const allowed = String(env.ADMIN_SHA256 || OWNER_SHA256).split(',').map((x) => x.trim());
  if (!who.verified || !allowed.includes(await sha256(who.email.trim().toLowerCase()))) return json({ error: 'not the owner' }, { status: 403 });
  const exp = Date.now() + ADMIN_DAYS * 864e5;
  return json({ token: `${exp}.${await hmac(env.SESSION_SECRET, `admin:${exp}`)}`, email: who.email });
}
async function isAdmin(request, env) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  const [exp, sig] = tok.split('.');
  return Boolean(env.SESSION_SECRET && exp && sig && Number(exp) > Date.now() && sig === await hmac(env.SESSION_SECRET, `admin:${exp}`));
}

/** GET /api/admin/stats?me=<device>: everything on the dashboard in one go.
    `me` leaves the owner's own browser out of every count. */
async function getAdmin(request, env, ctx) {
  if (!await isAdmin(request, env)) return json({ error: 'signed out' }, { status: 401 });
  const meRaw = new URL(request.url).searchParams.get('me') || '';
  const me = /^[\w-]{8,64}$/.test(meRaw) ? meRaw : '';
  const T = latestFlight();
  const d0 = Math.max(1, T - 29);
  const all = async (sql, ...args) => ((await env.DB.prepare(sql).bind(...args).all()).results || []);
  const one = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).first()) || {};
  const firsts = `SELECT device, MIN(n) AS first FROM results WHERE n < ${RUN_BASE} AND device != ? GROUP BY device`;
  const vfirsts = 'SELECT device, MIN(day) AS first FROM visits WHERE device != ? GROUP BY device';

  const [daily, newByDay, totals, loyalty, cohorts, recent, visitsByDay, newVisitsByDay, sources, countries, devices, unlimited,
    money, paidList, recentBuyers, saves, plays, reports] = await Promise.all([
    all(`SELECT n, COUNT(*) AS players, ROUND(AVG(pts), 1) AS avg, MAX(pts) AS best FROM results WHERE n BETWEEN ? AND ? AND device != ? GROUP BY n`, d0, T, me),
    all(`SELECT first AS n, COUNT(*) AS c FROM (${firsts}) GROUP BY first`, me),
    one(`SELECT COUNT(DISTINCT device) AS pilots, COUNT(*) AS flights FROM results WHERE n < ${RUN_BASE} AND device != ?`, me),
    all(`SELECT days, COUNT(*) AS c FROM (SELECT device, COUNT(*) AS days FROM results WHERE n < ${RUN_BASE} AND device != ? GROUP BY device) GROUP BY days ORDER BY days`, me),
    all(`SELECT f.first AS n, COUNT(*) AS size,
        SUM(EXISTS (SELECT 1 FROM results r WHERE r.device = f.device AND r.n = f.first + 1)) AS next,
        SUM(EXISTS (SELECT 1 FROM results r WHERE r.device = f.device AND r.n BETWEEN f.first + 1 AND f.first + 7)) AS week
      FROM (${firsts}) f WHERE f.first >= ? GROUP BY f.first ORDER BY f.first DESC`, me, d0),
    all(`SELECT n, pts, legs, chips, created FROM results WHERE n BETWEEN ? AND ? AND device != ?`, Math.max(1, T - 6), T, me),
    all('SELECT day AS n, COUNT(*) AS c FROM visits WHERE day BETWEEN ? AND ? AND device != ? GROUP BY day', d0, T, me),
    all(`SELECT first AS n, COUNT(*) AS c FROM (${vfirsts}) GROUP BY first`, me),
    all(`SELECT v.src, COUNT(*) AS visits, SUM(EXISTS (SELECT 1 FROM results r WHERE r.device = v.device AND r.n = v.day)) AS finished
      FROM visits v WHERE v.day > ? AND v.device != ? GROUP BY v.src ORDER BY visits DESC LIMIT 15`, T - 7, me),
    all('SELECT COALESCE(country, \'??\') AS country, COUNT(*) AS c FROM visits WHERE day > ? AND device != ? GROUP BY country ORDER BY c DESC LIMIT 12', T - 7, me),
    all('SELECT mobile, COUNT(*) AS c FROM visits WHERE day > ? AND device != ? GROUP BY mobile', T - 7, me),
    one(`SELECT COUNT(*) AS runs, COUNT(DISTINCT device) AS pilots, SUM(created >= datetime('now', '-1 day')) AS day, SUM(created >= datetime('now', '-7 days')) AS week FROM results WHERE n >= ${RUN_BASE} AND device != ?`, me),
    one('SELECT (SELECT COUNT(*) FROM users) AS accounts, (SELECT COUNT(*) FROM users WHERE unlimited = 1) AS paid, (SELECT COUNT(*) FROM refunds) AS refunds, (SELECT COUNT(DISTINCT sub) FROM checkouts) AS checkouts'),
    all('SELECT paid_at FROM users WHERE unlimited = 1 AND paid_at IS NOT NULL ORDER BY paid_at DESC LIMIT 2000'),
    all('SELECT email, paid_at FROM users WHERE unlimited = 1 ORDER BY paid_at DESC LIMIT 8'),
    one('SELECT COUNT(*) AS c FROM saves'),
    one("SELECT COUNT(*) AS c FROM plays WHERE at >= datetime('now', '-7 days')"),
    all('SELECT qid, COUNT(*) AS c, MAX(created) AS last FROM reports GROUP BY qid ORDER BY c DESC, last DESC LIMIT 12'),
  ]);
  let health = null;
  try { health = await (await getHealth(env, ctx)).json(); } catch { /* shown as unknown */ }
  const today = await one('SELECT COUNT(*) AS visits, SUM(EXISTS (SELECT 1 FROM results r WHERE r.device = v.device AND r.n = v.day)) AS finished FROM visits v WHERE v.day = ? AND v.device != ?', T, me);
  return json({
    T, d0, launch: LAUNCH_UTC, priceCents: Number(env.PRICE_CENTS || 599), maxPts: MAX_PTS, now: new Date().toISOString(),
    daily, newByDay, totals, loyalty, cohorts, recent, visitsByDay, newVisitsByDay, today,
    sources, countries, devices, unlimited, money, paidList: paidList.map((r) => r.paid_at), recentBuyers,
    saves: saves.c || 0, plays7: plays.c || 0, reports, health,
  }, { headers: { 'cache-control': 'no-store' } });
}

/** Paid player started an Unlimited/archive flight: logged so refunds follow the rule. */
async function postPlay(request, env) {
  const sub = await readSession(request, env);
  if (!sub) return new Response(null, { status: 401 });
  await env.DB.prepare('INSERT INTO plays (sub) VALUES (?)').bind(sub).run();
  return new Response(null, { status: 204 });
}

/* Create any missing tables on the first API call after a cold start.
   Every statement is CREATE ... IF NOT EXISTS, so this never touches data. */
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    const statements = SCHEMA.replace(/--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
    schemaReady = env.DB.batch(statements.map((x) => env.DB.prepare(x))).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) await ensureSchema(env);
    if (url.pathname === '/api/result' && request.method === 'POST') return postResult(request, env);
    const m = url.pathname.match(/^\/api\/stats\/(r?)(\d+)$/);
    if (m && request.method === 'GET') return getStats(Number(m[2]), env, ctx, request, m[1] === 'r');
    if (url.pathname === '/api/report' && request.method === 'POST') return postReport(request, env);
    const u = url.pathname.match(/^\/api\/unlock\/([\w-]{3,40})$/);
    if (u && request.method === 'GET') return getUnlock(u[1], env);
    if (url.pathname === '/api/checkout' && request.method === 'POST') return postCheckout(request, env);
    if (url.pathname === '/api/health' && request.method === 'GET') return getHealth(env, ctx);
    if (url.pathname === '/api/reports' && request.method === 'GET') return getReports(env);
    if (url.pathname === '/api/save' && request.method === 'GET') return getSave(request, env);
    if (url.pathname === '/api/save' && request.method === 'PUT') return putSave(request, env);
    if (url.pathname === '/api/stripe' && request.method === 'POST') return postStripe(request, env);
    if (url.pathname === '/api/me' && request.method === 'GET') return getMe(request, env);
    if (url.pathname === '/api/play' && request.method === 'POST') return postPlay(request, env);
    if (url.pathname === '/api/hit' && request.method === 'POST') return postHit(request, env);
    if (url.pathname === '/api/admin/login' && request.method === 'POST') return postAdminLogin(request, env);
    if (url.pathname === '/api/admin/stats' && request.method === 'GET') return getAdmin(request, env, ctx);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, { status: 404 });
    return env.ASSETS.fetch(request);    // everything else: the game itself
  },
};
