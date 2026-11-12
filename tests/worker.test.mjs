// KÁRMÁN · tests/worker.test.mjs — run with: node tests/worker.test.mjs
// Exercises the Worker against an in-memory SQLite stand-in for D1.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const worker = (await import('../api/src/index.js')).default;

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
const D1 = { batch: async (list) => Promise.all(list.map((x) => x.run())), prepare: (sql) => { const st = db.prepare(sql); let args = []; const o = {
  bind: (...a) => { args = a; return o; },
  run: async () => st.run(...args), first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }) }; return o; } };
const env = { DB: D1, SESSION_SECRET: 'test-secret', ASSETS: { fetch: async () => new Response('page') } };
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const ctx = { waitUntil() {} };
const call = (path, init) => worker.fetch(new Request(`https://karman.day${path}`, init), env, ctx);

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  ✗', msg); } };

// the Worker's built-in schema matches db/schema.sql
const { SCHEMA } = await import('../api/src/schema.js');
check(SCHEMA === fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'), 'api/src/schema.js matches db/schema.sql');

// unlock codes
db.exec("INSERT INTO unlock_codes (code, note) VALUES ('PILOT-1234', 'friends')");
check((await (await call('/api/unlock/pilot-1234')).json()).valid === true, 'active code is valid (case-insensitive)');
db.exec("UPDATE unlock_codes SET active = 0 WHERE code = 'PILOT-1234'");
check((await (await call('/api/unlock/PILOT-1234')).json()).valid === false, 'revoked code is invalid');
check((await (await call('/api/unlock/NOPE-0000')).json()).valid === false, 'unknown code is invalid');

// reports
const rep = (qid) => call('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qid, n: 3, device: 'device-abc-123' }) });
check((await rep('s1-st-01')).status === 204, 'report accepted');
await rep('s1-st-01');
check(db.prepare('SELECT COUNT(*) c FROM reports').get().c === 1, 'duplicate report from same device ignored');
await call('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qid: 's1-st-01', n: 3, device: 'device-xyz-999' }) });
const top = await (await call('/api/reports')).json();
check(top.questions.length === 1 && top.questions[0].qid === 's1-st-01' && top.questions[0].reports === 2 && !('device' in top.questions[0]), '/api/reports lists ids and counts only');

// sessions + /api/me
db.exec("INSERT INTO users (sub, email, unlimited) VALUES ('g-42', 'a@b.c', 1)");
const enc = new TextEncoder();
const key = await crypto.subtle.importKey('raw', enc.encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('g-42')))].map((x) => x.toString(16).padStart(2, '0')).join('');
const me = await (await call('/api/me', { headers: { authorization: `Bearer g-42.${sig}` } })).json();
check(me.unlimited === true, '/api/me sees the purchase');
check((await call('/api/me', { headers: { authorization: 'Bearer g-42.forged' } })).status === 401, 'forged session rejected');
check((await call('/api/play', { method: 'POST', headers: { authorization: `Bearer g-42.${sig}` } })).status === 204, 'play logged');

// Stripe webhook: a signed checkout.session.completed unlocks the buyer; a bad signature is refused
env.STRIPE_WEBHOOK_SECRET = 'whsec_test123';
db.exec("INSERT INTO users (sub, email) VALUES ('g-77', 'buyer@b.c')");
const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', client_reference_id: 'g-77' } } });
const t = Math.floor(Date.now() / 1000);
const wkey = await crypto.subtle.importKey('raw', enc.encode('whsec_test123'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const v1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', wkey, enc.encode(`${t}.${evt}`)))].map((x) => x.toString(16).padStart(2, '0')).join('');
check((await call('/api/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=deadbeef` }, body: evt })).status === 400, 'webhook with a bad signature refused');
check(db.prepare("SELECT unlimited FROM users WHERE sub = 'g-77'").get().unlimited === 0, 'bad webhook changes nothing');
check((await call('/api/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}` }, body: evt })).status === 200, 'signed webhook accepted');
const sig77 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('g-77')))].map((x) => x.toString(16).padStart(2, '0')).join('');
check((await (await call('/api/me', { headers: { authorization: `Bearer g-77.${sig77}` } })).json()).unlimited === true, 'buyer is Unlimited after the webhook');
check(!db.prepare("SELECT 1 FROM thanks WHERE sub = 'g-77'").get(), 'no thank-you email (or mark) without RESEND_API_KEY');

// Thank-you email: sent once through Resend when the key is set, never twice
{
  env.RESEND_API_KEY = 're_test';
  const sentMail = [];
  const f0 = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { sentMail.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: `em_${sentMail.length}` }), { status: 200 }); }
    return f0(url, init);
  };
  db.exec("INSERT INTO users (sub, email) VALUES ('g-88', 'fan@b.c')");
  const evt2 = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_2', payment_status: 'paid', client_reference_id: 'g-88', customer_details: { email: 'stripe@b.c' } } } });
  const t2 = Math.floor(Date.now() / 1000);
  const s2 = [...new Uint8Array(await crypto.subtle.sign('HMAC', wkey, enc.encode(`${t2}.${evt2}`)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await call('/api/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t2},v1=${s2}` }, body: evt2 });
  check(sentMail.length === 1 && sentMail[0].to[0] === 'fan@b.c' && sentMail[0].reply_to === 'hello@karman.day' && /Unlimited/.test(sentMail[0].subject), 'buyer gets one thank-you email at their Google address');
  check(db.prepare("SELECT id FROM thanks WHERE sub = 'g-88'").get().id === 'em_1', 'thank-you is marked with the message id');
  await call('/api/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t2},v1=${s2}` }, body: evt2 });
  check(sentMail.length === 1, 'a repeated webhook never emails twice');
  globalThis.fetch = f0;
  delete env.RESEND_API_KEY;
}

// Lost webhook: our record says unpaid, Stripe says paid → /api/me heals it.
// A refunded payment never comes back.
env.STRIPE_SECRET_KEY = 'sk_test_x';
const stripeSessions = {
  cs_lost: { id: 'cs_lost', payment_status: 'paid', payment_intent: { latest_charge: { refunded: false } } },
  cs_refunded: { id: 'cs_refunded', payment_status: 'paid', payment_intent: { latest_charge: { refunded: true } } },
  cs_open: { id: 'cs_open', payment_status: 'unpaid', payment_intent: null },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/checkout\/sessions\/([\w]+)/);
  if (m) return new Response(JSON.stringify(stripeSessions[m[1]] || {}), { status: 200 });
  if (String(url).includes('api.stripe.com/v1/checkout/sessions') && init && init.method === 'POST') return new Response(JSON.stringify({ id: 'cs_new', url: 'https://checkout.stripe.com/x' }), { status: 200 });
  return realFetch(url, init);
};
const sess = async (sub) => `${sub}.${[...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(sub)))].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
db.exec("INSERT INTO users (sub, email) VALUES ('g-lost', 'l@b.c'), ('g-ref', 'r@b.c'), ('g-open', 'o@b.c')");
db.exec("INSERT INTO checkouts (id, sub) VALUES ('cs_open', 'g-lost'), ('cs_lost', 'g-lost'), ('cs_refunded', 'g-ref'), ('cs_open', 'g-open')".replace("('cs_open', 'g-open')", "('cs_open2', 'g-open')"));
stripeSessions.cs_open2 = stripeSessions.cs_open;
const meOf = async (sub) => (await call('/api/me', { headers: { authorization: `Bearer ${await sess(sub)}` } })).json();
const lost = await meOf('g-lost');
check(lost.unlimited === true, 'paid but webhook lost: /api/me asks Stripe and unlocks');
check(db.prepare("SELECT unlimited FROM users WHERE sub = 'g-lost'").get().unlimited === 1, '...and records it');
const ref = await meOf('g-ref');
check(ref.unlimited === false && ref.refunded === true, 'refunded payment stays locked and says refunded');
const open = await meOf('g-open');
check(open.unlimited === false && open.refunded === false, 'abandoned checkout: locked, not refunded (device keeps nothing it never had)');
globalThis.fetch = realFetch;

// Cloud save: create, conflicting write refused with the current copy, retry on it
const sv = async (sub, method, body) => call('/api/save', { method, headers: { authorization: `Bearer ${await sess(sub)}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
check((await (await sv('g-lost', 'GET')).json()).ver === 0, 'no cloud save yet → ver 0');
check((await (await sv('g-lost', 'PUT', { data: { days: { 1: { n: 1 } } }, base: 0 })).json()).ver === 1, 'first save → ver 1');
const stale = await sv('g-lost', 'PUT', { data: { days: {} }, base: 0 });
const staleBody = await stale.json();
check(stale.status === 409 && staleBody.ver === 1 && staleBody.data.days[1], 'stale write refused with the current copy');
check((await (await sv('g-lost', 'PUT', { data: { days: { 1: { n: 1 }, 2: { n: 2 } } }, base: 1 })).json()).ver === 2, 'write on the current copy → ver 2');
check((await call('/api/save', { headers: { authorization: 'Bearer g-lost.forged' } })).status === 401, 'cloud save needs a real session');

// results validation (7 legs)
const res = (legs) => call('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n: 1, device: 'device-abc-123', pts: 300, legs, chips: '2222222'.slice(0, legs.length) }) });
check((await res('1101011')).status === 204, '7-leg result accepted');
check((await res('11010')).status === 422, '5-leg result rejected');

// stats ignore rows recorded before the flight's date (old launch-date test plays)
db.exec("INSERT INTO results (n, device, pts, legs, chips, created) VALUES (1, 'old-device-0001', 700, '1111111', '4444444', '2020-01-01 00:00:00')");
const s1 = await (await call('/api/stats/1')).json();
check(s1.players === 1 && s1.buckets.length === 1 && s1.buckets[0][0] === 300, 'stats count only current-era rows');

// numbered Unlimited runs: their own crowd, kept apart from daily flights
const runPost = (run, device, pts) => call('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run, device, pts, legs: '1111111', chips: '2222222' }) });
check((await runPost(3, 'device-run-0001', 400)).status === 204, 'run result accepted');
await runPost(3, 'device-run-0002', 200);
const r3 = await (await call('/api/stats/r3')).json();
check(r3.players === 2 && r3.run === true, 'run stats count only that run');
check((await (await call('/api/stats/r4')).json()).players === 0, 'other runs are separate');
check((await runPost(0, 'device-run-0003', 100)).status === 422, 'run 0 rejected');

// visits: first open of the day per device, source cleaned up
const hit = (device, src, ua = 'Mozilla/5.0 (iPhone)') => call('/api/hit', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify({ device, src }) });
check((await hit('device-abc-123', 'www.Reddit.com')).status === 204, 'visit recorded');
await hit('device-abc-123', 'twitter');
check(db.prepare('SELECT COUNT(*) c FROM visits').get().c === 1, 'second open the same day ignored');
check(db.prepare('SELECT src, mobile FROM visits').get().src === 'reddit.com' && db.prepare('SELECT mobile FROM visits').get().mobile === 1, 'source normalised, phone detected');
await hit('device-zzz-999', '<script>');
check(db.prepare("SELECT src FROM visits WHERE device = 'device-zzz-999'").get().src === 'other', 'junk source stored as other');
check((await hit('x', 'a')).status === 422, 'bad device refused');

// owner dashboard: only the owner's Google account gets in
check((await call('/api/admin/stats')).status === 401, 'dashboard needs a token');
check((await call('/api/admin/stats', { headers: { authorization: 'Bearer 9999999999999.forged' } })).status === 401, 'forged dashboard token refused');
env.GOOGLE_CLIENT_ID = 'cid';
const tokeninfo = { 'tok-owner': { aud: 'cid', iss: 'accounts.google.com', sub: 'g-own', email: 'Owner@Example.com', email_verified: 'true' },
  'tok-other': { aud: 'cid', iss: 'accounts.google.com', sub: 'g-x', email: 'someone@example.com', email_verified: 'true' } };
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/tokeninfo\?id_token=([\w-]+)/);
  if (m) return tokeninfo[m[1]] ? new Response(JSON.stringify(tokeninfo[m[1]])) : new Response('{}', { status: 400 });
  return prevFetch(url, init);
};
env.ADMIN_SHA256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('owner@example.com')))].map((x) => x.toString(16).padStart(2, '0')).join('');
const login = (idToken) => call('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
check((await login('tok-other')).status === 403, 'another Google account is refused');
const lg = await login('tok-owner');
check(lg.status === 200, 'owner signs in (email case ignored)');
const { token } = await lg.json();
const dash = await call('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } });
const dd = await dash.json();
check(dash.status === 200 && dd.totals.pilots >= 1 && Array.isArray(dd.daily) && dd.today.visits === 2 && dd.sources.length === 2, 'dashboard returns the numbers');
const dm = await (await call('/api/admin/stats?me=device-abc-123', { headers: { authorization: `Bearer ${token}` } })).json();
check(dm.today.visits === 1 && dm.totals.pilots === dd.totals.pilots - 1, '"leave out my plays" leaves that device out');

// free passes from the dashboard
const A = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
check((await call('/api/admin/passes', { method: 'POST', body: '{}' })).status === 401, 'making a pass needs the owner');
const mk = await (await call('/api/admin/passes', { method: 'POST', headers: A, body: JSON.stringify({ note: 'for Sam' }) })).json();
check(/^PASS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(mk.code), 'pass code has the readable format');
const U = (code, dev = 'device-phone-111') => call(`/api/unlock/${code}?device=${dev}`).then((r) => r.json());
check((await (await call(`/api/unlock/${mk.code}`)).json()).valid === false, 'a pass needs a device id');
check((await U(mk.code.toLowerCase())).valid === true, 'a new pass unlocks on the first device');
await U(mk.code);
const other = await U(mk.code, 'device-laptop-222');
check(other.valid === false && other.reason === 'claimed', 'a used pass is refused on a second device');
check((await U(mk.code)).valid === true, 'the first device keeps its pass');
let pl = (await (await call('/api/admin/passes', { headers: A })).json()).passes;
const mine = pl.find((x) => x.code === mk.code);
check(mine && mine.note === 'for Sam' && mine.active === 1 && mine.checks === 3 && mine.first && mine.claimed === 1, 'pass list shows note, status and use');
check((await call(`/api/admin/passes/${mk.code}`, { method: 'POST', headers: A, body: JSON.stringify({ active: false }) })).status === 200, 'revoke a pass');
check((await U(mk.code)).valid === false, 'a revoked pass stops unlocking');
await call(`/api/admin/passes/${mk.code}`, { method: 'POST', headers: A, body: JSON.stringify({ active: true }) });
check((await U(mk.code)).valid === true, 'a restored pass unlocks again');
check((await call(`/api/admin/passes/${mk.code}`, { method: 'DELETE', headers: A })).status === 200, 'delete a pass');
check((await U(mk.code)).valid === false && !db.prepare('SELECT 1 FROM unlock_claims WHERE code = ?').get(mk.code), 'a deleted pass is gone with its claim');
check((await call(`/api/admin/passes/${mk.code}`, { method: 'DELETE', headers: A })).status === 404, 'deleting twice is a 404');
check((await call(`/api/admin/passes/PASS-AAAA-BBBB`, { method: 'DELETE' })).status === 401, 'only the owner can delete');
check((await call('/api/admin/passes/PASS-NOPE-NOPE', { method: 'POST', headers: A, body: JSON.stringify({ active: false }) })).status === 404, 'unknown pass is a 404');
check((await call('/api/admin/passes', { headers: { authorization: 'Bearer 9999999999999.forged' } })).status === 401, 'forged token cannot list passes');
check((await call('/api/admin/thanks')).status === 401, 'thank-you status needs the owner');
const th = await (await call('/api/admin/thanks', { headers: A })).json();
check(th.on === false && th.sent === 1 && th.waiting >= 1, 'thank-you status: off, one sent, earlier buyers waiting');
{
  env.RESEND_API_KEY = 're_test';
  const mails = []; const f0 = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.resend.com/') ? (mails.push(JSON.parse(init.body)), new Response('{"id":"t"}', { status: 200 })) : f0(url, init));
  const tr = await (await call('/api/admin/thanks', { method: 'POST', headers: A, body: JSON.stringify({ test: 'me@x.y' }) })).json();
  check(tr.test === 'sent' && mails.length === 1 && mails[0].to[0] === 'me@x.y' && /^\[Test\]/.test(mails[0].subject) && !db.prepare("SELECT 1 FROM thanks WHERE email = 'me@x.y'").get(), 'a test copy goes out and marks nobody');
  globalThis.fetch = f0; delete env.RESEND_API_KEY;
}
globalThis.fetch = prevFetch;

console.log(fails ? `${fails} failed` : 'Worker checks passed.');
process.exit(fails ? 1 : 0);
