/* ==========================================================================
   KÁRMÁN · units.js
   Metric / imperial display. Facts are always STORED and SCORED in metric.
   Players type and read numbers in their chosen system; this module converts
   at the edges. Counts and years have no alternative unit, so the toggle
   only appears where it applies.

   Ranges are computed in metric and their edges converted for display, so a
   player's odds are identical in either system.
   ========================================================================== */

K.units = (() => {
  /* metric unit → imperial equivalent */
  const MAP = {
    'meters':        { imp: 'feet',             to: (v) => v * 3.28084,  from: (v) => v / 3.28084 },
    'metres':        { imp: 'feet',             to: (v) => v * 3.28084,  from: (v) => v / 3.28084 },   // legacy spelling in old saves
    'km':            { imp: 'miles',            to: (v) => v * 0.621371, from: (v) => v / 0.621371 },
    'km per second': { imp: 'miles per second', to: (v) => v * 0.621371, from: (v) => v / 0.621371 },
    'm per second':  { imp: 'feet per second',  to: (v) => v * 3.28084,  from: (v) => v / 3.28084 },
    '°C':            { imp: '°F',               to: (v) => v * 9 / 5 + 32, from: (v) => (v - 32) * 5 / 9 },
    'km per hour':   { imp: 'miles per hour',   to: (v) => v * 0.621371, from: (v) => v / 0.621371 },
    'kg':            { imp: 'pounds',           to: (v) => v * 2.20462,  from: (v) => v / 2.20462 },
    'mm':            { imp: 'inches',           to: (v) => v / 25.4,     from: (v) => v * 25.4 },
    'cm':            { imp: 'inches',           to: (v) => v / 2.54,     from: (v) => v * 2.54 },
    'liters':        { imp: 'gallons',          to: (v) => v * 0.264172, from: (v) => v / 0.264172 },
    'litres':        { imp: 'gallons',          to: (v) => v * 0.264172, from: (v) => v / 0.264172 },   // legacy spelling
    'square km':     { imp: 'square miles',     to: (v) => v * 0.386102, from: (v) => v / 0.386102 },
    'tonnes':        { imp: 'tons',             to: (v) => v * 1.10231,  from: (v) => v / 1.10231 },
  };
  /* Every metric unit a question may use. tools/content.mjs refuses a
     question whose unit looks metric but has no imperial twin here, so a
     player in imperial can always answer in their own units. */
  const METRIC_UNITS = Object.keys(MAP);
  const SHORT = { mm: 'mm', cm: 'cm', inches: 'in', ounces: 'oz', 'fluid ounces': 'fl oz', miles: 'mi', tons: 'tons', liters: 'L', litres: 'L', gallons: 'gal', 'square km': 'sq km', 'square miles': 'sq mi', meters: 'm', metres: 'm', feet: 'ft', 'km per second': 'km/s', 'miles per second': 'mi/s', 'm per second': 'm/s', 'feet per second': 'ft/s', 'km per hour': 'km/h', 'miles per hour': 'mph', pounds: 'lb' };

  /* ---- altitude (the score) in the player's units ----
     Scored and stored in km; shown as km or miles. Ceiling 140 km ≈ 87 mi. */
  const KM_TO_MI = 0.621371;
  const altUnit = () => (system() === 'imperial' ? 'mi' : 'km');
  const altVal = (km) => (system() === 'imperial' ? km * KM_TO_MI : km);
  /** "54.0" style number for the odometer (1 decimal), in the player's units. */
  const altNum = (km, decimals = 1) => altVal(km).toFixed(decimals);
  /** "54 km" / "34 mi", whole numbers unless small. */
  function altText(km, opts = {}) {
    const v = altVal(km);
    // Miles are always whole (climbs in km are whole, so km never need a decimal
    // either, except in older saves under 10 km).
    const d = opts.decimals != null ? opts.decimals : (system() === 'imperial' ? 0 : v < 10 && v !== Math.round(v) ? 1 : 0);
    return `${v.toFixed(d)} ${altUnit()}`;
  }
  /** An altitude rounded exactly as altText shows it (so legs can add up to it). */
  function altShown(km) {
    const v = altVal(km);
    const d = system() === 'imperial' ? 0 : v < 10 && v !== Math.round(v) ? 1 : 0;
    return Number(v.toFixed(d));
  }
  /** What one leg added, as the change in the altitude the player SEES, so the
      legs of a flight always add up to the total shown: "+10 km", "+6 mi". */
  function legText(fromKm, toKm) {
    const d = Math.round((altShown(toKm) - altShown(fromKm)) * 10) / 10;
    return `+${d % 1 ? d.toFixed(1) : d} ${altUnit()}`;
  }
  /** A width's nominal climb (before a leg is flown): "+10 km" / "+6 mi". */
  const climbText = (km) => (system() === 'imperial' ? `+${Math.round(km * KM_TO_MI)} mi` : `+${Math.round(km * 10) / 10} km`);

  /** Everyone starts in metric (scores read cleanly: Pinpoint +20 km); the
      menu switch or the unit chip flips it. storage.js keeps imperial for
      pilots who were already seeing it before this default changed. */
  function defaultSystem() { return 'metric'; }

  function system() {
    const p = K.storage.data && K.storage.data.prefs;
    return (p && p.units) || defaultSystem();
  }
  function setSystem(sys) {
    K.storage.data.prefs = { ...(K.storage.data.prefs || {}), units: sys };
    K.storage.save();
  }
  const convertible = (fact) => Boolean(MAP[fact.unit]);

  /* ---- the unit a person would actually say, by size ----
     A fact is stored and scored in the unit it was written in (saves keep
     guesses in that unit, so it never changes). What the player SEES is picked
     by the size of the answer: a rim 0.457 m across reads "45.7 cm" or
     "18 inches", not "1.5 feet"; a 300 g phone reads "10.6 ounces", not
     "0.66 pounds". Lengths, weights and volumes; other units use MAP as is. */
  const FAMILY = {
    mm: ['len', 0.001], cm: ['len', 0.01], meters: ['len', 1], metres: ['len', 1], km: ['len', 1000],
    kg: ['mass', 1], tonnes: ['mass', 1000],
    liters: ['vol', 1], litres: ['vol', 1],
  };
  const SIZE = {   // one of each display unit, in the family's base unit (m, kg, L)
    len: { mm: 0.001, cm: 0.01, meters: 1, km: 1000, inches: 0.0254, feet: 0.3048, miles: 1609.344 },
    mass: { kg: 1, tonnes: 1000, ounces: 0.028349523125, pounds: 0.45359237, tons: 907.18474 },
    vol: { liters: 1, 'fluid ounces': 0.0295735295625, gallons: 3.785411784 },
  };
  /** { metric, imperial } display units for a value of `size` in `unit`, or null. */
  function bestUnits(unit, size) {
    const f = FAMILY[unit];
    if (!f || !Number.isFinite(size)) return null;
    const [fam, k] = f;
    const s = Math.abs(size) * k;
    let met = unit === 'metres' ? 'meters' : unit === 'litres' ? 'liters' : unit;
    let imp;
    if (fam === 'len') {
      if (met === 'meters' && s < 1) met = s < 0.01 ? 'mm' : 'cm';
      imp = s < 1 ? 'inches' : unit === 'km' && s >= SIZE.len.miles ? 'miles' : 'feet';
    } else if (fam === 'mass') {
      imp = s < SIZE.mass.pounds ? 'ounces' : unit === 'tonnes' ? 'tons' : 'pounds';
    } else {
      imp = s < 1 ? 'fluid ounces' : 'gallons';
    }
    const conv = (to) => ({ unit: to, to: (v) => (v * k) / SIZE[fam][to], from: (v) => (v * SIZE[fam][to]) / k });
    return { metric: conv(met), imperial: conv(imp) };
  }

  /** A display view of one fact in the current system. */
  function view(fact) {
    const best = bestUnits(fact.unit, fact.answer);
    const m = MAP[fact.unit];
    const imperial = Boolean(m) && system() === 'imperial';
    const d = best ? (imperial ? best.imperial : best.metric)
      : imperial ? { unit: m.imp, to: m.to, from: m.from }
      : { unit: fact.unit || '', to: (v) => v, from: (v) => v };
    const toDisp = d.to;
    const toMetric = d.from;
    const unit = d.unit;
    const asWritten = !imperial && unit === (fact.unit === 'metres' ? 'meters' : fact.unit === 'litres' ? 'liters' : fact.unit || '');

    /** Format a metric value for display. exact = the true answer. */
    function fmt(vMetric, exact) {
      if (fact.scale === 'year') { const y = Math.round(vMetric); return y < 1 ? `${1 - y} BC` : String(y); }
      if (exact && asWritten) return K.scoring.formatExact(fact, vMetric);
      const v = toDisp(vMetric);
      const a = Math.abs(v);
      if (exact) return v.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : a >= 10 ? 1 : 2 });
      const g = Number(v.toPrecision(3));
      return g.toLocaleString('en-US', { maximumFractionDigits: Math.abs(g) < 10 ? 2 : 1 });
    }

    return { unit, short: SHORT[unit] || unit, imperial, convertible: Boolean(m), toDisp, toMetric, fmt };
  }

  /** Render a hint like "For scale: … {93 m} …" in the player's units. */
  const TOKEN_UNITS = { m: 'meters', km: 'km', '°C': '°C', 'm/s': 'm per second', 'km/s': 'km per second', 'km/h': 'km per hour', kg: 'kg',
    mm: 'mm', cm: 'cm', L: 'liters', 'sq km': 'square km', t: 'tonnes' };
  const TOKEN_RE = /\{([\d.,]+)\s*(km\/h|km\/s|m\/s|sq km|km|kg|mm|cm|m|°C|L|t)\}/g;
  /** Question, hint, clue and fun-fact text: {93 m} tokens become "93 m" or "305 ft". */
  function hint(text) {
    return String(text || '').replace(TOKEN_RE, (_, num, u) => {
      const v = Number(num.replace(/,/g, ''));
      const vw = view({ unit: TOKEN_UNITS[u], scale: 'log', answer: v });   // sized like the fact: {0.4 m} → 40 cm / 16 in
      const imp = vw.imperial;
      // °C/°F stay exact-ish; small imperial lengths keep a decimal.
      let shown;
      if (TOKEN_UNITS[u] === '°C') shown = String(Math.round(vw.toDisp(v)));
      else if (!imp) shown = vw.fmt(v);
      else {
        // Converted "about" figures: no false precision (15 cm → 5.9 in, 381 m → 1,250 ft).
        const d = vw.toDisp(v), a = Math.abs(d);
        shown = a >= 10 ? Math.round(Number(d.toPrecision(3))).toLocaleString('en-US') : a >= 1 ? String(Number(d.toFixed(1))) : String(Number(d.toPrecision(2)));
      }
      return `${shown} ${vw.short}`;
    }).replace(/\{=([^}]*)\}/g, '$1');      // {=100 m}: a name ("the 100 m dash"), never converted
  }

  return { altUnit, altVal, altNum, altText, altShown, legText, climbText, view, bestUnits, system, setSystem, convertible, defaultSystem, hint, METRIC_UNITS, TOKEN_UNITS };
})();
