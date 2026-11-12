/* ==========================================================================
   KÁRMÁN · api/src/index.js  (Cloudflare Worker)
   Serves the static game from ./web and two small JSON routes for the
   "higher than 72% of pilots" comparison:

     POST /api/result      { n, device, pts, legs, chips }   → 204
     GET  /api/stats/:n    → { n, players, step, buckets: [[from, count]…], legs: [pct×7] }
     POST /api/report      { qid, n, device }                → 204   "report this answer"
     GET  /api/unlock/:code?device=<id>                      → { valid, reason? }   unlock links (PASS-… = one device)
     POST /api/checkout    { idToken, returnTo }             → { url, session } or { unlimited, session }
     POST /api/stripe      (Stripe webhook)                  → 200   marks the purchase
     GET  /api/save        Authorization: Bearer <session>   → { data, ver }   cloud copy of progress
     PUT  /api/save        { data, base }                    → { ver } or 409 + current copy
     GET  /api/me          Authorization: Bearer <session>   → { unlimited, refunded } (asks Stripe if our record says unpaid)
     POST /api/play        Authorization: Bearer <session>   → 204   for the refund rule
     POST /api/hit         { device, src }                   → 204   first open of the day (dashboard)
     POST /api/event       { device, kind }                  → 204   anonymous product event, once per device per kind per day
     POST /api/admin/login { idToken }                       → { token }   owner only (karman.day/dev)
     GET  /api/admin/stats Authorization: Bearer <token>     → everything the dashboard shows (v2, api/src/dash.js)
     GET  /api/admin/ignore?device=<id>                      → { ignored, devices, subs }   "this browser is mine"
     POST /api/admin/ignore { device }  / DELETE …           → { ok }       leave a device out of every number (or not)
     POST /api/admin/rebuild                                 → { ok }       re-freeze the last 14 days
     GET  /api/admin/passes                                  → { passes }   free Unlimited passes
     POST /api/admin/passes { note }                         → { code }     make one
     POST /api/admin/passes/:code { active }                 → { ok }       revoke / restore
     DELETE /api/admin/passes/:code                          → { ok }       delete for good
     GET  /api/admin/thanks                                  → { on, sent, waiting, late, recent }   buyer thank-you emails
     POST /api/admin/thanks                                  → { sent, failed }        thank earlier buyers now
     POST /api/admin/thanks { test: email }                  → { test }                a test copy, nothing marked

   Secrets (wrangler secret put …): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
   SESSION_SECRET. Plain vars (wrangler.jsonc): GOOGLE_CLIENT_ID, PRICE_CENTS.

   Scores are computed in the browser and never depend on these numbers;
   this only tells people how they did compared with everyone else.
   Validation keeps junk out of the stats: impossible scores, malformed
   patterns, future flights and duplicate submissions are rejected.
   ========================================================================== */

import { SCHEMA } from './schema.js';
import { sendThanks, sendTest } from './thanks.js';
import { buildDashboard, EVENT_KINDS, maskEmail } from './dash.js';

const LAUNCH_UTC = Date.UTC(2026, 9, 7);   // keep in sync with web/js/config.js LAUNCH
const LEGS = 7;                            // keep in sync with web/js/config.js LEGS
const MAX_PTS = LEGS * 100;                // five Pinpoints = the Kármán line
const STEP = 25;
const RUN_BASE = 1000000;                 // Unlimited Run k is stored as flight RUN_BASE + k

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
const DEVICE_RE = /^[\w-]{8,64}$/;
/* Crawlers and link unfurlers that run JS would otherwise mint a "visitor"
   per fetch. Real in-app browsers (Twitter, Instagram…) are not matched. */
const BOT_UA = /(?<!cu)bot[/\-\s;)]|bot$|crawler|spider|slurp|headlesschrome|lighthouse|facebookexternalhit|embedly|whatsapp\/|google-inspectiontool|bingpreview|petalbot/i;
const isBot = (request) => BOT_UA.test(request.headers.get('user-agent') || '');

/* Rate limit for the anonymous write endpoints (hit, event, report), per
   client IP. Uses the Workers rate-limiting binding when one is configured
   (env.LIMITER, see SHIPPING.md), else a small fixed window per isolate.
   Fails open: any error means "allowed", so a real player is never blocked
   by the limiter itself. Over the limit the request is answered 429 and
   nothing is written (the game simply retries another time). */
const buckets = new Map();
async function limited(request, env, scope, per = 30) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return false;
  const key = `${scope}:${ip}`;
  try {
    if (env.LIMITER && typeof env.LIMITER.limit === 'function') return !(await env.LIMITER.limit({ key })).success;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.t >= 60e3) {
      if (buckets.size > 5000) buckets.clear();
      b = { t: now, n: 0 }; buckets.set(key, b);
    }
    b.n += 1;
    return b.n > per;
  } catch (e) { return false; }
}
const tooMany = () => new Response(null, { status: 429 });

/* pilots: one row per device (the dashboard's pre-aggregation). A finished
   daily flight moves first/last/count/streak; written only when the result
   row itself was new, so a resubmission never counts twice. */
const PILOT_RESULT = `INSERT INTO pilots (device, first_seen, first_flight, last_flight, flights, streak) SELECT ?1, ?2, ?2, ?2, 1, 1 WHERE changes() = 1
  ON CONFLICT(device) DO UPDATE SET
    first_seen = MIN(first_seen, excluded.first_seen),
    first_flight = COALESCE(MIN(first_flight, excluded.first_flight), excluded.first_flight),
    streak = CASE WHEN last_flight = excluded.last_flight - 1 THEN streak + 1
                  WHEN last_flight >= excluded.last_flight THEN streak ELSE 1 END,
    last_flight = MAX(COALESCE(last_flight, 0), excluded.last_flight),
    flights = flights + 1`;
const PILOT_HIT = `INSERT INTO pilots (device, first_seen, first_src, country, mobile) SELECT ?1, ?2, ?3, ?4, ?5 WHERE changes() = 1
  ON CONFLICT(device) DO UPDATE SET
    first_src = CASE WHEN first_src IS NULL AND first_seen >= excluded.first_seen THEN excluded.first_src ELSE first_src END,
    country = COALESCE(country, excluded.country), mobile = COALESCE(mobile, excluded.mobile)`;

async function postResult(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  const { device, pts, legs, chips, run } = body || {};
  const isRun = Number.isInteger(run) && run >= 1 && run <= 99999;   // a numbered Unlimited run
  const n = isRun ? RUN_BASE + run : body && body.n;
  // Daily results: today's flight (with ten minutes' grace for a fast clock),
  // yesterday's for someone who started before midnight, and for the first two
  // hours of a day the one before that too. Older flights are archive replays
  // or a dev picker, never stats. The dashboard only freezes a day once it can
  // no longer receive results (see TC in getAdmin).
  const now = Date.now();
  const hi = latestFlight(now + 10 * 60e3), lo = Math.max(1, latestFlight(now - 2 * 36e5) - 1);
  const ok = (isRun || (Number.isInteger(n) && n >= lo && n <= hi))
    && typeof device === 'string' && DEVICE_RE.test(device)
    && Number.isInteger(pts) && pts >= 0 && pts <= MAX_PTS
    && typeof legs === 'string' && legs.length === LEGS && /^[01]+$/.test(legs)
    && typeof chips === 'string' && chips.length === LEGS && /^[0-4]+$/.test(chips);
  if (!ok) return json({ error: 'invalid result' }, { status: 422 });

  // INSERT OR IGNORE: a second submission from the same device is dropped, and
  // the follow-up statements (same batch, same transaction) run only when the
  // row was new, so nothing is ever counted twice.
  const stmts = [env.DB.prepare('INSERT OR IGNORE INTO results (n, device, pts, legs, chips) VALUES (?, ?, ?, ?, ?)').bind(n, device, pts, legs, chips)];
  if (!isRun) stmts.push(env.DB.prepare(PILOT_RESULT).bind(device, n));
  else {
    // Unlimited runs are counted per day as they land (the dashboard never re-reads them),
    // and paid runs mark the device as an Unlimited pilot that day. The owner's devices are left out.
    const day = latestFlight(now);
    stmts.push(
      env.DB.prepare(`INSERT INTO counters (day, kind, n) SELECT ?, ?, 1 WHERE changes() = 1 AND NOT EXISTS (SELECT 1 FROM ignore_devices WHERE device = ?)
        ON CONFLICT(day, kind) DO UPDATE SET n = n + 1`).bind(day, run === 1 ? 'runs_free' : 'runs_paid', device),
    );
    if (run > 1) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO events (day, kind, device) SELECT ?, 'run', ? WHERE changes() = 1").bind(day, device));
  }
  try { await env.DB.batch(stmts); } catch (e) {
    // the result itself matters most: keep it even if the bookkeeping failed
    console.warn('result batch', e && e.message);
    await env.DB.prepare('INSERT OR IGNORE INTO results (n, device, pts, legs, chips) VALUES (?, ?, ?, ?, ?)').bind(n, device, pts, legs, chips).run();
  }
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
  if (await limited(request, env, 'report')) return tooMany();
  await env.DB.prepare('INSERT OR IGNORE INTO reports (qid, device, n) VALUES (?, ?, ?)').bind(b.qid, b.device, Number(b.n) || 0).run();
  return new Response(null, { status: 204 });
}

/* ------------------------------------------------------------ unlock links
   A code is valid while its row says active = 1. Revoke = set active = 0. */
async function getUnlock(code, env, device) {
  const c = code.toUpperCase();
  const H = { headers: { 'cache-control': 'no-store' } };
  const row = await env.DB.prepare('SELECT active FROM unlock_codes WHERE code = ?').bind(c).first();
  if (!row || !row.active) return json({ valid: false }, H);
  // A free pass belongs to the first device that opens it. Older shared codes
  // (PILOT-…) keep working on any number of devices.
  if (c.startsWith('PASS-')) {
    if (!device || !/^[\w-]{8,64}$/.test(device)) return json({ valid: false, reason: 'device' }, H);
    await env.DB.prepare('INSERT OR IGNORE INTO unlock_claims (code, device) VALUES (?, ?)').bind(c, device).run();
    const claim = await env.DB.prepare('SELECT device FROM unlock_claims WHERE code = ?').bind(c).first();
    if (!claim || claim.device !== device) return json({ valid: false, reason: 'claimed' }, H);
  }
  // first / last use, for the owner's pass list
  await env.DB.prepare("INSERT INTO unlock_uses (code) VALUES (?) ON CONFLICT(code) DO UPDATE SET last = datetime('now'), checks = checks + 1").bind(c).run();
  return json({ valid: true }, H);
}

/* Free Unlimited passes, made from karman.day/dev. A pass is an unlock code:
   PASS-XXXX-XXXX (no 0/O/1/I, so it can be read out loud). */
const PASS_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function passCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map((x) => PASS_ABC[x % PASS_ABC.length]).join('');
  return `PASS-${s.slice(0, 4)}-${s.slice(4)}`;
}
async function adminPasses(request, env, code) {
  if (!await isAdmin(request, env)) return json({ error: 'signed out' }, { status: 401 });
  if (request.method === 'GET' && !code) {
    const rows = (await env.DB.prepare(`SELECT c.code, c.note, c.active, c.created, u.first, u.last, u.checks, (k.device IS NOT NULL) AS claimed
      FROM unlock_codes c LEFT JOIN unlock_uses u ON u.code = c.code LEFT JOIN unlock_claims k ON k.code = c.code ORDER BY c.created DESC, c.rowid DESC LIMIT 200`).all()).results || [];
    return json({ passes: rows }, { headers: { 'cache-control': 'no-store' } });
  }
  if (request.method === 'DELETE' && code) {
    const c = code.toUpperCase();
    const r = await env.DB.prepare('DELETE FROM unlock_codes WHERE code = ?').bind(c).run();
    await env.DB.batch([env.DB.prepare('DELETE FROM unlock_uses WHERE code = ?').bind(c), env.DB.prepare('DELETE FROM unlock_claims WHERE code = ?').bind(c)]);
    const changed = r && r.meta ? r.meta.changes : r && r.changes;
    return changed ? json({ ok: true }) : json({ error: 'no such pass' }, { status: 404 });
  }
  if (request.method !== 'POST') return json({ error: 'method' }, { status: 405 });
  let b = {};
  try { b = await request.json(); } catch { /* empty body is fine */ }
  if (code) {
    const c = code.toUpperCase();
    const r = await env.DB.prepare('UPDATE unlock_codes SET active = ? WHERE code = ?').bind(b && b.active ? 1 : 0, c).run();
    const changed = r && r.meta ? r.meta.changes : r && r.changes;
    return changed ? json({ ok: true }) : json({ error: 'no such pass' }, { status: 404 });
  }
  const note = String((b && b.note) || '').trim().slice(0, 80) || null;
  for (let i = 0; i < 5; i++) {
    const c = passCode();
    try {
      await env.DB.prepare('INSERT INTO unlock_codes (code, note) VALUES (?, ?)').bind(c, note).run();
      return json({ code: c, note });
    } catch (e) { /* a clash: try another */ }
  }
  return json({ error: 'try again' }, { status: 500 });
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
/* markPaid also records what Stripe actually charged (amount_total, in
   cents) in payments, once per Checkout session. cs is the session object. */
const sqlTime = (unix) => new Date(unix * 1000).toISOString().slice(0, 19).replace('T', ' ');
const markPaid = (env, sub, cs, at) => env.DB.batch([
  env.DB.prepare("UPDATE users SET unlimited = 1, paid_at = COALESCE(paid_at, datetime('now')), stripe_session = ? WHERE sub = ?").bind(cs.id, sub),
  env.DB.prepare('DELETE FROM refunds WHERE sub = ?').bind(sub),
  env.DB.prepare("INSERT OR IGNORE INTO payments (session, sub, amount, currency, at, est) VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?)")
    .bind(cs.id, sub, Number.isInteger(cs.amount_total) ? cs.amount_total : Number(env.PRICE_CENTS || 599), cs.currency || 'usd', at || null, Number.isInteger(cs.amount_total) ? 0 : 1),
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
    await markPaid(env, sub, cs, cs.created ? sqlTime(cs.created) : null);
    await sendThanks(env, sub, cs.customer_details && cs.customer_details.email);   // the webhook was lost: thank them here instead
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
  // For "conversion by source": copy the buyer's first flight, first source and
  // flights flown so far from pilots. The device id itself is never stored here.
  if (typeof b.device === 'string' && DEVICE_RE.test(b.device)) {
    try {
      await env.DB.prepare('INSERT OR IGNORE INTO checkout_src (id, first_flight, first_seen, src, flights) SELECT ?, first_flight, first_seen, first_src, flights FROM pilots WHERE device = ?')
        .bind(cs.id, b.device).run();
    } catch (e) { /* the checkout matters more than the stat */ }
  }
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
    // Stripe retries webhooks. A retry of a payment that has since been fully
    // refunded must not hand Unlimited back (markPaid clears the refund mark).
    const prior = await env.DB.prepare('SELECT amount, refunded FROM payments WHERE session = ?').bind(o.id).first();
    const legacy = !prior && await env.DB.prepare('SELECT 1 AS x FROM users u JOIN refunds r ON r.sub = u.sub WHERE u.sub = ? AND u.stripe_session = ?').bind(o.client_reference_id, o.id).first();
    if ((prior && prior.refunded >= prior.amount) || legacy) return new Response('ok (refunded)');
    await env.DB.prepare('INSERT OR IGNORE INTO checkouts (id, sub) VALUES (?, ?)').bind(o.id, o.client_reference_id).run();
    await env.DB.prepare('INSERT INTO users (sub) VALUES (?) ON CONFLICT(sub) DO NOTHING').bind(o.client_reference_id).run();
    await markPaid(env, o.client_reference_id, o);
    await sendThanks(env, o.client_reference_id, o.customer_details && o.customer_details.email);   // once per account; no-op without RESEND_API_KEY
  }
  if (evt.type === 'charge.refunded' && o.payment_intent) {
    // Any refund is recorded against the payment (partial ones too, for the
    // dashboard's net revenue). Only a full refund removes access again.
    const s = await stripeGet(env, `checkout/sessions?payment_intent=${encodeURIComponent(o.payment_intent)}`);
    const cs = s.data && s.data[0];
    const sub = cs && cs.client_reference_id;
    if (sub) {
      const amount = Number.isInteger(o.amount) ? o.amount : Number(env.PRICE_CENTS || 599);
      const refunded = Number.isInteger(o.amount_refunded) ? o.amount_refunded : (o.refunded ? amount : 0);
      // Out-of-order refund events never lower the refunded total.
      const stmts = [env.DB.prepare(`INSERT INTO payments (session, sub, amount, currency, at, refunded, refunded_at) VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, datetime('now'))
        ON CONFLICT(session) DO UPDATE SET refunded = MAX(refunded, excluded.refunded), refunded_at = excluded.refunded_at`)
        .bind(cs.id, sub, amount, o.currency || 'usd', cs.created ? sqlTime(cs.created) : null, refunded)];
      if (o.refunded) stmts.push(
        env.DB.prepare('UPDATE users SET unlimited = 0 WHERE sub = ?').bind(sub),
        env.DB.prepare('INSERT OR REPLACE INTO refunds (sub) VALUES (?)').bind(sub),
      );
      await env.DB.batch(stmts);
    }
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
  if (isBot(request)) return new Response(null, { status: 204 });
  if (await limited(request, env, 'hit', 60)) return tooMany();
  const day = latestFlight();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO visits (day, device, src, country, mobile) VALUES (?, ?, ?, ?, ?)').bind(day, b.device, src, country, mobile),
    env.DB.prepare(PILOT_HIT).bind(b.device, day, src, country, mobile),
  ]);
  return new Response(null, { status: 204 });
}

/* ------------------------------------------------------------ events
   POST /api/event { device, kind }: an anonymous product event (paywall seen,
   buy pressed, shared, pass redeemed, an error). One row per device per kind
   per flight day, and a per-day count the dashboard reads. Nothing else. */
async function postEvent(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  if (!b || typeof b.device !== 'string' || !DEVICE_RE.test(b.device) || !EVENT_KINDS.includes(b.kind)) return json({ error: 'invalid' }, { status: 422 });
  if (isBot(request)) return new Response(null, { status: 204 });
  if (await limited(request, env, 'event')) return tooMany();
  const day = latestFlight();
  await env.DB.batch([
    // the owner's own devices are never counted
    env.DB.prepare('INSERT OR IGNORE INTO events (day, kind, device) SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM ignore_devices WHERE device = ?3)').bind(day, b.kind, b.device),
    env.DB.prepare('INSERT INTO counters (day, kind, n) SELECT ?, ?, 1 WHERE changes() = 1 ON CONFLICT(day, kind) DO UPDATE SET n = n + 1').bind(day, b.kind),
  ]);
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
  // The owner's own Google account (and anything it buys) is left out of every number.
  try { await env.DB.prepare('INSERT OR IGNORE INTO ignore_subs (sub) VALUES (?)').bind(who.sub).run(); } catch (e) { /* not fatal */ }
  const exp = Date.now() + ADMIN_DAYS * 864e5;
  return json({ token: `${exp}.${await hmac(env.SESSION_SECRET, `admin:${exp}`)}`, email: who.email });
}
async function isAdmin(request, env) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  const [exp, sig] = tok.split('.');
  return Boolean(env.SESSION_SECRET && exp && sig && Number(exp) > Date.now() && sig === await hmac(env.SESSION_SECRET, `admin:${exp}`));
}

/* Thank-you emails to buyers: how many went out, how many paying accounts
   haven't had one (bought before it existed, or before the key was set), and
   a button's worth of POST to send those now. */
async function adminThanks(request, env) {
  if (!await isAdmin(request, env)) return json({ error: 'signed out' }, { status: 401 });
  const waitingQ = "SELECT u.sub, u.email FROM users u LEFT JOIN thanks t ON t.sub = u.sub WHERE u.unlimited = 1 AND t.sub IS NULL AND u.email IS NOT NULL AND u.email != ''";
  if (request.method === 'POST') {
    let b = {};
    try { b = await request.json(); } catch { /* no body: thank earlier buyers */ }
    if (b && b.test) return json({ test: await sendTest(env, String(b.test).trim(), b.variant === 'earlier' ? 'earlier' : 'new') });
    const rows = (await env.DB.prepare(`${waitingQ} LIMIT 40`).all()).results || [];
    let sent = 0, failed = 0;
    for (const r of rows) { const s = await sendThanks(env, r.sub, r.email, 'earlier'); if (s === 'sent') sent++; else if (s !== 'already') failed++; }
    return json({ sent, failed, on: Boolean(env.RESEND_API_KEY) });
  }
  const sent = await env.DB.prepare('SELECT COUNT(*) AS c FROM thanks').first();
  const waiting = await env.DB.prepare(`SELECT COUNT(*) AS c FROM (${waitingQ})`).first();
  // The log the dashboard shows: latest sends (email masked, no account ids), and
  // paying accounts still unthanked a day after paying (an automatic send failed).
  const recent = ((await env.DB.prepare(`SELECT t.email, t.sent, u.paid_at FROM thanks t LEFT JOIN users u ON u.sub = t.sub
    WHERE t.sub NOT IN (SELECT sub FROM ignore_subs) ORDER BY t.sent DESC LIMIT 10`).all()).results || []).map((r) => ({
    email: maskEmail(r.email), sent: r.sent,
    kind: r.paid_at && Date.parse(`${r.sent.replace(' ', 'T')}Z`) - Date.parse(`${r.paid_at.replace(' ', 'T')}Z`) > 864e5 ? 'earlier' : 'new',
  }));
  const late = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users u LEFT JOIN thanks t ON t.sub = u.sub
    WHERE u.unlimited = 1 AND t.sub IS NULL AND u.paid_at IS NOT NULL AND u.paid_at < datetime('now', '-1 day')
      AND u.email IS NOT NULL AND u.email != '' AND u.sub NOT IN (SELECT sub FROM ignore_subs)`).first();
  return json({ on: Boolean(env.RESEND_API_KEY), sent: sent.c || 0, waiting: waiting.c || 0, late: (late && late.c) || 0, recent }, { headers: { 'cache-control': 'no-store' } });
}

/* GET /api/admin/stats: everything the flight deck shows, built by
   api/src/dash.js. One copy is kept at the edge for 10 minutes (leaving /dev
   open or reloading it costs nothing); ?fresh=1 (Refresh) builds a new one,
   but never more than once a minute, so a stuck button can't eat the quota. */
const DASH_CACHE = '/api/admin/stats-cache-v2';
async function getAdmin(request, env, ctx) {
  if (!await isAdmin(request, env)) return json({ error: 'signed out' }, { status: 401 });
  const u0 = new URL(request.url);
  const cacheKey = new Request(new URL(DASH_CACHE, request.url).toString());
  const hit = await caches.default.match(cacheKey);
  if (hit) {
    const built = Number(hit.headers.get('x-built') || 0);
    const fresh = u0.searchParams.has('fresh');
    if (!fresh || Date.now() - built < 60e3) {
      return new Response(hit.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-dash-cache': fresh ? 'throttled' : 'hit' } });
    }
  }
  let health = null;
  try { health = await (await getHealth(env, ctx)).json(); } catch { /* shown as unknown */ }
  const body = await buildDashboard(env, {
    T: latestFlight(), TC: latestFlight(Date.now() - 2 * 36e5), launch: LAUNCH_UTC, priceCents: Number(env.PRICE_CENTS || 599), health, stripeGet, d1Usage,
  });
  const text = JSON.stringify(body);
  ctx.waitUntil(caches.default.put(cacheKey, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600', 'x-built': String(body.builtAt) } })));
  return new Response(text, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-dash-cache': 'miss' } });
}

/* Today's D1 usage for the whole account (the free tier's 5M rows read a day
   resets at 00:00 UTC), from Cloudflare's GraphQL analytics. Needs the
   CF_API_TOKEN secret (Account Analytics: Read) and CF_ACCOUNT_ID; D1_DATABASE_ID
   narrows it to this database. Without them: null (the page says so). */
async function d1Usage(env) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return null;
  const day = new Date().toISOString().slice(0, 10);
  const key = new Request(`https://karman.day/api/admin/d1-usage/${day}`);
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const filter = env.D1_DATABASE_ID ? '{ date: $d, databaseId: $db }' : '{ date: $d }';
  const query = `query ($a: String!, $d: Date!${env.D1_DATABASE_ID ? ', $db: String!' : ''}) { viewer { accounts(filter: { accountTag: $a }) {
    d1AnalyticsAdaptiveGroups(limit: 100, filter: ${filter}) { sum { rowsRead rowsWritten readQueries writeQueries } } } } }`;
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: env.CF_ACCOUNT_ID, d: day, db: env.D1_DATABASE_ID } }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const groups = (((j.data || {}).viewer || {}).accounts || [])[0];
  if (!groups) return null;
  const sum = (k) => (groups.d1AnalyticsAdaptiveGroups || []).reduce((a, g) => a + ((g.sum && g.sum[k]) || 0), 0);
  const out = { dayUTC: day, rowsRead: sum('rowsRead'), rowsWritten: sum('rowsWritten'), limitRead: 5e6, limitWritten: 1e5, at: new Date().toISOString() };
  await caches.default.put(key, new Response(JSON.stringify(out), { headers: { 'cache-control': 'public, max-age=600' } }));
  return out;
}

/* "This browser is mine": the owner's devices, left out of every number.
   GET ?device= tells the page whether this browser is already on the list. */
async function adminIgnore(request, env) {
  if (!await isAdmin(request, env)) return json({ error: 'signed out' }, { status: 401 });
  const url = new URL(request.url);
  let device = url.searchParams.get('device') || '';
  if (request.method !== 'GET') { try { const b = await request.json(); device = (b && b.device) || device; } catch { /* query string */ } }
  if (!DEVICE_RE.test(device)) {
    if (request.method !== 'GET') return json({ error: 'invalid device' }, { status: 422 });
    device = '';
  }
  if (request.method === 'POST') await env.DB.prepare('INSERT OR IGNORE INTO ignore_devices (device) VALUES (?)').bind(device).run();
  else if (request.method === 'DELETE') await env.DB.prepare('DELETE FROM ignore_devices WHERE device = ?').bind(device).run();
  else if (request.method !== 'GET') return json({ error: 'method' }, { status: 405 });
  const c = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM ignore_devices) AS devices, (SELECT COUNT(*) FROM ignore_subs) AS subs, (SELECT COUNT(*) FROM ignore_devices WHERE device = ?) AS mine').bind(device).first();
  return json({ ok: true, ignored: Boolean(c && c.mine), devices: (c && c.devices) || 0, subs: (c && c.subs) || 0 }, { headers: { 'cache-control': 'no-store' } });
}

/* POST /api/admin/rebuild: forget the frozen numbers of the last 14 days (and
   those cohorts' retention), so they are re-frozen over the next builds with
   the current exclusions. Older days stay as they were. */
async function adminRebuild(request, env) {
  if (!await isAdmin(request, env)) return json({ error: 'signed out' }, { status: 401 });
  // At most once an hour: re-freezing costs a few hundred thousand rows at scale.
  const last = await env.DB.prepare("SELECT v FROM meta WHERE k = 'rebuild_at'").first();
  if (last && Date.now() - Number(last.v) < 36e5) return json({ error: 'once an hour', next: Number(last.v) + 36e5 }, { status: 429 });
  const from = latestFlight() - 14;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta (k, v) VALUES ('rebuild_at', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(Date.now())),
    env.DB.prepare('DELETE FROM day_stats WHERE n >= ?').bind(from),
    env.DB.prepare('DELETE FROM cohort_ret WHERE n >= ?').bind(from - 30),
  ]);
  try { await caches.default.delete(new Request(new URL(DASH_CACHE, request.url).toString())); } catch { /* expires on its own */ }
  return json({ ok: true, from });
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
    // Never fatal: if D1 refuses (a daily limit, a blip), the tables already
    // exist, so carry on and try again on a later request.
    schemaReady = env.DB.batch(statements.map((x) => env.DB.prepare(x))).catch((e) => { console.warn('schema check failed', e && e.message); setTimeout(() => { schemaReady = null; }, 0); });
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
    if (u && request.method === 'GET') return getUnlock(u[1], env, url.searchParams.get('device'));
    if (url.pathname === '/api/checkout' && request.method === 'POST') return postCheckout(request, env);
    if (url.pathname === '/api/health' && request.method === 'GET') return getHealth(env, ctx);
    if (url.pathname === '/api/reports' && request.method === 'GET') return getReports(env);
    if (url.pathname === '/api/save' && request.method === 'GET') return getSave(request, env);
    if (url.pathname === '/api/save' && request.method === 'PUT') return putSave(request, env);
    if (url.pathname === '/api/stripe' && request.method === 'POST') return postStripe(request, env);
    if (url.pathname === '/api/me' && request.method === 'GET') return getMe(request, env);
    if (url.pathname === '/api/play' && request.method === 'POST') return postPlay(request, env);
    if (url.pathname === '/api/hit' && request.method === 'POST') return postHit(request, env);
    if (url.pathname === '/api/event' && request.method === 'POST') return postEvent(request, env);
    if (url.pathname === '/api/admin/login' && request.method === 'POST') return postAdminLogin(request, env);
    if (url.pathname === '/api/admin/stats' && request.method === 'GET') return getAdmin(request, env, ctx);
    if (url.pathname === '/api/admin/thanks') return adminThanks(request, env);
    if (url.pathname === '/api/admin/ignore') return adminIgnore(request, env);
    if (url.pathname === '/api/admin/rebuild' && request.method === 'POST') return adminRebuild(request, env);
    const ap = url.pathname.match(/^\/api\/admin\/passes(?:\/([\w-]{3,40}))?$/);
    if (ap) return adminPasses(request, env, ap[1]);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, { status: 404 });
    return env.ASSETS.fetch(request);    // everything else: the game itself
  },
};
