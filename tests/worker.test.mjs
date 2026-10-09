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

// sessions + /api/me
db.exec("INSERT INTO users (sub, email, unlimited) VALUES ('g-42', 'a@b.c', 1)");
const enc = new TextEncoder();
const key = await crypto.subtle.importKey('raw', enc.encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('g-42')))].map((x) => x.toString(16).padStart(2, '0')).join('');
const me = await (await call('/api/me', { headers: { authorization: `Bearer g-42.${sig}` } })).json();
check(me.unlimited === true, '/api/me sees the purchase');
check((await call('/api/me', { headers: { authorization: 'Bearer g-42.forged' } })).status === 401, 'forged session rejected');
check((await call('/api/play', { method: 'POST', headers: { authorization: `Bearer g-42.${sig}` } })).status === 204, 'play logged');

// results validation (7 legs)
const res = (legs) => call('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n: 1, device: 'device-abc-123', pts: 60, legs, chips: '2222222'.slice(0, legs.length) }) });
check((await res('1101011')).status === 204, '7-leg result accepted');
check((await res('11010')).status === 422, '5-leg result rejected');

// stats ignore rows recorded before the flight's date (old launch-date test plays)
db.exec("INSERT INTO results (n, device, pts, legs, chips, created) VALUES (1, 'old-device-0001', 700, '1111111', '4444444', '2020-01-01 00:00:00')");
const s1 = await (await call('/api/stats/1')).json();
check(s1.players === 1 && s1.buckets.length === 1 && s1.buckets[0][0] === 60, 'stats count only current-era rows');

// numbered Unlimited runs: their own crowd, kept apart from daily flights
const runPost = (run, device, pts) => call('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run, device, pts, legs: '1111111', chips: '2222222' }) });
check((await runPost(3, 'device-run-0001', 80)).status === 204, 'run result accepted');
await runPost(3, 'device-run-0002', 40);
const r3 = await (await call('/api/stats/r3')).json();
check(r3.players === 2 && r3.run === true, 'run stats count only that run');
check((await (await call('/api/stats/r4')).json()).players === 0, 'other runs are separate');
check((await runPost(0, 'device-run-0003', 20)).status === 422, 'run 0 rejected');

console.log(fails ? `${fails} failed` : 'Worker checks passed.');
process.exit(fails ? 1 : 0);
