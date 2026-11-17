/* ==========================================================================
   KÁRMÁN · sync.js
   A signed-in pilot (anyone who bought, or restored, with Google) gets a
   cloud copy of their save, tied to their Google account. Nothing is ever
   overwritten: the copy on this device and the copy in the cloud are MERGED.

     · flights: every finished daily/archive flight and Unlimited run from
       either side is kept (a day flown on both keeps the finished, higher one)
     · streak: replayed from the merged list of daily flights, exactly as the
       game builds it (thermals included); best never goes down
     · stats and stamp counts: never lower than either side, never double
       counted (derived from the merged flights, then max'd)
     · seen questions, flown runs, reports: union. Free run used: either.
     · this device keeps its own preferences, device id, unlock and any
       flight in progress.

   So a pilot who plays five days unsigned and buys on day six uploads those
   five days the moment they sign in, and gets them back on any other device
   they restore on. Playing on two devices between syncs merges cleanly.

   Protocol: GET /api/save → { data, ver }. PUT /api/save { data, base } is
   refused (409, with the current copy) if someone else saved since `base`;
   we merge that and try again. Offline? Nothing is lost locally; the next
   sync catches up.
   ========================================================================== */

K.sync = (() => {
  const C = K.CONFIG;
  const LOCAL_ONLY = ['live', 'parked', 'access', 'prefs', 'device', 'sync', 'runsSeen', 'nudge'];
  const session = () => { const a = K.storage.data.access; return a && a.session && a.session !== 'dev' ? a.session : null; };
  const enabled = () => Boolean(C.PAYMENTS && session());
  const hdrs = () => ({ authorization: `Bearer ${session()}`, 'content-type': 'application/json' });

  /* ---------------------------------------------------------- merge (pure) */
  const recKey = (r) => `${r.at || 0}:${r.run || ''}:${r.pts}`;
  function better(a, b) {               // two records for the same flight number
    if (!a) return b;
    if (!b) return a;
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? a : b;
    if ((a.pts || 0) !== (b.pts || 0)) return (a.pts || 0) > (b.pts || 0) ? a : b;
    return (a.at || 0) <= (b.at || 0) ? a : b;
  }
  function replayStreak(days) {
    const s = { cur: 0, best: 0, lastDay: null, thermals: 0 };
    Object.values(days).filter((d) => d && d.done && (d.mode || 'daily') === 'daily').map((d) => d.n)
      .sort((x, y) => x - y).forEach((day) => {
        if (s.lastDay === day) return;
        const missed = s.lastDay == null ? null : day - s.lastDay - 1;
        if (missed === 0) s.cur += 1;
        else if (missed != null && missed > 0 && missed <= s.thermals) { s.thermals -= missed; s.cur += 1; }
        else s.cur = 1;
        s.lastDay = Math.max(day, s.lastDay || 0);
        s.best = Math.max(s.best, s.cur);
        if (s.cur % C.THERMAL_EVERY === 0 && s.thermals < C.THERMAL_MAX) s.thermals += 1;
      });
    return s;
  }

  /** Merge a cloud save into the local one. Returns a new object; inputs untouched. */
  function merge(local, remoteRaw) {
    if (!remoteRaw) return local;
    const remote = K.storage.migrate(JSON.parse(JSON.stringify(remoteRaw)));
    const out = { ...local };

    // finished flights, by flight number
    out.days = { ...remote.days };
    Object.entries(local.days || {}).forEach(([n, d]) => { out.days[n] = better(local.days[n], remote.days[n]); });
    Object.keys(out.days).forEach((n) => { if (!out.days[n]) delete out.days[n]; });

    // Unlimited runs, by identity (time + run + score); newest 50 kept
    const runs = new Map();
    [...(remote.runs || []), ...(local.runs || [])].forEach((r) => runs.set(recKey(r), r));
    out.runs = [...runs.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-50);
    const localKeys = new Set((local.runs || []).map(recKey));
    const remoteKeys = new Set((remote.runs || []).map(recKey));
    const onlyRemote = (remote.runs || []).filter((r) => !localKeys.has(recKey(r))).length;
    const onlyLocal = (local.runs || []).filter((r) => !remoteKeys.has(recKey(r))).length;
    out.unlimitedCount = Math.max((local.unlimitedCount || 0) + onlyRemote, (remote.unlimitedCount || 0) + onlyLocal);

    // streak: replay, never lower than either side's best
    const st = replayStreak(out.days);
    st.best = Math.max(st.best, (local.streak || {}).best || 0, (remote.streak || {}).best || 0);
    out.streak = st;

    // stats + stamps: derived from the merged flights, never lower than either side
    const all = [...Object.values(out.days), ...out.runs].filter((r) => r && r.done);
    const chip = [0, 1, 2, 3, 4].map(() => [0, 0]);
    all.forEach((r) => (r.rounds || []).forEach((x) => { if (chip[x.chip]) { chip[x.chip][1] += 1; if (x.hit) chip[x.chip][0] += 1; } }));
    const lc = (local.stats || {}).chip || [], rc = (remote.stats || {}).chip || [];
    out.stats = {
      flights: Math.max(all.length, (local.stats || {}).flights || 0, (remote.stats || {}).flights || 0),
      bestAlt: Object.values(out.days).reduce((m, d) => Math.max(m, d.alt || 0), 0),
      chip: chip.map((c, i) => [Math.max(c[0], (lc[i] || [0])[0] || 0, (rc[i] || [0])[0] || 0), Math.max(c[1], (lc[i] || [0, 0])[1] || 0, (rc[i] || [0, 0])[1] || 0)]),
    };
    out.stamps = { ...remote.stamps };
    Object.entries(local.stamps || {}).forEach(([id, n]) => { out.stamps[id] = out.stamps[id] ? Math.min(out.stamps[id], n) : n; });
    out.stampCounts = {};
    K.scoring.MILESTONES.forEach((m) => {
      const derived = all.filter((r) => (r.maxAlt != null ? r.maxAlt : r.alt || 0) >= m.km).length;
      const v = Math.max(derived, (local.stampCounts || {})[m.id] || 0, (remote.stampCounts || {})[m.id] || 0);
      if (v > 0) { out.stampCounts[m.id] = v; if (!out.stamps[m.id]) out.stamps[m.id] = 1; }
    });

    // unions and ors
    out.seen = [...new Set([...(remote.seen || []), ...(local.seen || [])])];
    out.runsDone = [...new Set([...(remote.runsDone || []), ...(local.runsDone || [])])];
    out.reported = { ...(remote.reported || {}), ...(local.reported || {}) };
    out.freeRunUsed = Boolean(local.freeRunUsed || remote.freeRunUsed);
    out.tutored = Boolean(local.tutored || remote.tutored);
    out.seenHelp = Boolean(local.seenHelp || remote.seenHelp);
    if (local.lastChip == null && remote.lastChip != null) out.lastChip = remote.lastChip;
    out.pilot = remote.pilot || local.pilot;      // the account's first device names the pilot
    return out;
  }

  /** What goes to the cloud: everything except this device's own things. */
  function portable(d) {
    const o = { ...d };
    LOCAL_ONLY.forEach((k) => delete o[k]);
    return o;
  }

  /* ---------------------------------------------------------- network */
  let busy = null, again = false, timer = 0;
  const apply = (merged) => {
    const d = K.storage.data;
    Object.keys(merged).forEach((k) => { if (!LOCAL_ONLY.includes(k)) d[k] = merged[k]; });
    K.storage.save(true);
  };
  const ver = () => (K.storage.data.sync && K.storage.data.sync.ver) || 0;
  const setVer = (v) => { K.storage.data.sync = { ver: v, at: Date.now() }; K.storage.save(true); };

  /** Pull, merge, push. Safe to call any time; calls overlap into one. */
  function now() {
    if (!enabled()) return Promise.resolve(false);
    if (busy) { again = true; return busy; }
    busy = (async () => {
      let changed = false;
      try {
        const got = await fetch(`${C.API_BASE}/api/save`, { headers: hdrs(), cache: 'no-store' });
        if (!got.ok) return false;
        let { data, ver: v } = await got.json();
        for (let attempt = 0; attempt < 3; attempt++) {
          const before = JSON.stringify(portable(K.storage.data));
          const merged = merge(K.storage.data, data);
          if (JSON.stringify(portable(merged)) !== before) { apply(merged); changed = true; }
          const body = JSON.stringify({ data: portable(K.storage.data), base: v || 0 });
          if (data && JSON.stringify(portable(K.storage.migrate(JSON.parse(JSON.stringify(data))))) === JSON.stringify(portable(K.storage.data))) { setVer(v); break; }
          const put = await fetch(`${C.API_BASE}/api/save`, { method: 'PUT', headers: hdrs(), body });
          if (put.ok) { setVer((await put.json()).ver); break; }
          if (put.status !== 409) break;
          ({ data, ver: v } = await put.json());          // someone saved meanwhile: merge theirs too
        }
      } catch (e) { /* offline: the next sync catches up */ }
      return changed;
    })().finally(() => {
      busy = null;
      if (again) { again = false; setTimeout(now, 50); }
    });
    return busy;
  }

  /** Called after every local save of something worth keeping. */
  function soon() {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(now, 2500);
  }

  return { merge, portable, now, soon, enabled, replayStreak };
})();
