/* ==========================================================================
   KÁRMÁN · tests/logic.test.js
   Run with:  node tests/logic.test.js
   Loads the pure game-logic files (no DOM) and checks the promises the game
   makes: every flight is complete, no fact is ever scheduled twice, every
   answer sits inside its slider, and scoring behaves as documented.
   Exit code 1 on any failure, so CI can block a bad deploy.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const web = path.join(__dirname, '..', 'web', 'js');
const ctx = { window: {}, console, Math, Date, Number, String, Map, Set, Array, Object, JSON, Intl };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['config.js', 'prng.js', 'date.js', 'data/content.js', 'scoring.js', 'daily.js', 'units.js']) {
  vm.runInContext(fs.readFileSync(path.join(web, f), 'utf8'), ctx, { filename: f });
}
const K = ctx.K;
const S = K.scoring;

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  ✗ ${msg}`); } };
const section = (name) => console.log(`\n${name}`);

/* ---- fact bank ---- */
section('Fact bank');
const ids = new Set();
for (const f of K.FACTS) {
  check(!ids.has(f.id), `duplicate id ${f.id}`);
  ids.add(f.id);
  check(f.answer > f.min && f.answer < f.max, `${f.id}: answer ${f.answer} outside slider ${f.min}–${f.max}`);
  const t = S.tAt(f, f.answer);
  check(t > 0.05 && t < 0.95, `${f.id}: answer too close to the slider edge (t=${t.toFixed(2)})`);
  check(['log', 'year'].includes(f.scale), `${f.id}: unknown scale ${f.scale}`);
  check(f.q && f.card && f.cat, `${f.id}: missing text`);
}
console.log(`  ${K.FACTS.length} facts checked`);

/* ---- schedule ---- */
section('Schedule (no repeats)');
const last = K.daily.lastFlightNumber();
const seen = new Map();
for (let n = 1; n <= last; n++) {
  const fl = K.daily.get(n);
  check(fl && fl.facts.length === K.CONFIG.LEGS, `flight ${n} does not have ${K.CONFIG.LEGS} facts`);
  const cats = new Set(fl.facts.map((f) => f.cat));
  check(cats.size >= 3, `flight ${n} has only ${cats.size} categories`);
  fl.facts.forEach((f) => {
    check(!seen.has(f.id), `fact ${f.id} repeats (flights ${seen.get(f.id)} and ${n})`);
    seen.set(f.id, n);
  });
}
check(K.daily.get(0) === null, 'flight 0 should not exist');
const pool = K.daily.unlimitedPool(3);
check(pool.length >= 70 && !pool.some((f) => K.daily.get(3).facts.includes(f) || K.daily.get(4).facts.includes(f)), 'Unlimited pool excludes today and future dailies');
check(K.daily.get(last + 1) === null, 'flight after the bank runs out should not exist');

console.log(`  ${last} flights, ${seen.size} daily facts, ${K.FACTS.length - seen.size} in the Unlimited bank`);

/* ---- scoring ---- */
section('Scoring');
const eiffel = K.FACTS.find((f) => f.id === 's1-st-01'); // 330 m
check(S.isHit(eiffel, S.range(eiffel, 300, 2)), 'Snug around 300 should contain 330');
check(!S.isHit(eiffel, S.range(eiffel, 250, 4)), 'Pinpoint at 250 should miss 330');
check(S.isHit(eiffel, S.range(eiffel, 320, 4)), 'Pinpoint at 320 should hit 330');
const titanic = K.FACTS.find((f) => f.id === 's1-hi-01'); // 1912
check(S.isHit(titanic, S.range(titanic, 1910, 4)), 'Pinpoint ±2 at 1910 should hit 1912');
check(!S.isHit(titanic, S.range(titanic, 1909, 4)), 'Pinpoint ±2 at 1909 should miss 1912');
// Rules v2 (the default): Wide 100× · Fair 3× · Snug 1.5× · Tight 15% · Pinpoint 4%
check(!S.isHit(eiffel, S.range(eiffel, 315, 4)), 'v2 Pinpoint (4%) at 315 should miss 330');
check(S.isHit(eiffel, S.range(eiffel, 290, 3)) && !S.isHit(eiffel, S.range(eiffel, 280, 3)), 'v2 Tight (15%): 290 hits, 280 misses 330');
check(S.isHit(eiffel, S.range(eiffel, 230, 2)) && !S.isHit(eiffel, S.range(eiffel, 210, 2)), 'v2 Snug (1.5×): 230 hits, 210 misses');
check(S.isHit(eiffel, S.range(eiffel, 120, 1)) && !S.isHit(eiffel, S.range(eiffel, 100, 1)), 'v2 Fair (3×): 120 hits, 100 misses');
check(S.isHit(eiffel, S.range(eiffel, 4, 0)) && !S.isHit(eiffel, S.range(eiffel, 3, 0)), 'v2 Wide (100×): 4 hits, 3 misses');
const moons = K.FACTS.find((f) => f.int && f.answer === 2 && /Mars/.test(f.q));
const span = (g, c) => { const r = S.range(moons, g, c); return `${r.lo}-${r.hi}`; };
check(span(2, 4) === '2-2' && span(2, 3) === '1-3' && span(2, 2) === '0-4' && span(2, 1) === '0-6', `counts: minimum steps keep widths distinct (got ${span(2, 4)}, ${span(2, 3)}, ${span(2, 2)}, ${span(2, 1)})`);
// every width strictly contains the next narrower one, for every number question
const nested = K.FACTS.filter((f) => f.scale !== 'year').every((f) => [0.5, 1, 2].every((m) => {
  const g = S.roundGuess(f, f.answer * m);
  const rs = [0, 1, 2, 3, 4].map((c) => S.range(f, g, c));
  return rs.every((r, i) => i === 0 || (r.lo >= rs[i - 1].lo && r.hi <= rs[i - 1].hi));
}));
check(nested, 'v2: each width sits inside the one wider than it');
check(S.rulesFor('daily', 3) === 1 && S.rulesFor('archive', 2) === 1 && S.rulesFor('daily', 4) === 2 && S.rulesFor('unlimited', 1) === 2, 'rules v1 for flights #1-3 only');
S.useRules(1);
check(S.isHit(eiffel, S.range(eiffel, 320, 4)) && S.isHit(eiffel, S.range(eiffel, 310, 4)) === S.isHit(eiffel, { lo: 310 / Math.sqrt(1.15), hi: 310 * Math.sqrt(1.15) }), 'v1 ranges unchanged for old flights');
S.useRules(2);
check([0, 1, 2, 3, 4].map(S.legKm).join() === '2,5,10,15,20', 'leg climb: Wide 2 km … Pinpoint 20 km');
check([0, 1, 2, 3, 4].map(S.legPoints).join() === '10,25,50,75,100', 'stored points = km × 5');
check(S.MAX_PTS === K.CONFIG.LEGS * 100, 'max points = legs × Pinpoint');
check(S.kmOf(S.MAX_PTS) === S.MAX_KM && S.MAX_KM === 140, 'a perfect flight is 140 km');
check(S.kmOf(500) === K.CONFIG.KARMAN_KM, 'five Pinpoints reach the Kármán line');
check(S.ptsOf(S.kmOf(55)) === 55 && S.kmOf(5) === 1, '5 points per km, and back');
check(S.roundGuess(eiffel, 333.333) === 333 && S.roundGuess(titanic, 1911.6) === 1912, 'guess rounding');
console.log(`  perfect flight = ${S.MAX_PTS} pts (${S.kmOf(S.MAX_PTS)} km); ${S.METRES_PER_POINT} m per point`);

/* ---- units ---- */
section('Units');
ctx.navigator = { language: 'en-GB' };
K.storage = { data: { prefs: { units: 'imperial' } }, save() {} };
const vi = K.units.view(eiffel);
check(vi.unit === 'feet' && Math.round(vi.toDisp(330)) === 1083, 'metres → feet');
check(Math.abs(vi.toMetric(vi.toDisp(330)) - 330) < 1e-9, 'round trip feet ↔ metres');
const sun = K.FACTS.find((f) => f.unit === '°C');
check(Math.round(K.units.view(sun).toDisp(100)) === 212, '°C → °F');
check(!K.units.view(titanic).convertible, 'years have no unit toggle');
K.storage.data.prefs.units = 'metric';
check(K.units.view(eiffel).unit === 'meters', 'metric view');

/* ---- misses described in words ---- */
check(S.offBy(titanic, 1865, false) === '47 years too early', `offBy years: ${S.offBy(titanic, 1865, false)}`);
check(S.offBy(eiffel, 100, false) === 'guess 3.3× too low', `offBy ratio: ${S.offBy(eiffel, 100, false)}`);
check(S.offBy(eiffel, 330, true) === '', 'offBy is empty on a hit');

/* ---- clue windows ---- */
section('Clues and hints');
for (const f of K.FACTS) {
  const w = S.clueWindow(f);
  check(f.answer >= w.lo && f.answer <= w.hi, `${f.id}: clue window ${w.lo}–${w.hi} misses the answer ${f.answer}`);
  check(K.HINTS[f.id] && !K.HINTS[f.id].includes(String(f.answer)), `${f.id}: hint missing or contains the answer`);
}

/* ---- stamp tiers ---- */
section('Stamp tiers');
check(S.tierIndex(0) === 0 && S.tierIndex(1) === 1 && S.tierIndex(4) === 1 && S.tierIndex(5) === 2 && S.tierIndex(10) === 3 && S.tierIndex(20) === 4 && S.tierIndex(30) === 5, 'tier thresholds 1 / 5 / 10 / 20 / 30');
check(S.nextTier(7).name === 'Silver' && S.nextTier(25).name === 'Moon rock' && S.nextTier(30) === null, 'next tier lookup');

/* ---- dates ---- */
section('Dates');
const L = K.CONFIG.LAUNCH;
// Flights change at midnight EASTERN (EDT = UTC−4 in October, EST = UTC−5 in November).
check(K.date.flightNumber(new Date(Date.UTC(L.y, L.m - 1, L.d, 4, 5))) === 1, 'launch day 00:05 Eastern is flight #1');
check(K.date.flightNumber(new Date(Date.UTC(L.y, L.m - 1, L.d + 1, 3, 59))) === 1, 'launch day 23:59 Eastern is still flight #1');
check(K.date.flightNumber(new Date(Date.UTC(L.y, L.m - 1, L.d + 1, 4, 1))) === 2, '00:01 Eastern next day is flight #2');
check(K.date.flightNumber(new Date(Date.UTC(L.y, L.m - 1, L.d + 40, 17))) === 41, 'forty days later (after DST ends) is flight #41');
const ms = K.date.msToNextFlight(new Date(Date.UTC(L.y, L.m - 1, L.d, 22, 0)));
check(ms === 6 * 3600e3, `18:00 Eastern is 6 h from the next flight (got ${ms / 3600e3} h)`);
const dst = K.date.msToNextFlight(new Date(Date.UTC(2026, 10, 1, 4, 30)));   // 00:30 EDT on the day clocks fall back
check(dst === 24.5 * 3600e3, `DST day is 25 h long (got ${dst / 3600e3} h)`);

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
