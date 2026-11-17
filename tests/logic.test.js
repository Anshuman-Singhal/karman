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
const ctx = { window: {}, console, Math, Date, Number, String, Map, Set, Array, Object, JSON, Intl, crypto: globalThis.crypto, Boolean, setTimeout, clearTimeout };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['config.js', 'prng.js', 'date.js', 'data/content.js', 'scoring.js', 'daily.js', 'units.js', 'storage.js', 'sync.js', 'firstclass.js', 'nudge.js']) {
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
{
  // If the weekly restock ever fails, the game never goes dark: reserve flights.
  const r1 = K.daily.get(last + 1), r1b = K.daily.get(last + 1), r2 = K.daily.get(last + 30);
  check(r1 && r1.reserve && r1.facts.length === 7 && r1.facts.every(Boolean), 'past the schedule: a reserve flight of 7 questions');
  check(r1.facts.map((f) => f.id).join() === r1b.facts.map((f) => f.id).join(), 'reserve flights are the same for every player');
  check(r2 && r2.facts.map((f) => f.id).join() !== r1.facts.map((f) => f.id).join(), 'each reserve day gets different questions');
  check(new Set(r1.facts.map((f) => f.id)).size === 7, 'no repeats within a reserve flight');
  check(!K.daily.get(3).reserve, 'scheduled flights are untouched');
}

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
const realStorage = K.storage;
K.storage = { data: { prefs: { units: 'imperial' } }, save() {} };
const vi = K.units.view(eiffel);
check(vi.unit === 'feet' && Math.round(vi.toDisp(330)) === 1083, 'metres → feet');
check(Math.abs(vi.toMetric(vi.toDisp(330)) - 330) < 1e-9, 'round trip feet ↔ metres');
const sun = K.FACTS.find((f) => f.unit === '°C');
check(Math.round(K.units.view(sun).toDisp(100)) === 212, '°C → °F');
check(!K.units.view(titanic).convertible, 'years have no unit toggle');
K.storage.data.prefs.units = 'metric';
check(K.units.view(eiffel).unit === 'meters', 'metric view');
// The unit a person would say, by size; the stored unit (and saved guesses) never change.
const rim = { id: 't-rim', unit: 'meters', answer: 0.457, scale: 'log', min: 0.01, max: 100 };
const vr = K.units.view(rim);
check(vr.unit === 'cm' && Math.abs(vr.toDisp(0.457) - 45.7) < 1e-9 && Math.abs(vr.toMetric(45.7) - 0.457) < 1e-12, 'small meters read as cm');
K.storage.data.prefs.units = 'imperial';
const vri = K.units.view(rim);
check(vri.unit === 'inches' && Math.round(vri.toDisp(0.457)) === 18 && Math.abs(vri.toMetric(18) - 0.4572) < 1e-12, 'small lengths read as inches, not feet');
check(K.units.view({ unit: 'kg', answer: 0.2, scale: 'log' }).unit === 'ounces', 'light things in ounces');
check(K.units.view({ unit: 'km', answer: 0.8, scale: 'log' }).unit === 'feet' && K.units.view({ unit: 'km', answer: 42.195, scale: 'log' }).unit === 'miles', 'short km in feet, long in miles');
check(K.units.hint('{0.4 m} across') === '16 in across', 'hint tokens sized too');
K.storage.data.prefs.units = 'metric';
check(K.units.hint('{0.4 m} across') === '40 cm across', 'metric hint tokens sized too');
// What you see is what's scored: an answer shown sitting on an edge counts.
// (A rim stored as 0.457 m reads "18 inches"; a guess whose range read "18 and 40.5" missed it.)
{
  const S = K.scoring;
  const rimOld = { ...rim, answer: 0.457 };
  const edge = 18 * 0.0254;                       // the player's range started at exactly 18 in
  check(S.isHit(rimOld, { lo: edge, hi: 40.5 * 0.0254 }), 'answer shown on the low edge is a hit');
  check(S.isHit(rimOld, { lo: 0.2, hi: 0.4568 }), 'answer shown on the high edge is a hit');
  check(!S.isHit(rimOld, { lo: 0.47, hi: 0.9 }), 'a clear miss still misses');
  const yr = { scale: 'year', answer: 1969 };
  check(S.isHit(yr, { lo: 1969, hi: 1975 }) && !S.isHit(yr, { lo: 1970, hi: 1975 }), 'years stay exact');
  const cnt = { int: true, answer: 9, scale: 'log' };
  check(S.isHit(cnt, { lo: 9, hi: 19 }) && !S.isHit(cnt, { lo: 10, hi: 19 }), 'counts stay exact');
}

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

/* ---- cloud save merge: nothing a pilot earned is ever lost ---- */
section('Cloud save merge');
{
  K.storage = realStorage;
  const M = K.storage.migrate;
  const flight = (n, pts, mode = 'daily') => ({ n, mode, pts, alt: S.kmOf(pts), maxAlt: S.kmOf(pts), done: true, at: 1e12 + n * 864e5, rounds: Array.from({ length: 7 }, (_, i) => ({ chip: 2, hit: i < pts / 50 })) });
  // Phone: flights 1–5 unsigned (a five-day streak), then buys on day 6 and signs in.
  const phone = M({ v: 1, launch: '2026-10-7' });
  [1, 2, 3, 4, 5].forEach((n) => { phone.days[n] = flight(n, 100 + n * 50); });
  phone.streak = { cur: 5, best: 5, lastDay: 5, thermals: 0 };
  phone.stats.flights = 5; phone.stampCounts = { clouds: 5 }; phone.stamps = { clouds: 1 };
  phone.runs = [{ ...flight(0, 300, 'unlimited'), run: 1, at: 2e12 }]; phone.freeRunUsed = true; phone.unlimitedCount = 1;
  // First sign-in: the cloud is empty → the merge keeps everything as is.
  const first = K.sync.merge(phone, null);
  check(Object.keys(first.days).length === 5 && first.streak.cur === 5, 'first sign-in with an empty cloud keeps all five days and the streak');
  // Laptop: restores on day 7, having flown day 6 there (unsigned) plus its own run.
  const laptop = M({ v: 1, launch: '2026-10-7' });
  laptop.days[6] = flight(6, 400);
  laptop.streak = { cur: 1, best: 1, lastDay: 6, thermals: 0 };
  laptop.runs = [{ ...flight(0, 200, 'unlimited'), run: 4, at: 3e12 }]; laptop.unlimitedCount = 1;
  const merged = K.sync.merge(laptop, K.sync.portable(phone));
  check([1, 2, 3, 4, 5, 6].every((n) => merged.days[n] && merged.days[n].done), 'restore on another device: days 1–6 all present');
  check(merged.streak.cur === 6 && merged.streak.best === 6 && merged.streak.lastDay === 6, `streak replays to 6 days (got ${merged.streak.cur}/${merged.streak.best})`);
  check(merged.runs.length === 2 && merged.unlimitedCount === 2, 'both Unlimited runs kept, Unlimited flight count 2');
  check(merged.freeRunUsed === true && merged.stats.flights === 8, `free run stays used; 8 flights in all (got ${merged.stats.flights})`);
  check(merged.stats.bestAlt === S.kmOf(400), 'best altitude is the best of both');
  check(merged.stampCounts.clouds >= 5 && merged.stamps.clouds === 1, 'stamps never go down');
  // Merging again changes nothing (idempotent), and order doesn't matter for flights.
  const again = K.sync.merge(merged, K.sync.portable(merged));
  check(JSON.stringify(K.sync.portable(again)) === JSON.stringify(K.sync.portable(merged)), 'merging the same copy twice changes nothing');
  const other = K.sync.merge(phone, K.sync.portable(laptop));
  check(JSON.stringify(Object.keys(other.days).sort()) === JSON.stringify(Object.keys(merged.days).sort()) && other.streak.cur === 6, 'either direction gives the same flights and streak');
  // This device keeps its own unlock and in-progress flight.
  laptop.access = { unlimited: true, via: 'stripe', session: 'x', checkedAt: 1 };
  laptop.live = { n: 7 };
  const kept = K.sync.merge(laptop, { ...K.sync.portable(phone), access: { unlimited: false }, live: null });
  check(kept.access.unlimited === true && kept.live && kept.live.n === 7, 'merge never touches this device\'s unlock or flight in progress');
  // A day flown on both devices keeps the finished, higher one.
  const a = M({ v: 1, launch: '2026-10-7' }); a.days[3] = flight(3, 150);
  const b = M({ v: 1, launch: '2026-10-7' }); b.days[3] = flight(3, 350);
  check(K.sync.merge(a, b).days[3].pts === 350, 'same day on two devices: the better flight is kept');
  // Guide v4: every pilot gets the guided first leg once more, nothing else touched.
  const old = M({ v: 1, launch: '2026-10-7', guideV: 3, tutored: true, streak: { cur: 4, best: 4, lastDay: 6, thermals: 1 } });
  check(old.tutored === false && old.guideV === 4 && old.streak.cur === 4, 'a guideV 3 save gets the new guide once; streak untouched');
  const done = M({ v: 1, launch: '2026-10-7', guideV: 4, tutored: true });
  check(done.tutored === true, 'a save that has seen guide v4 is not guided again');
}

/* ---- per-leg climbs always add up to the total shown ---- */
section('Legs add up');
{
  check([0, 1, 2, 3, 4].map((c) => S.kmOf(S.legPointsFor(c, true))).join() === '1,3,5,8,10', 'a clue halves the climb in whole km: 1, 3, 5, 8, 10');
  check([0, 1, 2, 3, 4].every((c) => S.legPointsFor(c, false) === S.legPoints(c)), 'unclued legs unchanged');
  const store = realStorage;
  K.storage = { data: { prefs: {} }, save() {} };
  const rand = K.rng.fromLabel('legs-add-up');
  let bad = 0;
  for (const sys of ['metric', 'imperial']) {
    K.storage.data.prefs.units = sys;
    for (let t = 0; t < 500; t++) {
      let pts = 0;
      const clueLeg = Math.floor(rand() * 8);            // 7 = no clue this flight
      const rounds = Array.from({ length: 7 }, (_, i) => {
        const chip = Math.floor(rand() * 5), hit = rand() < 0.6;
        const delta = hit ? S.legPointsFor(chip, i === clueLeg) : 0;
        pts += delta;
        return { chip, hit, delta, ptsAfter: pts };
      });
      const sum = rounds.reduce((a, r, i) => a + (r.delta > 0 ? parseFloat(K.units.legText(...S.legSpan(rounds, i)).slice(1)) : 0), 0);
      const shown = parseFloat(K.units.altText(S.kmOf(pts)));
      if (Math.abs(sum - shown) > 1e-9) bad++;
      if (sys === 'metric' && !Number.isInteger(S.kmOf(pts))) bad++;
    }
  }
  check(bad === 0, `1,000 random flights: the legs add up to the total shown, in km and in miles (${bad} mismatches)`);
  K.storage.data.prefs.units = 'metric';
  check(K.units.climbText(100 - 57.6) === '+42.4 km', 'no float noise in climb text');
  K.storage = store;
}

/* ---- first class: livery, new runs, any run, run log ---- */
section('First class');
{
  const F = K.fc;
  check(F.liveryOf({ livery: 'midnight' }, true) === 'midnight', 'a first-class pilot flies the livery they picked');
  check(F.liveryOf({ livery: 'midnight' }, false) === 'vermilion', 'without Unlimited (or after a revoke) the craft flies Vermilion');
  check(F.liveryOf({}, true) === 'vermilion' && F.liveryOf({ livery: 'chrome' }, true) === 'vermilion' && F.liveryOf(null, true) === 'vermilion', 'no pick or an unknown one: Vermilion');
  check(F.LIVERIES.map((l) => l.id).join() === 'vermilion,midnight,airmail,gold', 'four liveries, house colours first');
  check(F.freshRuns(43, 40, [1, 3, 42]).join() === '41,43', 'fresh runs: landed since last look, not yet flown, lowest first');
  check(F.freshRuns(43, 43, []).length === 0 && F.freshRuns(43, null, []).length === 0 && F.freshRuns(40, 43, []).length === 0, 'nothing fresh when all seen, never set, or the schedule shrank');
  check(F.parseRun('12', 40) === 12 && F.parseRun(' #7 ', 40) === 7 && F.parseRun('Run 40', 40) === 40, 'run numbers parse from "12", "#7", "Run 40"');
  check(F.parseRun('0', 40) === null && F.parseRun('41', 40) === null && F.parseRun('', 40) === null && F.parseRun('abc', 40) === null, 'run 0, past the last run, or no number: refused');
  const rec = (run, alt, hits, at) => ({ mode: 'unlimited', run, alt, pts: Math.round(alt * 10), at, done: true, rounds: Array.from({ length: 7 }, (_, i) => ({ chip: 2, hit: i < hits })) });
  const st = F.runLogStats([rec(7, 63.8, 6, 3), rec(3, 41.2, 7, 1), rec(18, 87.1, 7, 5), rec(7, 50, 5, 9)], [1, 3, 7, 18, 99], 40);
  check(st.n === 4 && st.list.map((r) => r.run).join() === '3,7,18,7', 'run log: every saved run, in the order flown');
  check(F.runLogStats([rec('<b>', 50, 7, 1), rec(2.5, 50, 7, 2), rec(4, 30, 7, 3)], [], 40).list.map((r) => r.run).join() === '4', 'run log ignores records whose run is not a whole number');
  check(st.flown === 4 && st.best.run === 18 && st.perfect === 2, `run log: 4 distinct runs flown (out-of-range ignored), best Run 18, 2 perfect (got ${st.flown}/${st.best.run}/${st.perfect})`);
  check(Math.abs(st.avg - (63.8 + 41.2 + 87.1 + 50) / 4) < 1e-9, 'run log: average altitude');
  const none = F.runLogStats([], [1], 40);
  check(none.n === 0 && none.flown === 1 && !none.best, 'run log with no saved runs: a count, no best');
  // Boarding from the hangar never silently drops a run in progress.
  const wip = { run: 5, round: 2, factIds: ['a'] };
  check(F.boardAction(12, null, null) === 'fly' && F.boardAction(null, null, null) === 'fly', 'nothing in progress: any run (or a new one) just flies');
  check(F.boardAction(null, wip, null) === 'resume' && F.boardAction(5, wip, null) === 'resume', 'a run in progress: "Fly a new run" or its own number resumes it');
  check(F.boardAction(12, wip, null) === 'confirm' && F.boardAction(12, wip, 9) === 'confirm', 'another run while one is in progress: ask first');
  check(F.boardAction(12, wip, 12) === 'fly', 'asked again for the same run: leave the old one and fly it');
  const M = realStorage.migrate;
  check(!('runsSeen' in K.sync.portable({ ...M({ v: 1, launch: '2026-10-7' }), runsSeen: 40 })), 'runsSeen stays on this device (never uploaded)');
  const old = M({ v: 1, launch: '2026-10-7', runsDone: [1, 2], prefs: { units: 'metric' } });
  check(old.runsSeen === null && old.prefs.units === 'metric' && !old.prefs.livery, 'an old save loads with runsSeen unset and its prefs untouched');
  const kept = M({ v: 1, launch: '2026-10-7', runsSeen: 37, prefs: { livery: 'gold' } });
  check(kept.runsSeen === 37 && kept.prefs.livery === 'gold', 'runsSeen and the livery survive a reload');
}

/* ---- share nudge ("Posted", nudge.js) ---- */
section('Share nudge');
{
  const N = K.nudge;
  const daily = (n, extra) => ({ n, mode: 'daily', isFresh: true, ...extra });
  // when the full sequence may play
  check(N.plan(undefined, daily(10)) === true && N.plan({}, daily(10)) === true, 'a first daily finish with no history plays the stamp');
  check(N.plan({}, daily(10, { isFresh: false })) === false, 're-opening the results: no motion');
  check(N.plan({}, daily(10, { mode: 'archive' })) === false, 'archive flights: no motion');
  check(N.plan({}, daily(10, { mode: 'unlimited' })) === false, 'Unlimited runs: no motion');
  check(N.plan({ seen: 10, miss: 1 }, daily(10)) === false, 'at most once a day (a second finish of the same flight)');
  check(N.plan({ shared: 10 }, daily(10)) === false, 'shared today: skipped');
  check(N.plan({ shared: 9 }, daily(10)) === false, 'shared yesterday: skipped');
  check(N.plan({ shared: 8 }, daily(10)) === true, 'last shared two days ago: it plays again');
  // back-off for pilots who never share: day 1, then 2 days later, then 4, then weekly
  let nd, played = [];
  for (let day = 1; day <= 30; day++) if (N.plan(nd, daily(day))) { played.push(day); nd = N.afterSeen(nd, day); }
  check(played.join() === '1,3,7,14,21,28', `ignored every time, it backs off 1 · 2 · 4 · 7 days, then weekly (played ${played.join()})`);
  check(nd.miss === 6 && nd.seen === 28, 'each full nudge counts one unanswered');
  check(N.GAPS.join() === '1,2,4,7', 'the back-off steps are 1, 2, 4, 7 days');
  // one share resets the back-off
  nd = N.afterShare({ seen: 28, miss: 6 }, 29);
  check(nd.miss === 0 && nd.shared === 29 && nd.seen === 28, 'a share remembers the day and resets the count');
  check(N.plan(nd, daily(30)) === false && N.plan(nd, daily(31)) === true, 'after a share: skipped the next day, back to daily the day after');
  check(N.plan(N.afterSeen(nd, 31), daily(32)) === false && N.plan(N.afterSeen(nd, 31), daily(33)) === true, '...and one unanswered nudge waits 2 days again');
  check(N.plan({ seen: 'x', miss: -3, shared: null }, daily(5)) === true, 'a malformed record never blocks or crashes');
  for (const bad of ['garbage', 42, null, [1, 2], true]) {
    const seen = N.afterSeen(bad, 7), sh = N.afterShare(bad, 7);
    check(seen.seen === 7 && seen.miss === 1 && !Array.isArray(seen) && !('0' in seen) && sh.shared === 7 && sh.miss === 0 && !('0' in sh), `a stored ${JSON.stringify(bad)} is treated as no record`);
  }
  // storage: this device only, and old saves are untouched
  const M = realStorage.migrate;
  const save = { ...M({ v: 1, launch: '2026-10-7' }), nudge: { seen: 12, miss: 1, shared: 11 } };
  check(!('nudge' in K.sync.portable(save)), 'the nudge record is never uploaded (LOCAL_ONLY)');
  check(K.sync.merge(save, { ...K.sync.portable(save), nudge: { seen: 99 } }).nudge.seen === 12, 'a cloud copy never overwrites it');
  check(!('nudge' in M({ v: 1, launch: '2026-10-7' })), 'an existing save loads without a nudge key (nothing added)');
  check(M({ v: 1, launch: '2026-10-7', nudge: { seen: 3, miss: 2 } }).nudge.miss === 2, 'and keeps one once it has it');
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
