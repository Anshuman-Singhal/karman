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
// Today's flight number, as the Worker computes it (flights change at midnight Eastern).
const LAUNCH = Date.UTC(2026, 9, 7);
const flightAt = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)])); return Math.round((Date.UTC(p.year, p.month - 1, p.day) - LAUNCH) / 864e5) + 1; };
const T = flightAt(Date.now());
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

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

// results validation (7 legs; daily results only for today or yesterday)
const res = (legs, n = T, device = 'device-abc-123') => call('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n, device, pts: 300, legs, chips: '2222222'.slice(0, legs.length) }) });
check((await res('1101011')).status === 204, '7-leg result accepted');
check((await res('11010')).status === 422, '5-leg result rejected');
check((await res('1101011', T - 2, 'device-old-flight')).status === 422, 'a flight older than yesterday is refused (archive replay, ?dev picker)');
check((await res('1101011', T + 1, 'device-future-1')).status === 422, 'a future flight is refused');
check((await res('1101011', T - 1, 'device-late-0001')).status === 204, "yesterday's flight is accepted (started before midnight)");
check(db.prepare('SELECT COUNT(*) c FROM results WHERE n < ?').get(T - 1).c === 0, 'nothing landed on an old flight');
// pilots: one row per device, moved only by a NEW result
const pil = () => db.prepare("SELECT * FROM pilots WHERE device = 'device-abc-123'").get();
check(pil() && pil().flights === 1 && pil().first_flight === T && pil().last_flight === T && pil().streak === 1, 'a first result creates the pilot row');
await res('1101011');
check(pil().flights === 1, 'a resubmitted result never counts twice in pilots');
await res('1101011', T, 'device-late-0001');
const late = db.prepare("SELECT * FROM pilots WHERE device = 'device-late-0001'").get();
check(late.flights === 2 && late.first_flight === T - 1 && late.last_flight === T && late.streak === 2, 'yesterday then today: 2 flights, streak 2');

// stats ignore rows recorded before the flight's date (old launch-date test plays)
db.exec(`INSERT INTO results (n, device, pts, legs, chips, created) VALUES (${T}, 'old-device-0001', 700, '1111111', '4444444', '2020-01-01 00:00:00')`);
const s1 = await (await call(`/api/stats/${T}`)).json();
check(s1.players === 2 && s1.buckets.length === 1 && s1.buckets[0][0] === 300, 'stats count only current-era rows');

// numbered Unlimited runs: their own crowd, kept apart from daily flights
const runPost = (run, device, pts) => call('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run, device, pts, legs: '1111111', chips: '2222222' }) });
check((await runPost(3, 'device-run-0001', 400)).status === 204, 'run result accepted');
await runPost(3, 'device-run-0002', 200);
const r3 = await (await call('/api/stats/r3')).json();
check(r3.players === 2 && r3.run === true, 'run stats count only that run');
check((await (await call('/api/stats/r4')).json()).players === 0, 'other runs are separate');
check((await runPost(0, 'device-run-0003', 100)).status === 422, 'run 0 rejected');
{
  const ctr = (k) => (db.prepare('SELECT n FROM counters WHERE day = ? AND kind = ?').get(T, k) || {}).n || 0;
  await runPost(3, 'device-run-0001', 400);       // a resubmission
  await runPost(1, 'device-run-0004', 100);       // the free run
  check(ctr('runs_paid') === 2 && ctr('runs_free') === 1 && db.prepare("SELECT COUNT(*) c FROM events WHERE kind = 'run' AND day = ?").get(T).c === 2, 'Unlimited runs are counted as they land (resubmissions never), paid ones mark the pilot');
}

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
check(Boolean(db.prepare("SELECT 1 FROM ignore_subs WHERE sub = 'g-own'").get()), "the owner's Google account is left out of the numbers on sign-in");
const dash = await call('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } });
const dd = await dash.json();
const dT = (x) => x.days.find((d) => d.n === T);
check(dash.status === 200 && dd.v === 2 && dd.T === T && dd.days.length === T && dT(dd).opened === 2 && dT(dd).fin === 3, 'dashboard returns the v2 numbers');
const AH = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
check((await call('/api/admin/ignore', { method: 'POST', body: JSON.stringify({ device: 'device-abc-123' }) })).status === 401, '"this browser is mine" needs the owner');
const ig = await (await call('/api/admin/ignore', { method: 'POST', headers: AH, body: JSON.stringify({ device: 'device-abc-123' }) })).json();
check(ig.ignored === true && ig.devices === 1, '"this browser is mine" registers the device');
check((await (await call('/api/admin/ignore?device=device-abc-123', { headers: AH })).json()).ignored === true, '...and the page can ask whether it is');
const dm = await (await call('/api/admin/stats?fresh=1', { headers: AH })).json();
check(dT(dm).opened === 1 && dT(dm).fin === 2 && dm.excluded.devices === 1 && dm.excluded.subs === 1, 'an owner device is left out of opens and finishes');
const un = await (await call('/api/admin/ignore', { method: 'DELETE', headers: AH, body: JSON.stringify({ device: 'device-abc-123' }) })).json();
check(un.ignored === false && un.devices === 0, '...and can be put back');

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
check(th.recent.length === 1 && th.recent[0].email === 'fa•••@b.c' && th.recent[0].kind === 'new' && !('sub' in th.recent[0]) && th.late === 0, 'thank-you log: latest sends, masked, no account ids');
db.exec("INSERT INTO users (sub, email, unlimited, paid_at) VALUES ('g-late', 'late@b.c', 1, datetime('now', '-2 days'))");
check((await (await call('/api/admin/thanks', { headers: A })).json()).late === 1, 'a buyer unthanked a day after paying is flagged (the automatic send failed)');
{
  env.RESEND_API_KEY = 're_test';
  const mails = []; const f0 = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.resend.com/') ? (mails.push(JSON.parse(init.body)), new Response('{"id":"t"}', { status: 200 })) : f0(url, init));
  const tr = await (await call('/api/admin/thanks', { method: 'POST', headers: A, body: JSON.stringify({ test: 'me@x.y' }) })).json();
  const tr2 = await (await call('/api/admin/thanks', { method: 'POST', headers: A, body: JSON.stringify({ test: 'me@x.y', variant: 'earlier' }) })).json();
  check(tr2.test === 'sent' && /for a while/.test(mails[1].text) && !/just unlocked/.test(mails[1].text), 'earlier-buyer test copy uses the earlier wording');
  db.exec("INSERT INTO users (sub, email, unlimited) VALUES ('g-old', 'old@b.c', 1)");
  const sendOld = await (await call('/api/admin/thanks', { method: 'POST', headers: A })).json();
  const oldMail = mails.find((m) => m.to[0] === 'old@b.c');
  check(sendOld.sent >= 1 && oldMail && /for a while/.test(oldMail.text) && /See your welcome card/.test(oldMail.text), 'earlier buyers get the "for a while" email');
  check(tr.test === 'sent' && mails.length >= 1 && mails[0].to[0] === 'me@x.y' && /^\[Test\]/.test(mails[0].subject) && !db.prepare("SELECT 1 FROM thanks WHERE email = 'me@x.y'").get(), 'a test copy goes out and marks nobody');
  globalThis.fetch = f0; delete env.RESEND_API_KEY;
}
globalThis.fetch = prevFetch;


/* ------------------------------------------------------------------ events */
{
  const ev = (kind, device = 'device-ev-00001', ua = 'Mozilla/5.0 (iPhone)') => call('/api/event', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify({ device, kind }) });
  check((await ev('paywall_view')).status === 204, 'event accepted');
  await ev('paywall_view');
  await ev('paywall_view', 'device-ev-00002');
  await ev('share');
  const cnt = (k) => (db.prepare('SELECT n FROM counters WHERE day = ? AND kind = ?').get(T, k) || {}).n;
  check(db.prepare("SELECT COUNT(*) c FROM events WHERE kind = 'paywall_view'").get().c === 2 && cnt('paywall_view') === 2, 'one event per device per kind per day; the counter follows');
  check(cnt('share') === 1, 'kinds are counted apart');
  check((await ev('made_up_kind')).status === 422 && (await ev('share', 'x')).status === 422, 'unknown kinds and bad devices refused');
  await ev('buy_click', 'device-ev-bot01', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
  check(!cnt('buy_click'), 'crawlers are not counted');
  await hit('device-bot-0001', 'x', 'facebookexternalhit/1.1');
  check(!db.prepare("SELECT 1 FROM visits WHERE device = 'device-bot-0001'").get(), 'link unfurlers are not visitors');
  await hit('device-cubot-001', 'x', 'Mozilla/5.0 (Linux; Android 11; CUBOT X30 Build/RP1A) Mobile');
  check(Boolean(db.prepare("SELECT 1 FROM visits WHERE device = 'device-cubot-001'").get()), 'a real phone whose name contains "bot" still counts');
  db.exec("INSERT INTO ignore_devices (device) VALUES ('device-own-ev01')");
  await ev('share', 'device-own-ev01');
  check(cnt('share') === 1 && !db.prepare("SELECT 1 FROM events WHERE device = 'device-own-ev01'").get(), "the owner's devices send no events");
  db.exec("DELETE FROM ignore_devices WHERE device = 'device-own-ev01'");
  // rate limit per IP (fails open without an IP); over the limit nothing is written
  const evIp = (ip, i) => call('/api/event', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ device: `device-rl-${String(i).padStart(4, '0')}`, kind: 'share' }) });
  const codes = []; for (let i = 0; i < 32; i++) codes.push((await evIp('203.0.113.9', i)).status);
  check(codes.slice(0, 30).every((x) => x === 204) && codes[30] === 429 && codes[31] === 429, 'events are rate-limited per IP (30 a minute)');
  check((await evIp('203.0.113.10', 99)).status === 204, '...other IPs are unaffected');
  check(!db.prepare("SELECT 1 FROM events WHERE device = 'device-rl-0031'").get(), '...and a refused event writes nothing');
  const p0 = db.prepare("SELECT * FROM pilots WHERE device = 'device-zzz-999'").get();
  check(p0 && p0.first_seen === T && p0.first_src === 'other' && p0.first_flight === null && p0.flights === 0, 'a first visit creates the pilot row with its source');
}

/* ------------------------------------------------------------------ payments */
{
  const sign = async (obj) => { const body = JSON.stringify(obj); const t = Math.floor(Date.now() / 1000); return call('/api/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${hex(await crypto.subtle.sign('HMAC', wkey, enc.encode(`${t}.${body}`)))}` }, body }); };
  const pay = (sess) => db.prepare('SELECT * FROM payments WHERE session = ?').get(sess);
  check(pay('cs_test_1') && pay('cs_test_1').amount === 599 && pay('cs_test_1').est === 1, 'a webhook without an amount records the list price, marked as an estimate');
  db.exec("INSERT INTO users (sub, email) VALUES ('g-pay', 'p@b.c')");
  await sign({ type: 'checkout.session.completed', data: { object: { id: 'cs_pay_1', payment_status: 'paid', client_reference_id: 'g-pay', amount_total: 479, currency: 'eur' } } });
  check(pay('cs_pay_1').amount === 479 && pay('cs_pay_1').currency === 'eur' && pay('cs_pay_1').est === 0, 'the webhook records what Stripe actually charged');
  await sign({ type: 'checkout.session.completed', data: { object: { id: 'cs_pay_1', payment_status: 'paid', client_reference_id: 'g-pay', amount_total: 479, currency: 'eur' } } });
  check(db.prepare("SELECT COUNT(*) c FROM payments WHERE sub = 'g-pay'").get().c === 1, 'a repeated webhook records the payment once');
  const f0 = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('checkout/sessions?payment_intent=pi_pay')
    ? new Response(JSON.stringify({ data: [{ id: 'cs_pay_1', client_reference_id: 'g-pay' }] })) : f0(url, init));
  await sign({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_pay', amount: 479, amount_refunded: 200, refunded: false, currency: 'eur' } } });
  check(pay('cs_pay_1').refunded === 200 && db.prepare("SELECT unlimited FROM users WHERE sub = 'g-pay'").get().unlimited === 1, 'a partial refund is recorded and keeps access');
  await sign({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_pay', amount: 479, amount_refunded: 479, refunded: true, currency: 'eur' } } });
  check(pay('cs_pay_1').refunded === 479 && db.prepare("SELECT unlimited FROM users WHERE sub = 'g-pay'").get().unlimited === 0 && db.prepare("SELECT 1 FROM refunds WHERE sub = 'g-pay'").get(), 'a full refund is recorded and removes access');
  await sign({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_pay', amount: 479, amount_refunded: 200, refunded: false, currency: 'eur' } } });
  check(pay('cs_pay_1').refunded === 479, 'a late, smaller refund event never lowers the refunded total');
  await sign({ type: 'checkout.session.completed', data: { object: { id: 'cs_pay_1', payment_status: 'paid', client_reference_id: 'g-pay', amount_total: 479, currency: 'eur' } } });
  check(db.prepare("SELECT unlimited FROM users WHERE sub = 'g-pay'").get().unlimited === 0 && db.prepare("SELECT 1 FROM refunds WHERE sub = 'g-pay'").get(), 'a retried "paid" webhook after a full refund does not hand Unlimited back');
  await sign({ type: 'checkout.session.completed', data: { object: { id: 'cs_pay_2', payment_status: 'paid', client_reference_id: 'g-pay', amount_total: 479, currency: 'eur' } } });
  check(db.prepare("SELECT unlimited FROM users WHERE sub = 'g-pay'").get().unlimited === 1, '...but buying again (a new session) does');
  globalThis.fetch = f0;
}

/* ------------------------------------------------------------------ dashboard v2: rollups, retention, exclusions
   A fresh database with known history, filled straight into the raw tables
   (as if it predated pilots/day_stats), then built through the real endpoint. */
{
  const db2 = new DatabaseSync(':memory:');
  db2.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const D2 = { batch: async (list) => Promise.all(list.map((x) => x.run())), prepare: (sql) => { const st = db2.prepare(sql); let args = []; const o = {
    bind: (...a) => { args = a; return o; }, run: async () => st.run(...args), first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }) }; return o; } };
  const env2 = { DB: D2, SESSION_SECRET: 'test-secret', PRICE_CENTS: '599', ASSETS: env.ASSETS };
  // Pin the clock to mid-afternoon (ET) of today's flight, so "closed days" don't depend on when the tests run.
  const realNow = Date.now;
  Date.now = () => LAUNCH + (T - 1) * 864e5 + 20 * 36e5;
  const call2 = (path, init) => worker.fetch(new Request(`https://karman.day${path}`, init), env2, ctx);
  const at = (n, h = 14) => new Date(LAUNCH + (n - 1) * 864e5 + (h + 5) * 36e5).toISOString().slice(0, 19).replace('T', ' ');
  const R = db2.prepare('INSERT INTO results (n, device, pts, legs, chips, created) VALUES (?, ?, ?, ?, ?, ?)');
  const V = db2.prepare('INSERT INTO visits (day, device, src, country, mobile, created) VALUES (?, ?, ?, ?, ?, ?)');
  const fly = (dev, n, pts = 350, src = 'direct') => { R.run(n, dev, pts, '1110001', '2222222', at(n)); V.run(n, dev, src, 'US', 1, at(n, 13)); };
  for (let n = T - 12; n <= T; n++) { fly('dev-loyal-0001', n); fly('dev-owner-0001', n, 700); }
  ['a', 'b', 'c'].forEach((x) => fly(`dev-c3-${x}-001`, T - 3, 210, 'reddit.com'));
  fly('dev-c3-a-001', T - 2); fly('dev-c3-b-001', T - 1);
  fly('dev-c5-a-001', T - 5, 100, 'x.com'); fly('dev-c5-a-001', T - 4); fly('dev-c5-a-001', T - 3);
  fly('dev-gap-00001', T - 12); fly('dev-gap-00001', T - 2);
  fly('dev-yday-0001', T - 1, 300, 'google.com'); fly('dev-yday-0001', T);
  fly('dev-wk-000001', T - 12); fly('dev-wk-000001', T - 5);            // exactly 7 days apart: leaves and re-enters the weekly window
  fly('dev-mo-000001', T - 36); fly('dev-mo-000001', T - 6);            // exactly 30 days apart: the monthly window
  V.run(T - 1, 'dev-visit-0001', 'reddit.com', 'CA', 0, at(T - 1));
  R.run(1000001, 'dev-loyal-0001', 300, '1111111', '2222222', at(T - 1)); R.run(1000003, 'dev-loyal-0001', 300, '1111111', '2222222', at(T));
  R.run(1000003, 'dev-owner-0001', 300, '1111111', '2222222', at(T));
  db2.exec("INSERT INTO ignore_devices (device) VALUES ('dev-owner-0001'); INSERT INTO ignore_subs (sub) VALUES ('g-owner')");
  db2.exec(`INSERT INTO users (sub, email, unlimited, paid_at, stripe_session) VALUES ('g-buyer1', 'b1@x.y', 1, '${at(T - 4)}', 'cs_b1'), ('g-owner', 'own@x.y', 1, '${at(T - 4)}', 'cs_own')`);
  db2.exec(`INSERT INTO payments (session, sub, amount, at) VALUES ('cs_own', 'g-owner', 599, '${at(T - 4)}')`);
  db2.exec(`INSERT INTO reports (qid, device, n, created) VALUES ('q-own', 'dev-owner-0001', ${T}, datetime('now')), ('q-real', 'dev-loyal-0001', ${T}, datetime('now'))`);
  db2.exec("UPDATE meta SET v = '2099-01-01 00:00:00' WHERE k = 'live_from'");   // every run above predates the live counters
  const stats2 = async (q = '?fresh=1') => (await call2(`/api/admin/stats${q}`, { headers: { authorization: `Bearer ${token}` } })).json();

  let b = await stats2(), builds = 1;
  check(b.backfill.pilots === 'done' && b.cost.backfilled > 0, 'the first build backfills pilots for devices from before the table');
  const pr = (d) => db2.prepare('SELECT * FROM pilots WHERE device = ?').get(d);
  check(pr('dev-loyal-0001').flights === 13 && pr('dev-loyal-0001').first_flight === T - 12 && pr('dev-loyal-0001').last_flight === T && pr('dev-loyal-0001').streak === 13, 'backfill: flights, first, last and streak from the raw results');
  check(pr('dev-gap-00001').flights === 2 && pr('dev-gap-00001').streak === 1, 'backfill: a gap resets the streak');
  check(pr('dev-visit-0001').first_seen === T - 1 && pr('dev-visit-0001').first_src === 'reddit.com' && pr('dev-visit-0001').first_flight === null, 'backfill: visit-only devices get their first source');
  while ((b.backfill.pendingDays || b.backfill.pendingCohorts) && builds < 15) { b = await stats2(); builds++; }
  check(b.backfill.pendingDays === 0 && b.backfill.pendingCohorts === 0 && b.closedThrough === T - 2 && b.cost.frozen[0] === 1, `catch-up finishes within the row budget, oldest day first (${builds} builds)`);
  const rows0 = db2.prepare('SELECT n, data, updated FROM day_stats ORDER BY n').all();
  check(rows0.length === T - 2 && rows0[rows0.length - 1].n === T - 2, 'every closed day (n <= today - 2) is frozen, today and yesterday stay live');
  const b2 = await stats2();
  const rows1 = db2.prepare('SELECT n, data, updated FROM day_stats ORDER BY n').all();
  check(b2.cost.frozen.length === 0 && b2.cost.cohorts.length === 0 && JSON.stringify(rows0) === JSON.stringify(rows1), 'freezing is idempotent: a later build changes nothing');
  const day = (x, n) => x.days.find((d) => d.n === n);
  const raw = (n) => db2.prepare("SELECT COUNT(*) c FROM results WHERE n = ? AND device != 'dev-owner-0001'").get(n).c;
  check([T - 5, T - 3, T - 2].every((n) => day(b2, n).fin === raw(n)), 'frozen finishes match the raw rows (owner left out)');
  check(day(b2, T - 2).react === 1 && day(b2, T - 3).np === 3 && day(b2, T - 3).nv === 3 && day(b2, T - 3).act === 3, 'new pilots, activation and "back after 7+ days" per day');
  check(day(b2, T).fin === 2 && day(b2, T - 1).fin === 3 && day(b2, T).closed === false, 'today and yesterday are live and leave the owner out');
  check(day(b2, T - 2).hours.reduce((a, x) => a + x, 0) === raw(T - 2) && day(b2, T - 2).hours[14] === raw(T - 2), 'finishes by Eastern hour');
  check(day(b2, T - 2).wau === 8 && day(b2, T - 5).wau === 4 && day(b2, T - 5).mau === 5, 'weekly and monthly pilots frozen per day');
  const distinct = (a, z) => db2.prepare("SELECT COUNT(DISTINCT device) c FROM results WHERE n BETWEEN ? AND ? AND n < 1000000 AND device != 'dev-owner-0001'").get(a, z).c;
  const rollBad = [];
  for (let n = 1; n <= T - 2; n++) { const d = day(b2, n); if (d.wau !== distinct(n - 6, n) || d.mau !== distinct(n - 29, n)) rollBad.push(n); }
  check(rollBad.length === 0, `weekly/monthly pilots rolled forward day by day equal a full recount (${rollBad.join(',')})`);
  const core = db2.prepare("SELECT COUNT(*) c FROM (SELECT device FROM results WHERE n BETWEEN ? AND ? AND device != 'dev-owner-0001' GROUP BY device HAVING COUNT(*) >= 5)").get(T - 8, T - 2).c;
  check(b2.core && b2.core.n === T - 2 && b2.core.c === core, 'core pilots (5+ of 7 days) frozen with the day, not re-read every build');
  const dueBad = [];
  for (let c = 1; c <= T - 3; c++) { const r = b2.cohorts.find((x) => x.n === c); for (const k of b2.retK) if (c + k <= T - 2 && (!r || r.ret[k] == null)) dueBad.push(`${c}+${k}`); }
  check(dueBad.length === 0, `every retention window that has closed is filled, D30 included (${dueBad.slice(0, 5).join(',')})`);
  check(b2.money.buyers.every((x) => /•••@/.test(x.email)), 'buyer emails leave the Worker masked');
  // closed-window retention
  const coh = (n) => b2.cohorts.find((c) => c.n === n);
  check(coh(T - 3) && coh(T - 3).size === 3 && coh(T - 3).ret['1'] === 1 && !('2' in coh(T - 3).ret), 'D1 is written once its day has closed; D2 (yesterday) is not');
  check(coh(T - 5).ret['1'] === 1 && coh(T - 5).ret['2'] === 1 && coh(T - 5).ret['3'] === 0 && !('4' in coh(T - 5).ret), 'each window is written only when it has closed');
  check(!coh(T - 2) && !coh(T - 1), 'no retention at all for cohorts whose next day is still open');
  check(b2.yesterdayCohort.size === 1 && b2.yesterdayCohort.back === 1, "yesterday's newcomers back today (live, so far)");
  // pilots-based live numbers, owner left out
  check(b2.active.mau === 9 && b2.active.streak7 === 1 && b2.active.bestStreak === 13 && b2.active.regulars.today === 1, 'monthly pilots, streaks and regulars leave the owner out');
  check(b2.acquisition.some((a) => a.src === 'reddit.com' && a.nv === 3 && a.n === T - 3), 'acquisition by first source');
  check(b2.reports.length === 1 && b2.reports[0].qid === 'q-real', "the owner's own reports are left out");
  check(b2.unlimited.paidRuns === 1 && b2.unlimited.freeRunPilots === 1 && b2.unlimited.pilotsWeek === 1 && b2.unlimited.runsByDay[T][1] === 1, "Unlimited runs: older ones counted once into the counters, free and paid apart, the owner's left out");
  check(db2.prepare("SELECT v FROM meta WHERE k = 'runs_bf'").get().v === 'done' && (await stats2()).unlimited.paidRuns === 1, '...and never counted twice');
  // money: owner's purchase left out; older purchase backfilled once as an estimate
  check(b2.money.payments.length === 1 && b2.money.payments[0].amount === 599 && b2.money.payments[0].est === 1, "older purchases are backfilled (estimated without Stripe); the owner's own is left out");
  check(db2.prepare("SELECT COUNT(*) c FROM payments WHERE sub = 'g-buyer1'").get().c === 1, 'the payment backfill runs once');
  // with Stripe: the amount Stripe says; unreachable: try again later
  env2.STRIPE_SECRET_KEY = 'sk_test_y';
  db2.exec(`INSERT INTO users (sub, email, unlimited, paid_at, stripe_session) VALUES ('g-buyer2', 'b2@x.y', 1, '${at(T - 2)}', 'cs_b2'), ('g-buyer3', 'b3@x.y', 1, '${at(T - 2)}', 'cs_b3')`);
  const f0 = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('checkout/sessions/cs_b2')) return new Response(JSON.stringify({ id: 'cs_b2', payment_status: 'paid', amount_total: 499, currency: 'usd', created: Math.floor(Date.now() / 1000) - 86400, payment_intent: { latest_charge: { amount_refunded: 0 } } }));
    if (u.includes('checkout/sessions/cs_b3')) throw new Error('network down');
    if (u.startsWith('https://api.stripe.com/')) return new Response('{}', { status: 200 });
    return f0(url, init);
  };
  db2.exec("DELETE FROM meta WHERE k = 'pay_bf_day'");     // the purchase backfill looks again once a day
  await stats2();
  globalThis.fetch = f0;
  const pb2 = db2.prepare("SELECT * FROM payments WHERE sub = 'g-buyer2'").get();
  check(pb2 && pb2.amount === 499 && pb2.est === 0, 'older purchases are backfilled with what Stripe charged');
  check(!db2.prepare("SELECT 1 FROM payments WHERE sub = 'g-buyer3'").get(), 'Stripe unreachable: no guess, retried on a later build');
  delete env2.STRIPE_SECRET_KEY;
  // rebuild re-freezes the last 14 days with the current exclusions
  db2.exec("INSERT INTO ignore_devices (device) VALUES ('dev-loyal-0001')");
  check((await call2('/api/admin/rebuild', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status === 200, 'rebuild accepted');
  check((await call2('/api/admin/rebuild', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status === 429, 'rebuild at most once an hour');
  // a tiny row budget: one freeze per build (the first step may always run), oldest day first
  env2.DASH_LIMITS = { soft: 1 };
  let rb = await stats2();
  const order = [rb.cost.frozen.join(',')];
  rb = await stats2(); order.push(rb.cost.frozen.join(','));
  check(order[0] === String(T - 14) && order[1] === String(T - 13), `catch-up is sliced by the row budget, oldest first (${order.join(' then ')})`);
  // the daily catch-up budget: spent → no catch-up until the next UTC day
  env2.DASH_LIMITS = { daily: 1 };
  rb = await stats2();
  check(rb.cost.frozen.length === 0 && rb.cost.cohorts.length === 0 && rb.backfill.pendingDays > 0, 'catch-up stops once the daily budget is spent');
  db2.exec("UPDATE meta SET v = '2000-01-01' WHERE k = 'cu_day'");
  delete env2.DASH_LIMITS;
  rb = await stats2();
  check(rb.backfill.pendingDays === 0, '...and resumes the next day');
  check(day(rb, T - 2).fin === raw(T - 2) - 1, 'after a rebuild, newly excluded devices leave the frozen days too');
  const distinctX = (lo, hi) => db2.prepare('SELECT COUNT(DISTINCT device) c FROM results WHERE n BETWEEN ? AND ? AND n < 1000000 AND device NOT IN (SELECT device FROM ignore_devices)').get(lo, hi).c;
  const offRoll = (x, from) => { const bad = []; for (let n = from; n <= T - 2; n++) { const d = day(x, n); if (d.wau !== distinctX(n - 6, n) || d.mau !== distinctX(n - 29, n)) bad.push(n); } return bad; };
  check(offRoll(rb, T - 14).length === 0, `after a rebuild, rolled weekly/monthly pilots re-converge to the new exclusions (${offRoll(rb, T - 14).join(',')})`);
  // exclusions change with no rebuild: the next day frozen sees a different count and recounts
  db2.exec(`INSERT INTO ignore_devices (device) VALUES ('dev-c5-a-001'); DELETE FROM day_stats WHERE n >= ${T - 4}`);
  rb = await stats2();
  check(offRoll(rb, T - 4).length === 0 && day(rb, T - 4).exN === 3, `a later exclusion is picked up by the next frozen day (${offRoll(rb, T - 4).join(',')})`);
  db2.exec("DELETE FROM ignore_devices WHERE device = 'dev-c5-a-001'");
  db2.exec("DELETE FROM ignore_devices WHERE device = 'dev-loyal-0001'");

  // cost bound: the backfill takes at most 1000 devices per side per build, and nothing freezes until it is done
  const db3 = new DatabaseSync(':memory:');
  db3.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const D3 = { batch: D2.batch, prepare: (sql) => { const st = db3.prepare(sql); let args = []; const o = { bind: (...a) => { args = a; return o; }, run: async () => st.run(...args), first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }) }; return o; } };
  const env3 = { ...env2, DB: D3, DASH_LIMITS: { soft: 1500 } };
  const R3 = db3.prepare('INSERT INTO results (n, device, pts, legs, chips, created) VALUES (?, ?, ?, ?, ?, ?)'), V3 = db3.prepare('INSERT INTO visits (day, device, src, created) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 2300; i++) { const d = `dev-bulk-${String(i).padStart(5, '0')}`; R3.run(T - 3, d, 100, '1000000', '0000000', at(T - 3)); V3.run(T - 3, d, 'direct', at(T - 3)); }
  const st3 = async () => (await worker.fetch(new Request('https://karman.day/api/admin/stats?fresh=1', { headers: { authorization: `Bearer ${token}` } }), env3, ctx)).json();
  const c1 = await st3();
  check(c1.cost.backfilled > 0 && c1.cost.backfilled < 2300 && c1.backfill.pilots === 'running' && c1.cost.frozen.length === 0 && c1.cost.cohorts.length === 0, 'backfill is sliced by the row budget and freezing waits for it');
  check(c1.active === null && c1.yesterdayCohort === null && c1.acquisition.length === 0 && c1.days[T - 1].nv === undefined, 'while pilots are indexing, no pilots-based number is shown (rather than a wrong one)');
  let c3 = await st3(); for (let i = 0; i < 10 && c3.backfill.pilots !== 'done'; i++) c3 = await st3();
  check(c3.backfill.pilots === 'done' && db3.prepare('SELECT COUNT(*) c FROM pilots').get().c === 2300 && db3.prepare('SELECT SUM(flights) s FROM pilots').get().s === 2300, '...and completes, counting every device once');

  // the 10-minute edge copy, and Refresh throttled to one build a minute
  const store = new Map(), c0 = globalThis.caches;
  globalThis.caches = { default: { match: async (k) => (store.has(k.url) ? store.get(k.url).clone() : null), put: async (k, r) => { store.set(k.url, r); }, delete: async (k) => store.delete(k.url) } };
  const hdr = async (q) => (await call2(`/api/admin/stats${q}`, { headers: { authorization: `Bearer ${token}` } })).headers.get('x-dash-cache');
  const h1 = await hdr(''), h2 = await hdr(''), h3 = await hdr('?fresh=1');
  check(h1 === 'miss' && h2 === 'hit' && h3 === 'throttled', `cached for 10 minutes; Refresh within a minute is served the copy (${h1}/${h2}/${h3})`);
  globalThis.caches = c0;
  Date.now = realNow;
}

/* ------------------------------------------------------------------ the SQL day bucketing used by one-off backfills matches the Worker's */
{
  const { flightSql, etFlightHour } = await import('../api/src/dash.js');
  const dbx = new DatabaseSync(':memory:');
  const expr = flightSql('c', LAUNCH, Date.UTC(2027, 6, 1));
  let bad = 0;
  for (let ms = Date.UTC(2026, 9, 7); ms < Date.UTC(2027, 11, 31); ms += 3600e3 * 5 + 60e3 * 17) {
    const c = new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    if (dbx.prepare(`SELECT ${expr} AS n FROM (SELECT ? AS c)`).get(c).n !== etFlightHour(ms, LAUNCH).n) bad++;
  }
  check(bad === 0, `SQL flight-of-timestamp matches the Worker across DST (${bad} off)`);
}

/* ------------------------------------------------------------------ Eastern-time arithmetic matches Intl */
{
  const { etFlightHour } = await import('../api/src/dash.js');
  const H = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
  let bad = 0;
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2028, 0, 1); ms += 3600e3 * 7 + 60e3 * 13) {
    const x = etFlightHour(ms, LAUNCH);
    if (x.n !== flightAt(ms) || x.h !== Number(H.format(new Date(ms))) % 24) bad++;
  }
  check(bad === 0, `ET flight/hour arithmetic agrees with Intl across DST changes (${bad} off)`);
}

/* ------------------------------------------------------------------ client beacons: off with ?dev, once a day otherwise */
{
  const vm = await import('node:vm');
  const load = (search, hostname = 'karman.day') => {
    const posts = [], ls = new Map();
    const c = { console, Date, Math, JSON, Promise, Set, Map, URLSearchParams, setTimeout, location: { protocol: 'https:', hostname, search, pathname: '/', href: `https://${hostname}/`, origin: `https://${hostname}` },
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
      fetch: (url, init) => { posts.push([url, init && init.body]); return Promise.resolve({ ok: true, json: async () => ({}) }); },
      addEventListener() {}, document: { referrer: '' }, navigator: { onLine: true } };
    c.window = c; vm.createContext(c);
    vm.runInContext(fs.readFileSync(new URL('../web/js/config.js', import.meta.url), 'utf8'), c);
    vm.runInContext('K.storage = { data: { device: "dev-client-0001" } }; K.date = { flightNumber: () => 40 };', c);
    vm.runInContext(fs.readFileSync(new URL('../web/js/stats.js', import.meta.url), 'utf8'), c);
    return { K: c.K, posts };
  };
  const devS = load('?dev');
  devS.K.stats.event('share'); devS.K.stats.hit(); await devS.K.stats.submit({ mode: 'daily', n: 3, pts: 1, rounds: [] });
  check(devS.K.stats.live() === false && devS.posts.length === 0, 'with ?dev the game writes no stats, visits or events');
  const liveS = load('');
  liveS.K.stats.event('share'); liveS.K.stats.event('share'); liveS.K.stats.event('paywall_view');
  await new Promise((r) => setTimeout(r, 5));
  liveS.K.stats.event('share');
  const evPosts = liveS.posts.filter((p) => p[0].endsWith('/api/event'));
  const prev = load('', 'karman.someone.workers.dev');
  prev.K.stats.event('share'); prev.K.stats.hit();
  check(prev.K.stats.live() === false && prev.posts.length === 0, 'a workers.dev preview never writes to the production stats');
  check(liveS.K.stats.live() === true && evPosts.length === 2 && JSON.parse(evPosts[0][1]).kind === 'share', 'events go out once per kind per day');
  liveS.K.stats.hit(); liveS.K.stats.hit();
  await new Promise((r) => setTimeout(r, 5));
  liveS.K.stats.hit();
  check(liveS.posts.filter((p) => p[0].endsWith('/api/hit')).length === 1, 'the daily hit goes out once, however often it is called');
}

console.log(fails ? `${fails} failed` : 'Worker checks passed.');
process.exit(fails ? 1 : 0);
