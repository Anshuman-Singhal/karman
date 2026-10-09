/* ==========================================================================
   KÁRMÁN · scoring.js
   Pure functions only: no DOM, no storage. Identical rules for every player,
   so altitude never depends on what anyone else answered.

   The decision each round:
     guess  the number you type
     width  how wide a range you bet on (Wide … Pinpoint)
   If the true answer lands inside your range your balloon climbs that width's
   kilometres: Wide 2 · Fair 5 · Snug 10 · Tight 15 · Pinpoint 20 · miss 0.
   Seven legs × 20 km = 140 km, the ceiling; the Kármán line (space) is 100 km.
   Under the hood the score is kept as integer "points" at 5 per km (0–700),
   which is what saves and the stats server already store, so nothing migrates.
   ========================================================================== */

K.scoring = (() => {
  /* ratio: hi/lo for log questions · years: ± years for date questions
     pts:   points for a hit */
  const PTS_PER_KM = 5;
  const CHIPS = [
    // Widths: Wide is huge (÷100 to ×100, ±1,000 years) so a nervous guess still
    // scores; the rest step down geometrically to Pinpoint (×1.15, ±2 years).
    // ratio = hi/lo for log questions, years = ± for dates, km = the climb on a hit.
    { key: 'wide',     name: 'Wide',     ratio: 10000,  years: 1000, km: 2,  glyph: '☁️' },
    { key: 'fair',     name: 'Fair',     ratio: 25,     years: 200,  km: 5,  glyph: '🎈' },
    { key: 'snug',     name: 'Snug',     ratio: 3.24,   years: 45,   km: 10, glyph: '✈️' },
    { key: 'tight',    name: 'Tight',    ratio: 1.5625, years: 10,   km: 15, glyph: '🛰️' },
    { key: 'pinpoint', name: 'Pinpoint', ratio: 1.15,   years: 2,    km: 20, glyph: '🚀' },
  ].map((c) => ({ ...c, pts: c.km * PTS_PER_KM }));
  const MISS_GLYPH = '💨';
  const MAX_KM = K.CONFIG.LEGS * 20;                                // 140: a perfect flight
  const MAX_PTS = MAX_KM * PTS_PER_KM;                              // 700, unchanged on disk
  const METRES_PER_POINT = 1000 / PTS_PER_KM;
  const DEFAULT_CHIP = 2; // Snug: the best average choice for a calibrated player

  /* Altitude milestones. Crossing one for the first time earns a stamp. */
  const MILESTONES = [
    { id: 'clouds',      km: 2,     name: 'Cloud break',           short: 'Clouds' },
    { id: 'everest',     km: 8.849, name: 'Higher than Everest',   short: 'Everest' },
    { id: 'airliners',   km: 11,    name: 'Above the airliners',   short: 'Airliners' },
    { id: 'ozone',       km: 20,    name: 'Into the ozone layer',  short: 'Ozone' },
    { id: 'skydive',     km: 39,    name: 'Record skydive height', short: 'Skydive' },
    { id: 'stratopause', km: 50,    name: 'The stratopause',       short: 'Stratopause' },
    { id: 'karman',      km: 100,   name: 'The Kármán line',       short: 'Space' },
    { id: 'orbit',       km: 140,   name: 'Apogee',                short: 'Apogee' },
  ];

  /* Stamp ink tiers. A milestone's ink upgrades as you pass it more often.
     Thresholds thin out so tier-ups stay rare and worth a celebration. */
  const STAMP_TIERS = [
    { at: 1,  name: 'Navy' },
    { at: 5,  name: 'Bronze' },
    { at: 10, name: 'Silver' },
    { at: 20, name: 'Gold' },
    { at: 30, name: 'Moon rock' },
  ];
  /** 0 = not yet earned, 1 = navy … 5 = moon rock */
  const tierIndex = (count) => STAMP_TIERS.filter((t) => count >= t.at).length;
  const nextTier = (count) => STAMP_TIERS.find((t) => count < t.at) || null;

  const round2 = (x) => Math.round(x * 100) / 100;

  /* ---- slider position (t ∈ [0,1]) ↔ value ---- */
  function valueAt(fact, t) {
    if (fact.scale === 'year') return fact.min + (fact.max - fact.min) * t;
    return fact.min * Math.pow(fact.max / fact.min, t);
  }
  function tAt(fact, v) {
    if (fact.scale === 'year') return (v - fact.min) / (fact.max - fact.min);
    return Math.log(v / fact.min) / Math.log(fact.max / fact.min);
  }

  /* ---- what the player actually commits to ---- */
  function roundGuess(fact, v) {
    if (fact.scale === 'year') return Math.round(v);
    if (fact.int && v < 100) return Math.max(1, Math.round(v));
    return Number(v.toPrecision(3)); // 3 significant figures: 384,000 · 42.2 · 7.35
  }

  function range(fact, guess, chipIdx) {
    const chip = CHIPS[chipIdx];
    if (fact.scale === 'year') return { lo: guess - chip.years, hi: guess + chip.years };
    const k = Math.sqrt(chip.ratio);
    return { lo: guess / k, hi: guess * k };
  }

  const isHit = (fact, r) => fact.answer >= r.lo && fact.answer <= r.hi;

  /* ---- points and altitude ---- */
  const legPoints = (chipIdx) => CHIPS[chipIdx].pts;
  const legKm = (chipIdx) => CHIPS[chipIdx].km;
  const kmOf = (pts) => pts / PTS_PER_KM;
  const ptsOf = (km) => Math.round(km * PTS_PER_KM);

  /* ---- labels ---- */
  function format(fact, v) {
    if (fact.scale === 'year') return String(Math.round(v));
    const g = roundGuess(fact, v);
    return g.toLocaleString('en-US', { maximumFractionDigits: g < 10 ? 2 : 1 });
  }

  /** The true answer, exactly as stored (12,742 not 12,700). */
  function formatExact(fact, v) {
    if (fact.scale === 'year') return String(Math.round(v));
    return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }

  /**
   * The clue for a fact: a window the answer is guaranteed to sit inside.
   * Log questions: a ×10 window; years: a 40-year window. Where the answer
   * falls inside it is seeded per fact, so everyone sees the same clue and
   * the answer is never simply the middle. Edges are rounded to tidy numbers.
   */
  function clueWindow(fact) {
    const rand = K.rng.fromLabel(`karman-clue-${fact.id}`);
    const u = 0.15 + rand() * 0.7;
    if (fact.scale === 'year') {
      const lo = Math.floor((fact.answer - u * 40) / 5) * 5;
      return { lo, hi: lo + 40 };
    }
    const tidy = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; };
    let lo = tidy(fact.answer / Math.pow(10, u));
    if (lo > fact.answer) lo = tidy(lo / 1.2);
    let hi = lo * 10;
    if (hi < fact.answer) hi = tidy(fact.answer * 1.2);
    return { lo, hi };
  }
  const CLUE_FACTOR = 0.5;   // a clued leg scores half

  /** How far a guess was from the answer, in words. Empty string on a hit. */
  function offBy(fact, guess, hit) {
    if (hit) return '';
    if (fact.scale === 'year') {
      const d = Math.round(Math.abs(fact.answer - guess));
      return `${d} ${d === 1 ? 'year' : 'years'} too ${guess < fact.answer ? 'early' : 'late'}`;
    }
    const ratio = fact.answer / guess;
    const r = ratio >= 1 ? ratio : 1 / ratio;
    const txt = r < 10 ? r.toFixed(1).replace(/\.0$/, '') : Math.round(r).toLocaleString('en-US');
    return `guess ${txt}× too ${ratio >= 1 ? 'low' : 'high'}`;
  }

  /** Atmospheric layer for a final altitude (used on results + share). */
  function tierName(km) {
    if (km >= 100) return 'Space';
    if (km >= 85) return 'Thermosphere';
    if (km >= 50) return 'Mesosphere';
    if (km >= 12) return 'Stratosphere';
    if (km >= 2) return 'Troposphere';
    return 'Below the clouds';
  }

  return {
    CHIPS, MISS_GLYPH, DEFAULT_CHIP, MILESTONES, STAMP_TIERS, METRES_PER_POINT, MAX_PTS, MAX_KM, PTS_PER_KM, legKm,
    valueAt, tAt, roundGuess, range, isHit,
    legPoints, kmOf, ptsOf, clueWindow, CLUE_FACTOR,
    format, formatExact, offBy, tierName, tierIndex, nextTier, round2,
  };
})();
