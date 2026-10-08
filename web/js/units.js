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
    'metres':        { imp: 'feet',             to: (v) => v * 3.28084,  from: (v) => v / 3.28084 },
    'km':            { imp: 'miles',            to: (v) => v * 0.621371, from: (v) => v / 0.621371 },
    'km per second': { imp: 'miles per second', to: (v) => v * 0.621371, from: (v) => v / 0.621371 },
    'm per second':  { imp: 'feet per second',  to: (v) => v * 3.28084,  from: (v) => v / 3.28084 },
    '°C':            { imp: '°F',               to: (v) => v * 9 / 5 + 32, from: (v) => (v - 32) * 5 / 9 },
    'km per hour':   { imp: 'miles per hour',   to: (v) => v * 0.621371, from: (v) => v / 0.621371 },
    'kg':            { imp: 'pounds',           to: (v) => v * 2.20462,  from: (v) => v / 2.20462 },
  };
  const SHORT = { metres: 'm', feet: 'ft', 'km per second': 'km/s', 'miles per second': 'mi/s', 'm per second': 'm/s', 'feet per second': 'ft/s', 'km per hour': 'km/h', 'miles per hour': 'mph', pounds: 'lb' };

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
  const TOKEN_UNITS = { m: 'metres', km: 'km', '°C': '°C', 'm/s': 'm per second', 'km/s': 'km per second', 'km/h': 'km per hour', kg: 'kg' };
  function hint(text) {
    return String(text || '').replace(/\{([\d.,]+)\s*(km\/h|km\/s|m\/s|km|kg|m|°C)\}/g, (_, num, u) => {
      const v = Number(num.replace(/,/g, ''));
      const vw = view({ unit: TOKEN_UNITS[u], scale: 'log' });
      return `${vw.fmt(v)} ${vw.short}`;
    });
  }

  return { view, system, setSystem, convertible, defaultSystem, hint };
})();
