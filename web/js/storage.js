/* ==========================================================================
   KÁRMÁN · storage.js
   Everything the game remembers lives in ONE localStorage key. Every read and
   write is wrapped in try/catch: private windows and blocked storage must
   never break the game, they just make it forget.

   SHAPE (v1)
   {
     v: 1,
     days:   { [flightNo]: FlightRecord },      // finished flights
     live:   LiveFlight | null,                  // the flight in progress
     streak: { cur, best, lastDay, thermals },
     stats:  { flights, bestAlt, chip: [[hits, tries] × 5] },
     stamps: { [milestoneId]: firstFlightNo },
     stampCounts: { [milestoneId]: timesPassed },   // drives ink tiers
     seenHelp: boolean,
     runs:   [FlightRecord],                     // Unlimited runs (latest 50)
     seen:   [factId],                           // Unlimited questions already dealt
     freeRunUsed: boolean,                       // the one free Unlimited run
     access: { unlimited, via: 'stripe'|'code'|null, code, session, checkedAt, pending, email },
     sync:   { ver, at }                           // cloud copy version (sync.js)
     reported: { [factId]: true }
   }
   Changing the shape later? Add a field to fresh() and, if older saves need
   converting, a step in migrate(). Never rename or delete a field players
   already have: that is how progress survives every update.
   ========================================================================== */

K.storage = (() => {
  const KEY = K.CONFIG.STORAGE_KEY;
  let data = null;

  function fresh() {
    return {
      v: 1,
      launch: launchKey(),  // which Flight #1 date these flight numbers belong to
      days: {},
      live: null,
      streak: { cur: 0, best: 0, lastDay: null, thermals: 0 },
      stats: { flights: 0, bestAlt: 0, chip: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] },
      stamps: {},
      stampCounts: {},
      prefs: {},            // { units: 'metric' | 'imperial', sound: true | false }
      device: null,         // random id for anonymous comparison stats
      pilot: null,          // seed for the Pilot Nº; follows the Google account across devices
      seenHelp: false,
      runs: [],
      seen: [],
      freeRunUsed: false,
      access: { unlimited: false, via: null, code: null, session: null, checkedAt: 0 },
      reported: {},
      parked: {},
      tutored: false,       // has seen the one-time guided first leg
      guideV: 4,            // bump to show the guided leg once more to everyone (4: Oct 2026, two-step guide, ranges on the widths)
      lastChip: null,       // the width you used last; new legs start on it
      runNext: 1,           // (unused since random runs; kept for old saves)
      runsDone: [],         // numbered Unlimited runs this pilot has flown (no repeats until all done)
      unlimitedCount: 0,    // how many Unlimited flights: shown as Unlimited · Flight #N           // flights left mid-way when switching modes, by slot
    };
  }

  function launchKey() { const L = K.CONFIG.LAUNCH; return `${L.y}-${L.m}-${L.d}`; }

  /** Fill in any fields an older save is missing. Add real migrations here. */
  function migrate(saved) {
    const base = fresh();
    // Flight numbers from a different launch date mean different questions, so
    // flight history, streak and stamps from that era are cleared (prefs, unlock
    // and Unlimited history stay). Saves from before this field were 2026-10-4.
    if ((saved.launch || '2026-10-4') !== base.launch) {
      saved = { ...saved, launch: base.launch, days: {}, live: null, streak: base.streak, stats: base.stats,
        stamps: {}, stampCounts: {}, reported: {}, device: null };
    }
    const out = { ...base, ...saved, streak: { ...base.streak, ...saved.streak }, stats: { ...base.stats, ...saved.stats }, access: { ...base.access, ...saved.access } };
    // Early saves only knew first-time stamps: count each as passed once.
    if (!saved.stampCounts) {
      out.stampCounts = {};
      Object.keys(out.stamps || {}).forEach((id) => { out.stampCounts[id] = 1; });
    }
    // Points are the source of truth; altitude is re-derived so a change in
    // metres-per-point (e.g. when the Burn was removed) never leaves stale km.
    Object.values(out.days || {}).forEach((d) => {
      if (d.pts == null && d.alt != null) d.pts = Math.round(d.alt * 10);
      if (d.pts != null) d.alt = K.scoring.kmOf(d.pts);
    });
    const best = Object.values(out.days || {}).reduce((m, d) => Math.max(m, d.alt || 0), 0);
    out.stats.bestAlt = best;
    // Everyone (launch-day pilots included) gets the guided leg once per guide
    // version. It only changes the next first leg: no streak, stat or history is touched.
    if (saved.guideV !== 4) { out.tutored = false; out.guideV = 4; }
    if (saved.runNext == null) out.runNext = out.freeRunUsed ? 2 : 1;   // older saves: the free run counts as Run 1
    if (!saved.runsDone) out.runsDone = (out.runs || []).map((r) => r.run).filter((k) => Number.isInteger(k) && k >= 1 && k < (out.runNext || 1)).concat(out.freeRunUsed ? [1] : []).filter((k, i, a) => a.indexOf(k) === i);
    if (saved.unlimitedCount == null) out.unlimitedCount = (out.runs || []).length;
    if (!out.device) out.device = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    if (!out.pilot) out.pilot = out.device;      // existing pilots keep the number they already have
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      data = migrate(raw ? JSON.parse(raw) : fresh());
      // Oct 2026: new pilots start in metric (the scoring reads cleanly in km:
      // Pinpoint +20 km). Pilots who already flew without ever choosing keep
      // what they had been seeing (imperial for US English) until they switch.
      if (raw && !(data.prefs && data.prefs.units) && Object.keys(data.days || {}).length) {
        let legacy = 'metric';
        try { if (/^en-US$/i.test(navigator.language)) legacy = 'imperial'; } catch (e) { /* metric */ }
        data.prefs = { ...(data.prefs || {}), units: legacy };
      }
    } catch (e) {
      data = data || fresh();
    }
    return data;
  }

  /** Write to this browser; signed-in pilots also get a cloud copy shortly after.
      quiet = true for writes that came from the cloud itself. */
  function save(quiet) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* storage unavailable: keep playing from memory */
    }
    if (!quiet && K.sync) K.sync.soon();
  }

  function wipe() {
    data = migrate(fresh());
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return data;
  }

  return { load, save, wipe, migrate, get data() { return data; } };
})();
