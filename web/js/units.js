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
  };
  const SHORT = { meters: 'm', metres: 'm', feet: 'ft', 'km per second': 'km/s', 'miles per second': 'mi/s', 'm per second': 'm/s', 'feet per second': 'ft/s', 'km per hour': 'km/h', 'miles per hour': 'mph', pounds: 'lb' };

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

  /** Default: imperial for US English, metric for everyone else. */
  function defaultSystem() {
    try { return /^en-US$/i.test(navigator.language) ? 'imperial' : 'metric'; } catch (e) { return 'metric'; }
  }

  function system() {
    const p = K.storage.data && K.storage.data.prefs;
    return (p && p.units) || defaultSystem();
  }
  function setSystem(sys) {
    K.storage.data.prefs = { ...(K.storage.data.prefs || {}), units: sys };
    K.storage.save();
  }
  const convertible = (fact) => Boolean(MAP[fact.unit]);

  /** A display view of one fact in the current system. */
  function view(fact) {
    const m = MAP[fact.unit];
    const imperial = Boolean(m) && system() === 'imperial';
    const toDisp = (v) => (imperial ? m.to(v) : v);
    const toMetric = (v) => (imperial ? m.from(v) : v);
    const unit = imperial ? m.imp : fact.unit || '';

    /** Format a metric value for display. exact = the true answer. */
    function fmt(vMetric, exact) {
      if (fact.scale === 'year') { const y = Math.round(vMetric); return y < 1 ? `${1 - y} BC` : String(y); }
      if (exact && !imperial) return K.scoring.formatExact(fact, vMetric);
      const v = toDisp(vMetric);
      const a = Math.abs(v);
      if (exact) return v.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : a >= 10 ? 1 : 2 });
      const g = Number(v.toPrecision(3));
      return g.toLocaleString('en-US', { maximumFractionDigits: Math.abs(g) < 10 ? 2 : 1 });
    }

    return { unit, short: SHORT[unit] || unit, imperial, convertible: Boolean(m), toDisp, toMetric, fmt };
  }

  /** Render a hint like "For scale: … {93 m} …" in the player's units. */
  const TOKEN_UNITS = { m: 'meters', km: 'km', '°C': '°C', 'm/s': 'm per second', 'km/s': 'km per second', 'km/h': 'km per hour', kg: 'kg' };
  function hint(text) {
    return String(text || '').replace(/\{([\d.,]+)\s*(km\/h|km\/s|m\/s|km|kg|m|°C)\}/g, (_, num, u) => {
      const v = Number(num.replace(/,/g, ''));
      const vw = view({ unit: TOKEN_UNITS[u], scale: 'log' });
      return `${vw.fmt(v)} ${vw.short}`;
    });
  }

  return { altUnit, altVal, altNum, altText, altShown, legText, climbText, view, system, setSystem, convertible, defaultSystem, hint };
})();
