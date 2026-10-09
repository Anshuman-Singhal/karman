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
     GET  /api/me          Authorization: Bearer <session>   → { unlimited, email }
     POST /api/play        Authorization: Bearer <session>   → 204   for the refund rule

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
  return { sub: t.sub, email: t.email };
}

/* ------------------------------------------------------------ purchase */
async function postCheckout(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  const who = b && b.idToken ? await verifyGoogle(b.idToken, env) : null;
  if (!who) return json({ error: 'sign-in failed' }, { status: 401 });
  await env.DB.prepare('INSERT INTO users (sub, email) VALUES (?, ?) ON CONFLICT(sub) DO UPDATE SET email = excluded.email').bind(who.sub, who.email || '').run();
  const session = await makeSession(env, who.sub);
  const user = await env.DB.prepare('SELECT unlimited FROM users WHERE sub = ?').bind(who.sub).first();
  if (user && user.unlimited) return json({ unlimited: true, session });   // restore

  const origin = /^https:\/\/([\w-]+\.)*karman\.day$/.test(b.returnTo || '') ? b.returnTo : 'https://karman.day';
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(env.PRICE_CENTS || 599),
    'line_items[0][price_data][product_data][name]': 'KÁRMÁN Unlimited',
    'line_items[0][quantity]': '1',
    client_reference_id: who.sub,
    customer_email: who.email || '',
    success_url: `${origin}/?paid=1`,
    cancel_url: `${origin}/`,
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const cs = await r.json();
  if (!r.ok) return json({ error: 'checkout failed' }, { status: 502 });
  return json({ url: cs.url, session });
}

/** Stripe calls this when a payment succeeds. We verify the signature, then mark the account. */
async function postStripe(request, env) {
  const body = await request.text();
  const header = request.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const expected = await hmac(env.STRIPE_WEBHOOK_SECRET, `${parts.t}.${body}`);
  if (!parts.t || parts.v1 !== expected || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return new Response('bad signature', { status: 400 });
  const evt = JSON.parse(body);
  if (evt.type === 'checkout.session.completed' && evt.data.object.payment_status === 'paid') {
    const o = evt.data.object;
    await env.DB.prepare("UPDATE users SET unlimited = 1, paid_at = datetime('now'), stripe_session = ? WHERE sub = ?").bind(o.id, o.client_reference_id).run();
  }
  if (evt.type === 'charge.refunded') {
    // A refund (issued from the Stripe dashboard) removes access again.
    const pi = evt.data.object.payment_intent;
    const s = await fetch(`https://api.stripe.com/v1/checkout/sessions?payment_intent=${pi}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }).then((r) => r.json());
    const sub = s.data && s.data[0] && s.data[0].client_reference_id;
    if (sub) await env.DB.prepare('UPDATE users SET unlimited = 0 WHERE sub = ?').bind(sub).run();
  }
  return new Response('ok');
}

async function getMe(request, env) {
  const sub = await readSession(request, env);
  if (!sub) return json({ error: 'signed out' }, { status: 401 });
  const u = await env.DB.prepare('SELECT unlimited, email FROM users WHERE sub = ?').bind(sub).first();
  return json({ unlimited: Boolean(u && u.unlimited), email: u ? u.email : null }, { headers: { 'cache-control': 'no-store' } });
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
    if (url.pathname === '/api/stripe' && request.method === 'POST') return postStripe(request, env);
    if (url.pathname === '/api/me' && request.method === 'GET') return getMe(request, env);
    if (url.pathname === '/api/play' && request.method === 'POST') return postPlay(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, { status: 404 });
    return env.ASSETS.fetch(request);    // everything else: the game itself
  },
};
