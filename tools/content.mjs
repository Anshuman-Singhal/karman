#!/usr/bin/env node
/* ==========================================================================
   KÁRMÁN · tools/content.mjs — the question factory's front door.

   The two files in content/ are the single source of truth:
     content/questions.json   every question ever written (append-only)
     content/schedule.json    flight number → 7 question ids (append-only)

   Commands (Node 18+, no dependencies):
     node tools/content.mjs check            validate everything, exit 1 on any error
     node tools/content.mjs build            check, then write web/js/data/content.js
     node tools/content.mjs add batch.json   validate a new batch, schedule 49 of
                                             every 70 into the next 7 days, put the
                                             rest in the Unlimited bank, then build
     node tools/content.mjs add batch.json --bank   all of it straight into the Unlimited bank
     node tools/content.mjs status           how many days are scheduled ahead

   The promises it enforces:
     • an id is never reused and a question is never scheduled twice
     • nothing already played is ever changed (schedule only grows)
     • every question has a source, a scale hint that doesn't give the answer
       away, a fun fact, and an answer that sits comfortably inside its scale
     • no new question duplicates or closely paraphrases an existing one
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QFILE = path.join(ROOT, 'content', 'questions.json');
const SFILE = path.join(ROOT, 'content', 'schedule.json');
const OUT = path.join(ROOT, 'web', 'js', 'data', 'content.js');

const CATEGORIES = ['Structures', 'Sky & Space', 'Living Things', 'History', 'Machines', 'Everyday Numbers', 'Sports', 'Film & TV', 'Music', 'Pop Culture'];
const HINT_UNITS = ['m', 'km', '°C', 'm/s', 'km/s', 'km/h', 'kg'];
const MAX_PER_CAT = 2, MAX_YEARS = 3;
const STOP = new Set('a an the of in on at to is was were did does do how what which many much long tall big far high deep old roughly about approximately first ever one its it for by from and with as are be has have that this there'.split(' '));

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');

/* ---------------------------------------------------------- helpers */
const tAt = (q) => (q.scale === 'year' ? (q.answer - q.min) / (q.max - q.min) : Math.log(q.answer / q.min) / Math.log(q.max / q.min));
const words = (s) => new Set(String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}
/** Ways the answer might appear in a hint, e.g. 8849, 8,849, 8.85. */
function answerForms(x) {
  const forms = new Set([String(x), x.toLocaleString('en-US')]);
  if (Math.abs(x) >= 1000) forms.add(Number(x.toPrecision(3)).toLocaleString('en-US'));
  return [...forms].filter((f) => f.replace(/\D/g, '').length >= 2);
}

/* ---------------------------------------------------------- validation */
function validateQuestion(q, { requireSource }) {
  const e = [];
  const need = ['id', 'cat', 'q', 'unit', 'answer', 'scale', 'min', 'max', 'hint', 'card', 'clue'];
  need.forEach((k) => { if (q[k] === undefined || q[k] === null) e.push(`missing ${k}`); });
  if (e.length) return e;
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(q.id)) e.push('id must look like "b1-001"');
  if (!CATEGORIES.includes(q.cat)) e.push(`category "${q.cat}" not one of: ${CATEGORIES.join(', ')}`);
  if (!/\?$/.test(q.q) || q.q.length > 120) e.push('question must end with "?" and be ≤ 120 characters');
  if (!['log', 'year'].includes(q.scale)) e.push('scale must be "log" or "year"');
  if (typeof q.answer !== 'number' || !isFinite(q.answer)) e.push('answer must be a number');
  if (q.scale === 'year' && (!Number.isInteger(q.answer) || q.answer < 1)) e.push('year answers must be whole years AD (no BC: players can\'t type a minus)');
  if (q.scale === 'year' && q.unit !== '') e.push('year questions take unit ""');
  if (q.scale === 'log' && !(q.answer > 0 && q.min > 0)) e.push('log answers and min must be > 0');
  if (q.int && !Number.isInteger(q.answer)) e.push('int questions need a whole-number answer');
  if (!(q.min < q.answer && q.answer < q.max)) e.push(`answer ${q.answer} must sit inside min ${q.min} … max ${q.max}`);
  else { const t = tAt(q); if (t < 0.08 || t > 0.92) e.push(`answer too close to the edge of its scale (t=${t.toFixed(2)})`); }
  if (q.hint.length > 130) e.push('hint must be ≤ 130 characters');
  const tokens = [...q.hint.matchAll(/\{([\d.,]+)\s*([^}]+)\}/g)];
  tokens.forEach((m) => { if (!HINT_UNITS.includes(m[2].trim())) e.push(`hint token unit "${m[2]}" not one of ${HINT_UNITS.join(' ')}`); });
  const plain = q.hint.replace(/[{}]/g, '');
  answerForms(q.answer).forEach((f) => { if (new RegExp(`(^|[^\\d.,])${f.replace(/[.,]/g, '\\$&')}([^\\d]|$)`).test(plain)) e.push(`hint gives the answer away ("${f}")`); });
  if (q.card.length > 170) e.push('card (fun fact) must be ≤ 170 characters');
  // The clue: a second, closer benchmark. Same leak and unit rules as the hint.
  if (q.clue.length > 110) e.push('clue must be ≤ 110 characters');
  if (/^(for scale|clue)/i.test(q.clue)) e.push('clue must not start with "For scale" or "Clue"');
  [...q.clue.matchAll(/\{([\d.,]+)\s*([^}]+)\}/g)].forEach((m) => { if (!HINT_UNITS.includes(m[2].trim())) e.push(`clue token unit "${m[2]}" not one of ${HINT_UNITS.join(' ')}`); });
  const plainClue = q.clue.replace(/[{}]/g, '');
  answerForms(q.answer).forEach((f) => { if (new RegExp(`(^|[^\\d.,])${f.replace(/[.,]/g, '\\$&')}([^\\d]|$)`).test(plainClue)) e.push(`clue gives the answer away ("${f}")`); });
  // American English only (players noticed "storey").
  const brit = /\b(storeys?|colours?|centre|kilometres?|aluminium|litres?|grey|metres?|travelled|favourite|programme|theatre)\b/i;
  ['q', 'hint', 'card', 'clue'].forEach((k) => { const m = String(q[k]).match(brit); if (m) e.push(`${k}: use American spelling ("${m[0]}")`); });
  if (q.unit === 'metres') e.push('unit: use "meters"');
  if (requireSource && !/^https?:\/\/\S+$/.test(q.source || '')) e.push('source must be a URL');
  return e;
}

function validateAll(questions, schedule, { newIds = new Set() } = {}) {
  const errors = [], warnings = [];
  const byId = new Map();
  questions.forEach((q) => {
    if (byId.has(q.id)) errors.push(`${q.id}: duplicate id`);
    byId.set(q.id, q);
    const requireSource = newIds.has(q.id) || q.added > '2026-10-04';
    validateQuestion(q, { requireSource }).forEach((m) => errors.push(`${q.id}: ${m}`));
  });
  // Near-duplicate questions (new ones are compared against everything).
  const list = [...byId.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!newIds.size || newIds.has(a.id) || newIds.has(b.id)) {
        const s = similarity(a.q, b.q);
        if (s >= 0.7) errors.push(`${a.id} ≈ ${b.id}: questions too similar (${s.toFixed(2)})`);
        else if (a.answer === b.answer && a.unit === b.unit && s >= 0.4) warnings.push(`${a.id} / ${b.id}: same answer and similar wording`);
      }
    }
  }
  // Schedule
  const seen = new Map();
  const nums = Object.keys(schedule.flights).map(Number).sort((x, y) => x - y);
  nums.forEach((n, i) => {
    if (n !== i + 1) errors.push(`schedule: flight numbers must run 1, 2, 3… (found ${n} at position ${i + 1})`);
    const ids = schedule.flights[n];
    if (ids.length !== schedule.legs) errors.push(`flight ${n}: has ${ids.length} questions, needs ${schedule.legs}`);
    const cats = {};
    let years = 0;
    ids.forEach((id) => {
      const q = byId.get(id);
      if (!q) return errors.push(`flight ${n}: unknown id ${id}`);
      if (seen.has(id)) errors.push(`flight ${n}: ${id} already used in flight ${seen.get(id)}`);
      seen.set(id, n);
      if (q.pool !== 'daily') errors.push(`flight ${n}: ${id} is scheduled but pool is "${q.pool}"`);
      cats[q.cat] = (cats[q.cat] || 0) + 1;
      if (q.scale === 'year') years++;
    });
    Object.entries(cats).forEach(([c, k]) => { if (k > MAX_PER_CAT) warnings.push(`flight ${n}: ${k} × ${c}`); });
    if (years > MAX_YEARS) warnings.push(`flight ${n}: ${years} year questions`);
  });
  questions.forEach((q) => { if (q.pool === 'daily' && !seen.has(q.id)) errors.push(`${q.id}: pool "daily" but not scheduled`); });
  // Unlimited runs: fixed, numbered sets of bank questions (append-only). Run 1 is the free run.
  if (schedule.runs) {
    const used = new Map();
    schedule.runs.forEach((ids, i) => {
      if (ids.length !== schedule.legs) errors.push(`run ${i + 1}: has ${ids.length} questions, needs ${schedule.legs}`);
      ids.forEach((id) => {
        const q = byId.get(id);
        if (!q) errors.push(`run ${i + 1}: unknown id ${id}`);
        else if (q.pool === 'daily') errors.push(`run ${i + 1}: ${id} is a daily question`);
        if (used.has(id)) errors.push(`run ${i + 1}: ${id} already in run ${used.get(id)}`);
        used.set(id, i + 1);
      });
    });
    if (schedule.freeRun && schedule.runs[0] && schedule.runs[0].join() !== schedule.freeRun.join()) errors.push('runs: run 1 must be the freeRun');
  }
  // The one free Unlimited run: fixed, bank-only questions, never changes.
  if (schedule.freeRun) {
    if (schedule.freeRun.length !== schedule.legs) errors.push(`freeRun: needs ${schedule.legs} questions`);
    schedule.freeRun.forEach((id) => {
      const q = byId.get(id);
      if (!q) errors.push(`freeRun: unknown id ${id}`);
      else if (q.pool === 'daily') errors.push(`freeRun: ${id} is a daily question`);
    });
  }
  return { errors, warnings, byId };
}

/* ---------------------------------------------------------- build */
function build(questions, schedule) {
  const facts = questions.map(({ hint, clue, source, added, retired, ...f }) => f);
  const hints = Object.fromEntries(questions.map((q) => [q.id, q.hint]));
  const clues = Object.fromEntries(questions.map((q) => [q.id, q.clue]));
  const js = `/* GENERATED by tools/content.mjs — do not edit by hand. Edit content/*.json and run
   node tools/content.mjs build. ${questions.length} questions, ${Object.keys(schedule.flights).length} daily flights. */
K.FACTS = ${JSON.stringify(facts)};
K.HINTS = ${JSON.stringify(hints)};
K.CLUES = ${JSON.stringify(clues)};
K.SCHEDULE = ${JSON.stringify(schedule)};
`;
  fs.writeFileSync(OUT, js);
}

/* ---------------------------------------------------------- add a batch */
function flightNumberToday(launch) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date()).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const [y, m, d] = launch.split('-').map(Number);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(y, m - 1, d)) / 864e5) + 1;
}

/** Pick `count` flights of `legs` from the batch, keeping categories mixed. */
function planFlights(batch, count, legs) {
  const pool = [...batch].sort(() => Math.random() - 0.5);
  const flights = [];
  for (let f = 0; f < count; f++) {
    const pick = [], cats = {};
    let years = 0;
    for (const strict of [true, false]) {
      for (const q of pool) {
        if (pick.length === legs) break;
        if (pick.includes(q)) continue;
        if (strict && ((cats[q.cat] || 0) >= MAX_PER_CAT || (q.scale === 'year' && years >= MAX_YEARS))) continue;
        pick.push(q); cats[q.cat] = (cats[q.cat] || 0) + 1; if (q.scale === 'year') years++;
      }
    }
    if (pick.length < legs) break;
    pick.forEach((q) => pool.splice(pool.indexOf(q), 1));
    flights.push(pick);
  }
  return { flights, rest: pool };
}

/** Group bank questions not yet in a run into new numbered runs (append-only). */
function appendRuns(questions, schedule) {
  const runs = schedule.runs ? schedule.runs.map((r) => r.slice()) : [schedule.freeRun.slice()];
  const taken = new Set(runs.flat());
  const free = questions.filter((q) => q.pool === 'bank' && !taken.has(q.id));
  const { flights } = planFlights(free, Math.floor(free.length / schedule.legs), schedule.legs);
  flights.forEach((f) => runs.push(f.map((q) => q.id)));
  return { runs, added: flights.length };
}

function add(file, bankOnly) {
  const questions = read(QFILE), schedule = read(SFILE);
  const batch = read(path.resolve(file));
  if (!Array.isArray(batch) || !batch.length) throw new Error('batch must be a non-empty JSON array');
  const stamp = new Date().toISOString().slice(0, 10);
  const prefix = `w${stamp.replace(/-/g, '')}`;
  let k = 0;
  batch.forEach((q) => {
    if (!q.id) { do { k++; q.id = `${prefix}-${String(k).padStart(3, '0')}`; } while (questions.some((x) => x.id === q.id)); }
    q.added = q.added || stamp;
  });
  const days = bankOnly ? 0 : Math.min(7, Math.floor((batch.length * 0.7) / schedule.legs));   // 70 → 7 days (49), 21 to the bank
  const { flights, rest } = planFlights(batch, days, schedule.legs);
  flights.flat().forEach((q) => { q.pool = 'daily'; });
  rest.forEach((q) => { q.pool = 'bank'; });
  const nextQs = questions.concat(batch);
  const next = { ...schedule, flights: { ...schedule.flights } };
  // After the last scheduled flight, but never on a day that has already
  // started: if the game ran on reserve flights for a while, new ones begin tomorrow.
  let n = Math.max(0, flightNumberToday(schedule.launch), ...Object.keys(schedule.flights).map(Number));
  flights.forEach((f) => { next.flights[++n] = f.map((q) => q.id); });
  const r = appendRuns(nextQs, next);
  next.runs = r.runs;
  const { errors, warnings } = validateAll(nextQs, next, { newIds: new Set(batch.map((q) => q.id)) });
  warnings.forEach((w) => console.log('  ! ' + w));
  if (errors.length) {
    errors.forEach((x) => console.log('  ✗ ' + x));
    console.log(`\nBatch rejected: ${errors.length} problem(s). Nothing was written.`);
    process.exit(1);
  }
  write(QFILE, nextQs);
  write(SFILE, next);
  build(nextQs, next);
  console.log(`Added ${batch.length}: ${flights.length} daily flight(s)${flights.length ? ` (#${n - flights.length + 1}–#${n})` : ''} and ${rest.length} to the Unlimited bank (${r.added} new Unlimited run(s), ${r.runs.length} total).`);
}

/* ---------------------------------------------------------- main */
const [cmd, arg, flag] = process.argv.slice(2);
try {
  if (cmd === 'add') add(arg, flag === '--bank');
  else if (cmd === 'runs') {   // one-off: group any loose bank questions into new runs
    const questions = read(QFILE), schedule = read(SFILE);
    const r = appendRuns(questions, schedule);
    const next = { ...schedule, runs: r.runs };
    const { errors } = validateAll(questions, next);
    if (errors.length) { errors.forEach((x) => console.log('  ✗ ' + x)); process.exit(1); }
    write(SFILE, next); build(questions, next);
    console.log(`${r.added} new run(s); ${r.runs.length} Unlimited runs in total.`);
  }
  else {
    const questions = read(QFILE), schedule = read(SFILE);
    const { errors, warnings } = validateAll(questions, schedule);
    if (cmd === 'status' || cmd === 'check' || cmd === 'build') {
      warnings.forEach((w) => console.log('  ! ' + w));
      errors.forEach((x) => console.log('  ✗ ' + x));
      const last = Math.max(...Object.keys(schedule.flights).map(Number));
      const today = flightNumberToday(schedule.launch);
      const bank = questions.filter((q) => q.pool === 'bank').length;
      console.log(`${questions.length} questions · ${last} daily flights scheduled · today is #${today} · ${last - today} days ahead · ${bank} bank-only · ${(schedule.runs || []).length} Unlimited runs`);
      if (errors.length) { console.log(`\n${errors.length} error(s).`); process.exit(1); }
      if (cmd === 'build') { build(questions, schedule); console.log(`Wrote ${path.relative(ROOT, OUT)}`); }
    } else {
      console.log('usage: node tools/content.mjs check | build | add <batch.json> | status');
    }
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
